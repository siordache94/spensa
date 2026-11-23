import { useQuery, type QueryClient } from '@tanstack/react-query'
import type { Day, Ingredient, PantryEvents } from '../domain/replay'
import { supabase } from './supabase'

const dayFormat = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })

/** The household-local calendar day of an instant ('YYYY-MM-DD'). */
export const localDay = (iso: string | Date, timeZone: string): Day => dayFormat(timeZone).format(new Date(iso))

export const today = (timeZone: string): Day => localDay(new Date(), timeZone)

const num = (v: number | string | null) => (v === null ? null : Number(v))

async function fetchSettings() {
  const { data, error } = await supabase.from('households').select('id, timezone, expiring_days, slots').single()
  if (error) throw error
  return data
}

async function fetchPantry(tz: string) {
  // shortcut: fetches every row since forever; filter by the latest snapshot date when history grows
  const [batches, meals, adjustments, snapshots, ingredients] = await Promise.all([
    supabase.from('batches').select('*'),
    supabase.from('planned_meals').select('*, recipes(id, name, recipe_ingredients(ingredient_id, qty_per_portion))'),
    supabase.from('adjustments').select('*'),
    supabase
      .from('snapshots')
      .select('*, snapshot_batches(batch_id, qty)')
      .order('on_date', { ascending: false })
      .order('taken_at', { ascending: false })
      .limit(1),
    supabase.from('ingredients').select('*'),
  ])
  for (const r of [batches, meals, adjustments, snapshots, ingredients]) if (r.error) throw r.error
  const snap = snapshots.data![0]

  const events: PantryEvents = {
    batches: batches.data!.map((b) => ({
      id: b.id,
      ingredientId: b.ingredient_id,
      qty: Number(b.qty),
      // server time, so a phone with a wrong clock can't hide or misplace its batch; added_at is for display
      addedOn: localDay(b.recorded_at, tz),
      addedAt: b.added_at,
      recordedAt: b.recorded_at,
      expiresOn: b.expires_on,
    })),
    meals: meals.data!.map((m) => ({
      id: m.id,
      date: m.date,
      portions: m.portions,
      lines: (m.recipes?.recipe_ingredients ?? []).map((l) => ({
        ingredientId: l.ingredient_id,
        qtyPerPortion: num(l.qty_per_portion),
      })),
    })),
    adjustments: adjustments.data!.map((a) => ({
      ingredientId: a.ingredient_id,
      batchId: a.batch_id,
      kind: a.kind,
      qty: num(a.qty),
      on: localDay(a.recorded_at, tz),
      at: a.at,
      recordedAt: a.recorded_at,
    })),
    snapshot: snap
      ? {
          onDate: snap.on_date,
          takenAt: snap.taken_at,
          batches: snap.snapshot_batches.map((s) => ({ batchId: s.batch_id, qty: Number(s.qty) })),
        }
      : null,
  }
  const domainIngredients: Ingredient[] = ingredients.data!.map((i) => ({
    id: i.id,
    unit: i.unit,
    packSize: num(i.pack_size),
    minStock: num(i.min_stock),
    onHand: i.on_hand,
  }))
  // Who bought each batch (null = unknown), kept beside the domain events: the replay doesn't need it.
  const batchAuthors: Record<string, string | null> = Object.fromEntries(batches.data!.map((b) => [b.id, b.created_by]))
  return { events, domainIngredients, ingredients: ingredients.data!, meals: meals.data!, batchAuthors }
}

/** Raw facts for the Planner, Pantry and Shopping tabs. Derive stock with replay()/shoppingList() in a useMemo. */
export function usePantry() {
  const settings = useQuery({ queryKey: ['household', 'settings'], queryFn: fetchSettings })
  const tz = settings.data?.timezone
  const pantry = useQuery({ queryKey: ['pantry'], queryFn: () => fetchPantry(tz!), enabled: !!tz })
  return {
    ...pantry,
    isPending: settings.isPending || pantry.isPending,
    error: settings.error ?? pantry.error,
    household: settings.data,
    today: tz ? today(tz) : undefined,
    events: pantry.data?.events,
    ingredients: pantry.data?.ingredients,
    domainIngredients: pantry.data?.domainIngredients,
    meals: pantry.data?.meals,
    batchAuthors: pantry.data?.batchAuthors,
  }
}

export const invalidatePantry = (queryClient: QueryClient) => queryClient.invalidateQueries({ queryKey: ['pantry'] })
