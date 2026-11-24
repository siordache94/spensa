// Production adapter: DataPort over the Supabase client. All `supabase.` calls in the app belong in this file.
import { isAuthApiError } from '@supabase/supabase-js'
import { signUpOutcome } from '../authFlow.ts'
import { mealLinesPayload } from '../../domain/mealLines.ts'
import { supabase } from '../supabase.ts'
import { ApiError, type DataPort, type PantryRows, type PushTestResult, type ShoppingItemRow, type UnreadCheckinRow } from './port.ts'

const check = (error: { message: string; code?: string } | null) => {
  if (error) throw new ApiError(error.message, error.code)
}
const authCheck = (error: { message: string; code?: string; status?: number } | null) => {
  if (error) throw new ApiError(error.message, error.code, error.status)
}

const INVALID_USER_CODES = ['user_not_found', 'session_not_found', 'bad_jwt']

/**
 * Password recovery (MR-039). A reset link signs the user in with a recovery session and fires PASSWORD_RECOVERY.
 * Until the new password is set (or the user backs out), that session must not open the app: it is not a normal
 * sign-in, and the Auth page has to show the set-password state instead of the shell.
 */
let recoveryPending = false
let watchingRecovery = false
const recoveryListeners = new Set<() => void>()

/** Subscribes to PASSWORD_RECOVERY before the first session read, so the event that the link fires is never missed. */
function watchRecovery() {
  if (watchingRecovery) return
  watchingRecovery = true
  supabase.auth.onAuthStateChange((event) => {
    if (event !== 'PASSWORD_RECOVERY') return
    recoveryPending = true
    for (const cb of recoveryListeners) cb()
  })
}

const RECIPE_SELECT = '*, recipe_ingredients(ingredient_id, qty_per_portion, ingredients(name, unit))'

