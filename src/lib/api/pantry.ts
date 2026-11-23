// Pantry aggregate: the raw facts for the Planner, Pantry and Shopping tabs, and what makes them stale.
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { buildEvents, buildIngredients, localDay } from '../../domain/pantryRows.ts'
import type { Day } from '../../domain/replay.ts'
import { useApi } from './context.tsx'
import { keys } from './keys.ts'
import type { DataPort } from './port.ts'

export { localDay }

export const today = (timeZone: string): Day => localDay(new Date(), timeZone)

/** Rows from the port, turned into replay input. Pure apart from the one port call, so tests can run it on the fake. */
export async function fetchPantry(api: DataPort, tz: string, slots: string[] | undefined) {
  const rows = await api.pantry.rows()
  const events = buildEvents({ batches: rows.batches, meals: rows.meals, adjustments: rows.adjustments, snapshot: rows.snapshot, slots }, tz)
  const domainIngredients = buildIngredients(rows.ingredients)
  // Who bought each batch (null = unknown), kept beside the domain events: the replay doesn't need it.
  const batchAuthors: Record<string, string | null> = Object.fromEntries(rows.batches.map((b) => [b.id, b.created_by]))
  return { events, domainIngredients, ingredients: rows.ingredients, meals: rows.meals, batchAuthors }
}

/** Raw facts for the Planner, Pantry and Shopping tabs. Derive stock with replay()/shoppingList() in a useMemo. */
export function usePantry() {
  const api = useApi()
  const settings = useQuery({ queryKey: keys.household.settings(), queryFn: () => api.household.settings() })
  const tz = settings.data?.timezone
  // slots come with the same settings row as tz, so they are known whenever tz is
  const pantry = useQuery({ queryKey: keys.pantry.all(), queryFn: () => fetchPantry(api, tz!, settings.data?.slots), enabled: !!tz })
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

/** For commands not yet migrated to defineCommand (`invalidates: () => [keys.pantry.all()]` is the target form). */
export const invalidatePantry = (queryClient: QueryClient) => queryClient.invalidateQueries({ queryKey: keys.pantry.all() })
