// Shared by the push edge functions: service-role client, data loading, and the web-push sender.
// The decisions (who, what, when) live in src/lib/notify.ts and src/domain/toBuy.ts so they are unit tested.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import type { Database } from '../../../src/lib/database.types.ts'
import webpush from 'npm:web-push@3.6.7'
import { buildEvents, buildIngredients, localDay } from '../../../src/domain/pantryRows.ts'
import { replay, type Ingredient, type PantryEvents } from '../../../src/domain/replay.ts'
import { resolvedKeys, toBuyKeys, type ShoppingItem } from '../../../src/domain/toBuy.ts'
import { isGone, type PushPayload } from '../../../src/lib/notify.ts'
import { selectedMealIds, tripRange } from '../../../src/lib/trip.ts'
import type { CheckinMeal, SlotEndTimes } from '../../../src/lib/checkin.ts'

// Typed with the generated schema so to-one embeds (planned_meals -> recipes) are objects, not arrays.
export type Admin = SupabaseClient<Database>

export const adminClient = (): Admin =>
  createClient<Database>(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

/** The database (pg_net, pg_cron) proves itself with the shared secret from push_config. */
export function hasWebhookSecret(req: Request): boolean {
  const want = Deno.env.get('PUSH_WEBHOOK_SECRET') ?? ''
  const got = req.headers.get('x-push-secret') ?? ''
  if (want.length < 16 || got.length !== want.length) return false
  let diff = 0
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i)
  return diff === 0
}

let vapidReady = false
function vapid() {
  if (vapidReady) return
  const pub = Deno.env.get('VAPID_PUBLIC_KEY')
  const priv = Deno.env.get('VAPID_PRIVATE_KEY')
  if (!pub || !priv) throw new Error('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not set')
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com', pub, priv)
  vapidReady = true
}

export type SendResult = { sent: number; gone: number; failed: number }

/** Sends to every device of the given users. Subscriptions the push service reports as gone (404/410) are deleted. */
export async function sendPush(admin: Admin, userIds: string[], payload: PushPayload): Promise<SendResult> {
  const result: SendResult = { sent: 0, gone: 0, failed: 0 }
  if (userIds.length === 0) return result
  vapid()
  const { data: subs, error } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').in('user_id', userIds)
  if (error) throw error
  const body = JSON.stringify(payload)
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
        TTL: payload.kind === 'expiry' ? 12 * 3600 : payload.kind === 'checkin' ? 6 * 3600 : 3600,
        urgency: payload.kind === 'checkin' ? 'low' : 'normal',
        topic: payload.topic ?? payload.kind, // a newer push of the same kind replaces one still queued for an offline phone
        timeout: 10_000,
      })
      result.sent++
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode ?? 0
      if (isGone(status)) {
        result.gone++
        await admin.from('push_subscriptions').delete().eq('id', s.id)
      } else {
        result.failed++
        console.error('push failed', status, new URL(s.endpoint).host, (e as Error).message)
      }
    }
  }))
  return result
}

// The service role bypasses RLS, so soft-deleted rows (ADR 0003) must be filtered by hand on every read.
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) { // PostgREST caps a response at max_rows (1000)
    const { data, error } = await page(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if ((data?.length ?? 0) < 1000) return out
  }
}

export type HouseholdData = {
  id: string
  tz: string
  today: string
  reminderDays: number
  slotEndTimes: SlotEndTimes
  /** Meals with what a check-in needs (cook, slot, recipe name). Not-cooked meals are left out. */
  checkinMeals: CheckinMeal[]
  events: PantryEvents
  ingredients: Ingredient[]
  names: Map<string, string>
  items: ShoppingItem[]
  /** Keys on the to-buy list right now. */
  keys: () => string[]
  /** Keys that left the list because they were bought. */
  resolved: () => Set<string>
  /** Stock left on `today`. */
  remaining: () => Map<string, number>
  /** Meals that had a shortfall in the replay up to today (any amount). */
  shortMealIds: () => Set<string>
}

