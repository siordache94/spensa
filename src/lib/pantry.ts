import { useQuery, type QueryClient } from '@tanstack/react-query'
import { buildEvents, buildIngredients, localDay } from '../domain/pantryRows.ts'
import type { Day } from '../domain/replay'
import { supabase } from './supabase'

export { localDay }

export const today = (timeZone: string): Day => localDay(new Date(), timeZone)

async function fetchSettings() {
  const { data, error } = await supabase.from('households').select('id, timezone, expiring_days, horizon_days, slots, slot_end_times').single()
  if (error) throw error
  return data
}

async function fetchPantry(tz: string, slots: string[] | undefined) {
  // Soft-deleted rows never arrive: RLS select policies hide them (ADR 0003), so replay sees only live facts.
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
  for (const r of [batches, meals, adjustments, snapshots, ingredients]) if (r.error) throw r.error
  const snap = snapshots.data![0]

  const events = buildEvents({ batches: batches.data!, meals: meals.data!, adjustments: adjustments.data!, snapshot: snap, slots }, tz)
  const domainIngredients = buildIngredients(ingredients.data!)
  // Who bought each batch (null = unknown), kept beside the domain events: the replay doesn't need it.
  const batchAuthors: Record<string, string | null> = Object.fromEntries(batches.data!.map((b) => [b.id, b.created_by]))
  return { events, domainIngredients, ingredients: ingredients.data!, meals: meals.data!, batchAuthors }
}

/** Raw facts for the Planner, Pantry and Shopping tabs. Derive stock with replay()/shoppingList() in a useMemo. */
export function usePantry() {
  const settings = useQuery({ queryKey: ['household', 'settings'], queryFn: fetchSettings })
  const tz = settings.data?.timezone
  // slots come with the same settings row as tz, so they are known whenever tz is
  const pantry = useQuery({ queryKey: ['pantry'], queryFn: () => fetchPantry(tz!, settings.data?.slots), enabled: !!tz })
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