export const supabaseAdapter: DataPort = {
  auth: {
    // The local session is read from storage, so this works offline.
    currentUserId: async () => {
      watchRecovery()
      const id = (await supabase.auth.getSession()).data.session?.user.id ?? null
      return recoveryPending ? null : id
    },
    async session() {
      watchRecovery()
      const user = (await supabase.auth.getSession()).data.session?.user
      return user && !recoveryPending ? { userId: user.id, metadata: user.user_metadata ?? {} } : null
    },
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      authCheck(error)
      recoveryPending = false
    },
    async signUp(email, password, inviteCode) {
      // The server's "before user created" hook refuses signups without an allowlisted email or valid invite code.
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: inviteCode ? { invite_code: inviteCode } : undefined } })
      const outcome = signUpOutcome({ user: data.user, session: data.session, error })
      if (outcome === 'refused') authCheck(error ?? { message: 'Sign-up was refused.' })
      return { needsConfirmation: outcome === 'checkEmail' }
    },
    async resendConfirmation(email) {
      const { error } = await supabase.auth.resend({ type: 'signup', email })
      authCheck(error)
    },
    async requestPasswordReset(email, redirectTo) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
      authCheck(error)
    },
    async updatePassword(password) {
      const { error } = await supabase.auth.updateUser({ password })
      authCheck(error)
      recoveryPending = false
    },
    async signInWithGoogle(redirectTo) {
      const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })
      authCheck(error)
    },
    async signOut(scope) {
      recoveryPending = false
      await supabase.auth.signOut({ scope })
    },
    async recoveryPending() { return recoveryPending },
    async verifyUser() {
      // A local DB reset leaves a JWT for a user that no longer exists. Only a server-side "gone" answer is 'invalid'.
      try {
        const { data, error } = await supabase.auth.getUser()
        if (!error && data.user) return 'ok'
        const serverSaysGone = isAuthApiError(error) && ([401, 403, 404].includes(error.status) || INVALID_USER_CODES.includes(error.code ?? ''))
        return serverSaysGone && navigator.onLine !== false ? 'invalid' : 'unreachable'
      } catch {
        return 'unreachable'
      }
    },
  },

  household: {
    async settings() {
      const { data, error } = await supabase
        .from('households')
        .select('id, timezone, expiring_days, horizon_days, expiry_reminder_days, slots, slot_end_times')
        .single()
      check(error)
      return data!
    },
    async current() {
      const { data, error } = await supabase.from('households').select('id, name, invite_code').maybeSingle()
      check(error)
      return data
    },
    async update(patch) {
      // household_id is not needed: RLS limits the update to the member's own household row
      const { error } = await supabase.from('households').update(patch).not('id', 'is', null)
      check(error)
    },
    async rotateInviteCode() {
      const { error } = await supabase.rpc('rotate_invite_code')
      check(error)
    },
    async create(name, displayName, timezone) {
      const { error } = await supabase.rpc('create_household', { name, display_name: displayName, timezone })
      check(error)
    },
    async join(code, displayName) {
      const { error } = await supabase.rpc('join_household', { code, display_name: displayName })
      check(error)
    },
    async members() {
      const { data, error } = await supabase.from('household_members').select('user_id, display_name').order('display_name')
      check(error)
      return data!
    },
    async setMemberName(userId, displayName) {
      const { error } = await supabase.from('household_members').update({ display_name: displayName }).eq('user_id', userId)
      check(error)
    },
  },

  recipes: {
    async list() {
      const { data, error } = await supabase.from('recipes').select(RECIPE_SELECT).order('name')
      check(error)
      return data!
    },
    async options() {
      const { data, error } = await supabase.from('recipes').select('id, name, serves').order('name')
      check(error)
      return data!
    },
    async planned(recipeId) {
      const { data: snapshots, error: snapshotError } = await supabase
        .from('snapshots')
        .select('on_date')
        .order('on_date', { ascending: false })
        .limit(1)
      check(snapshotError)
      const cutoff = snapshots![0]?.on_date

      let query = supabase.from('planned_meals').select('*').eq('recipe_id', recipeId).order('date').order('slot')
      if (cutoff) query = query.gt('date', cutoff)
      const { data, error } = await query
      check(error)
      return data!
    },
    async save(input) {
      const { error } = await supabase.rpc('save_recipe', {
        // Generated types omit null for uuid args; the RPC takes null to mean "insert".
        recipe_id: (input.id ?? null) as string,
        name: input.name,
        instructions: input.instructions,
        tags: input.tags,
        serves: input.serves,
        lines: input.lines,
      })
      check(error)
    },
  },

  plan: {
    async add(row) {
      const { error } = await supabase.from('planned_meals').insert(row)
      check(error)
    },
    async move(id, to) {
      const { error } = await supabase.from('planned_meals').update(to).eq('id', id)
      check(error)
    },
    async setPortions(id, portions) {
      const { error } = await supabase.from('planned_meals').update({ portions }).eq('id', id)
      check(error)
    },
    async setCook(id, cookId) {
      const { error } = await supabase.from('planned_meals').update({ cook_id: cookId }).eq('id', id)
      check(error)
    },
  },

  ingredients: {
    async list() {
      const { data, error } = await supabase.from('ingredients').select('*').order('name')
      check(error)
      return data!
    },
    async usage(ingredientId) {
      const { data, error } = await supabase.from('recipe_ingredients').select('recipes(name)').eq('ingredient_id', ingredientId)
      check(error)
      return data!.map((row) => row.recipes.name)
    },
    async save(id, row) {
      const { error } = id ? await supabase.from('ingredients').update(row).eq('id', id) : await supabase.from('ingredients').insert(row)
      check(error)
    },
    async create(row) {
      const { data, error } = await supabase.from('ingredients').insert({ name: row.name, unit: row.unit }).select('id').single()
      check(error)
      return data!.id
    },
    async setOnHand(id, onHand) {
      const { error } = await supabase.from('ingredients').update({ on_hand: onHand }).eq('id', id)
      check(error)
    },
  },

  pantry: {
    async rows(): Promise<PantryRows> {
      // Soft-deleted rows never arrive: RLS select policies hide them (ADR 0003), so replay sees only live facts.
      // The version is read BEFORE the rows: a write landing in between then leaves the version older than the data,
      // so "Done shopping" can only falsely conflict, never silently drop the new batch (MR-005).
      const version = await supabase.from('household_events').select('at').maybeSingle()
      check(version.error)
      // shortcut: fetches every row since forever; filter by the latest snapshot date when history grows
      const [batches, meals, adjustments, snapshots, ingredients] = await Promise.all([
        supabase.from('batches').select('*'),
        supabase.from('planned_meals').select('*, planned_meal_lines(ingredient_id, qty_total), recipes(id, name, recipe_ingredients(ingredient_id, qty_per_portion))'),
        supabase.from('adjustments').select('*'),
        supabase
          .from('snapshots')
          .select('*, snapshot_batches(batch_id, qty)')
          .order('on_date', { ascending: false })
          .order('taken_at', { ascending: false })
          .limit(1),
        supabase.from('ingredients').select('*'),
      ])
      for (const r of [batches, meals, adjustments, snapshots, ingredients]) check(r.error)
      return {
        batches: batches.data!,
        meals: meals.data!,
        adjustments: adjustments.data!,
        snapshot: snapshots.data![0],
        ingredients: ingredients.data!,
        version: version.data?.at,
      }
    },
    async saveEdits(edits) {
      const { error } = await supabase.rpc('save_pantry_edits', { adjustments: edits.adjustments, new_batches: edits.newBatches, expiries: edits.expiries })
      check(error)
    },
  },

  shop: {
    async list() {
      const { data, error } = await supabase.from('shopping_items').select('*, ingredients(name, unit, category)').order('created_at')
      check(error)
      return data as ShoppingItemRow[]
    },
    async addItem(item) {
      const { error } = await supabase.from('shopping_items').insert(item)
      check(error)
    },
    async setMealSkip(mealId, skip) {
      const { error } = await supabase.from('planned_meals').update({ skip_shopping: skip }).eq('id', mealId)
      check(error)
    },
    async buy(b) {
      if (b.shoppingItemId) {
        // The ingredient is not sent: the RPC reads it from the item, so a tick buys what the list says (MR-003).
        const { data, error } = await supabase.rpc('buy_shopping_item', {
          item_id: b.shoppingItemId,
          batch_id: b.batchId,
          qty: b.qty,
          // Generated types omit null for date args; the RPC takes null to mean "no expiry".
          expires_on: b.expiresOn as string,
          added_at: b.addedAt,
        })
        // The RPC is idempotent on batch_id, so a retry is a plain success.
        check(error)
        const already = (data as { already_purchased?: boolean } | null)?.already_purchased === true
        return { batchId: b.batchId, alreadyPurchased: already }
      }
      const { error } = await supabase
        .from('batches')
        .upsert({ id: b.batchId, ingredient_id: b.ingredientId, qty: b.qty, expires_on: b.expiresOn, added_at: b.addedAt }, { onConflict: 'id', ignoreDuplicates: true })
      check(error)
      return { batchId: b.batchId, alreadyPurchased: false }
    },
    async setChecked(itemId, checked) {
      const { error } = await supabase.from('shopping_items').update({ checked }).eq('id', itemId)
      check(error)
    },
    async unbuy(batchId) {
      // Deletes the batch (cascading its snapshot rows and adjustments) and puts its list item, if any, back on the list.
      const { error } = await supabase.rpc('unbuy', { batch_id: batchId })
      check(error)
    },
  },

  checkins: {
    async unread() {
      // RLS hides deleted check-ins, and the embed of a deleted meal comes back null: the caller skips those.
      const { data, error } = await supabase
        .from('meal_checkins')
        .select('id, planned_meal_id, created_at, planned_meals(id, date, slot, portions, cook_id, recipes(name))')
        .is('answered_at', null)
        .order('created_at')
      check(error)
      return data as UnreadCheckinRow[]
    },
    async answer(mealId, answer) {
      const { data, error } = await supabase.rpc('answer_checkin', { p_meal: mealId, p_answer: answer })
      check(error)
      return data as boolean
    },
    async setNotCooked(mealId, notCooked) {
      const { error } = await supabase.from('planned_meals').update({ not_cooked: notCooked }).eq('id', mealId)
      check(error)
    },
    async saveMealLines(mealId, lines) {
      const { error } = await supabase.rpc('save_meal_lines', { p_meal: mealId, p_lines: mealLinesPayload(lines) })
      check(error)
    },
    async slotEndTimes() {
      const { data, error } = await supabase.from('households').select('slots, slot_end_times').single()
      check(error)
      return data!
    },
    async saveSlotEndTimes(times) {
      const { error } = await supabase.from('households').update({ slot_end_times: times }).not('id', 'is', null)
      check(error)
    },
    async finishShopping(onDate, batches, answers, expectedAt) {
      const { error } = await supabase.rpc('finish_shopping', {
        on_date: onDate,
        batches,
        answers,
        // Generated types omit null for timestamptz args; null = the household had no event row when we read it.
        expected_at: expectedAt as string,
      })
      check(error)
    },
  },

  live: {
    subscribeHouseholdEvents(topic, onEvent) {
      const channel = supabase.channel(topic)
      channel.on('postgres_changes', { event: '*', schema: 'public', table: 'household_events' }, (p) => {
        onEvent((p.new as { by?: string | null }).by ?? null)
      })
      channel.subscribe()
      return () => { void supabase.removeChannel(channel) }
    },
    onSessionChange(onChange) {
      const { data } = supabase.auth.onAuthStateChange((_event, next) => onChange(next !== null))
      return () => data.subscription.unsubscribe()
    },
    onPasswordRecovery(cb) {
      watchRecovery()
      recoveryListeners.add(cb)
      // The link may have been consumed before this page mounted: replay the pending recovery once.
      if (recoveryPending) cb()
      return () => { recoveryListeners.delete(cb) }
    },
  },

  account: {
    async exportData() {
      const { data, error } = await supabase.rpc('export_my_data')
      check(error)
      return data
    },
    async deleteAccount() {
      const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' })
      check(error)
    },
  },

  push: {
    async saveSubscription(endpoint, p256dh, auth) {
      const { error } = await supabase.rpc('save_push_subscription', { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth })
      check(error)
    },
    async deleteSubscription(endpoint) {
      const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
      check(error)
    },
    async prefs() {
      const { data, error } = await supabase.from('push_prefs').select('list_changes, meal_checkins, expiry_time').maybeSingle()
      check(error)
      return data
    },
    async ensurePrefs(defaults) {
      const { error } = await supabase.from('push_prefs').upsert(defaults, { onConflict: 'user_id', ignoreDuplicates: true })
      check(error)
    },
    async savePrefs(prefs) {
      const { error } = await supabase.from('push_prefs').upsert(prefs, { onConflict: 'user_id' })
      check(error)
    },
    async test() {
      const { data, error } = await supabase.functions.invoke('push-test', { method: 'POST' })
      if (error) {
        const res = (error as { context?: Response }).context
        const body = res ? await res.json().catch(() => null) as { error?: string } | null : null
        throw new ApiError(body?.error ?? '')
      }
      return data as PushTestResult
    },
  },

  trash: {
    async softDelete(table, ids) {
      const { error } = await supabase.rpc('soft_delete', { tbl: table, ids })
      check(error)
    },
    async restore(table, ids) {
      const { error } = await supabase.rpc('restore', { tbl: table, ids })
      check(error)
    },
  },
}