export async function loadHousehold(admin: Admin, id: string, now = new Date()): Promise<HouseholdData> {
  const { data: h, error } = await admin.from('households').select('timezone, horizon_days, expiry_reminder_days, slot_end_times, slots').eq('id', id).single()
  if (error) throw new Error(error.message)
  const tz = h.timezone
  const live = { household_id: id }
  const [batches, meals, adjustments, snapshots, ingredientRows, itemRows] = await Promise.all([
    all((a, b) => admin.from('batches').select('*').match(live).is('deleted_at', null).order('id').range(a, b)),
    all((a, b) =>
      admin.from('planned_meals')
        .select('id, date, slot, position, cook_id, created_at, portions, skip_shopping, not_cooked, planned_meal_lines(ingredient_id, qty_total), recipes(id, name, recipe_ingredients(ingredient_id, qty_per_portion, deleted_at))')
        .match(live).is('deleted_at', null).is('recipes.deleted_at', null).is('recipes.recipe_ingredients.deleted_at', null)
        .is('planned_meal_lines.deleted_at', null)
        .order('id').range(a, b)),
    all((a, b) => admin.from('adjustments').select('*').match(live).is('deleted_at', null).order('id').range(a, b)),
    admin.from('snapshots').select('*, snapshot_batches(batch_id, qty)').match(live).is('deleted_at', null)
      .is('snapshot_batches.deleted_at', null).order('on_date', { ascending: false }).order('taken_at', { ascending: false }).limit(1),
    all((a, b) => admin.from('ingredients').select('*').match(live).is('deleted_at', null).order('id').range(a, b)),
    all((a, b) => admin.from('shopping_items').select('id, ingredient_id, checked, bought_batch_id').match(live).is('deleted_at', null).order('id').range(a, b)),
  ])
  if (snapshots.error) throw new Error(snapshots.error.message)

  const events = buildEvents({ batches, meals, adjustments, snapshot: snapshots.data?.[0], slots: h.slots }, tz)
  const ingredients = buildIngredients(ingredientRows)
  const items: ShoppingItem[] = itemRows.map((i) => ({ id: i.id, ingredientId: i.ingredient_id, checked: i.checked, boughtBatchId: i.bought_batch_id }))
  const today = localDay(now, tz)
  const { from, to } = tripRange(today, h.horizon_days)
  const mealIds = selectedMealIds(meals, from, to)
  return {
    id, tz, today, reminderDays: h.expiry_reminder_days, slotEndTimes: (h.slot_end_times ?? {}) as SlotEndTimes, events, ingredients, items,
    checkinMeals: meals.filter((m) => !m.not_cooked).map((m) => ({
      id: m.id, date: m.date, slot: m.slot, cookId: m.cook_id, createdAt: m.created_at, recipeName: m.recipes?.name ?? null,
    })),
    shortMealIds: () => new Set(replay(events, today).shortfalls.map((s) => s.mealId)),
    names: new Map(ingredientRows.map((i) => [i.id, i.name])),
    keys: () => toBuyKeys({ events, ingredients, items, from, to, mealIds, today }),
    resolved: () => resolvedKeys({ events, ingredients, items, today }),
    remaining: () => replay(events, today).remaining,
  }
}

export type Member = { user_id: string; display_name: string | null; list_changes: boolean; meal_checkins: boolean; expiry_time: string | null; expiry_checked_on: string | null; prefs: boolean }

/** Household members with their push prefs (no row = defaults: list changes on, reminder at 09:00). */
export async function loadMembers(admin: Admin, hid: string): Promise<Member[]> {
  const { data: members, error } = await admin.from('household_members').select('user_id, display_name').eq('household_id', hid)
  if (error) throw new Error(error.message)
  const { data: prefs, error: e2 } = await admin.from('push_prefs').select('*').in('user_id', members.map((m) => m.user_id))
  if (e2) throw new Error(e2.message)
  return members.map((m) => {
    const p = prefs.find((x) => x.user_id === m.user_id)
    return {
      user_id: m.user_id,
      display_name: m.display_name,
      list_changes: p?.list_changes ?? true,
      meal_checkins: p?.meal_checkins ?? true,
      expiry_time: p ? p.expiry_time : '09:00:00',
      expiry_checked_on: p?.expiry_checked_on ?? null,
      prefs: !!p,
    }
  })
}
