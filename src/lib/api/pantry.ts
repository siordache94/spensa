// Pantry aggregate: the raw facts for the Planner, Pantry and Shopping tabs, and what makes them stale.
import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient, type UseMutationOptions } from '@tanstack/react-query'
import { buildEvents, buildIngredients, localDay } from '../../domain/pantryRows.ts'
import type { PantryEdits } from '../../domain/pantryEdits.ts'
import { expiringSoon, replay, stockByIngredient as stockOf, type Day } from '../../domain/replay.ts'
import { defineCommand, runCommand } from './command.ts'
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

/**
 * The pantry's facts plus the stock replayed once, as of today. The Pantry, Use-soon and Shop screens read stock from
 * here; a component never calls replay() itself. Memoized on (events, today): a refetch with the same facts is free.
 */
export function usePantryState() {
  const pantry = usePantry()
  const { events, household, today } = pantry
  const replayed = useMemo(() => (events && today ? replay(events, today) : undefined), [events, today])
  const remaining = replayed?.remaining
  const stockByIngredient = useMemo(() => (events && remaining ? stockOf(events, remaining) : undefined), [events, remaining])
  const expiring = useMemo(
    () => (events && remaining && today && household ? expiringSoon(events, remaining, today, household.expiring_days) : undefined),
    [events, remaining, today, household],
  )
  return { ...pantry, remaining, shortfalls: replayed?.shortfalls, consumed: replayed?.consumed, stockByIngredient, expiring }
}

/** For commands not yet migrated to defineCommand (`invalidates: () => [keys.pantry.all()]` is the target form). */
export const invalidatePantry = (queryClient: QueryClient) => queryClient.invalidateQueries({ queryKey: keys.pantry.all() })

/** The pantry editor's save: only the changed lines (see diffEdits). */
export const savePantryEdits = defineCommand<PantryEdits>({
  name: 'pantry.saveEdits',
  run: (api, edits) => api.pantry.saveEdits(edits),
  invalidates: () => [keys.pantry.all()],
})

/**
 * savePantryEdits for the editor, which leaves edit mode only after the refetch (so the amounts never flash back to the
 * old ones). Same invalidation as the command; the difference is that this one waits for it.
 */
export function useSavePantryEdits(options: Omit<UseMutationOptions<void, Error, PantryEdits>, 'mutationFn'> = {}) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({ ...options, mutationFn: (edits: PantryEdits) => runCommand(qc, api, savePantryEdits, edits) })
}
