// In-memory DataPort for tests: the second adapter that makes the seam real. No network, no React.
// It mirrors the server rules the app relies on (soft delete hides rows, unique names, FK-style delete guard),
// not the SQL. Add behaviour here only when a test needs it, and keep it as dumb as the real thing is smart.
import type { Tables } from '../database.types.ts'
import { ApiError, type DataPort, type HouseholdSettings, type PantryMealRow, type PantrySnapshotRow } from './port.ts'

export type FakeState = {
  userId: string | null
  household: HouseholdSettings
  ingredients: Tables<'ingredients'>[]
  /** Live recipes' ingredient lines: what `ingredients.usage` and the delete guard look at. */
  recipeLines: { ingredientId: string; recipeName: string }[]
  batches: Tables<'batches'>[]
  meals: PantryMealRow[]
  adjustments: Tables<'adjustments'>[]
  snapshot: PantrySnapshotRow | undefined
  shoppingItems: Tables<'shopping_items'>[]
}

export type FakeApi = DataPort & {
  state: FakeState
  /** Every port call as 'group.method', in order. Assert on it to see what a page did. */
  calls: string[]
  /** Make the next call of 'group.method' throw. Fires once. */
  failNext(call: string, error?: Error): void
}

const NOW = '2026-01-01T00:00:00Z'
let seq = 0
const id = () => `fake-${++seq}`

/** Row factories: fill in the boring columns so a test states only what matters. */
export const row = {
  ingredient: (o: Partial<Tables<'ingredients'>> = {}): Tables<'ingredients'> => ({
    archived: false, category: null, created_at: NOW, created_by: null, deleted_at: null, deleted_by: null, household_id: 'h1', id: id(),
    min_stock: null, name: 'pasta', on_hand: false, pack_size: null, shelf_life_days: null, unit: 'g', updated_at: null, updated_by: null, ...o,
  }),
  batch: (o: Partial<Tables<'batches'>> = {}): Tables<'batches'> => ({
    added_at: NOW, created_at: NOW, created_by: null, deleted_at: null, deleted_by: null, expires_on: null, household_id: 'h1', id: id(),
    ingredient_id: 'i1', qty: 0, recorded_at: NOW, updated_at: null, updated_by: null, ...o,
  }),
  shoppingItem: (o: Partial<Tables<'shopping_items'>> = {}): Tables<'shopping_items'> => ({
    bought_batch_id: null, checked: false, created_at: NOW, created_by: null, deleted_at: null, deleted_by: null, household_id: 'h1', id: id(),
    ingredient_id: null, qty: null, text: null, updated_at: null, updated_by: null, ...o,
  }),
}

export function createFakeAdapter(seed: Partial<FakeState> = {}): FakeApi {
  const state: FakeState = {
    userId: 'u1',
    household: { id: 'h1', timezone: 'UTC', expiring_days: 3, horizon_days: 7, slots: ['lunch', 'dinner'], slot_end_times: {} },
    ingredients: [], recipeLines: [], batches: [], meals: [], adjustments: [], snapshot: undefined, shoppingItems: [],
    ...seed,
  }
  const calls: string[] = []
  const failures = new Map<string, Error>()
  /** Wraps every method of one port group: logs the call, can be made to fail, and returns a promise. Methods may be sync. */
  const track = <K extends keyof DataPort>(
    group: K,
    methods: { [M in keyof DataPort[K]]: DataPort[K][M] extends (...a: infer A) => Promise<infer R> ? (...a: A) => R | Promise<R> : never },
  ): DataPort[K] =>
    Object.fromEntries(
      Object.entries(methods as Record<string, (...a: unknown[]) => unknown>).map(([name, fn]) => [
        name,
        async (...args: unknown[]) => {
          const call = `${group}.${name}`
          calls.push(call)
          const err = failures.get(call)
          if (err) { failures.delete(call); throw err }
          return fn(...args)
        },
      ]),
    ) as DataPort[K]

  const live = <T extends { deleted_at: string | null }>(rows: T[]) => rows.filter((r) => !r.deleted_at)

  const api: DataPort = {
    auth: track('auth', { currentUserId: () => state.userId }),
    household: track('household', { settings: () => state.household }),
    ingredients: track('ingredients', {
      list: () => [...live(state.ingredients)].sort((a, b) => a.name.localeCompare(b.name)),
      usage: (ingredientId) => state.recipeLines.filter((l) => l.ingredientId === ingredientId).map((l) => l.recipeName),
      save: (ingredientId, input) => {
        if (live(state.ingredients).some((i) => i.id !== ingredientId && i.name.toLowerCase() === input.name?.toLowerCase())) {
          throw new ApiError('duplicate key value violates unique constraint', '23505')
        }
        const existing = state.ingredients.find((i) => i.id === ingredientId)
        if (existing) Object.assign(existing, input)
        else state.ingredients.push(row.ingredient(input))
      },
      setOnHand: (ingredientId, onHand) => {
        const i = state.ingredients.find((x) => x.id === ingredientId)
        if (i) i.on_hand = onHand
      },
    }),
    pantry: track('pantry', {
      rows: () => ({
        batches: live(state.batches),
        meals: live(state.meals),
        adjustments: live(state.adjustments),
        snapshot: state.snapshot,
        ingredients: live(state.ingredients),
      }),
    }),
    shop: track('shop', {
      buy: (b) => {
        if (!state.batches.some((x) => x.id === b.batchId)) {
          state.batches.push(row.batch({ id: b.batchId, ingredient_id: b.ingredientId, qty: b.qty, expires_on: b.expiresOn, added_at: b.addedAt }))
        }
        const item = b.shoppingItemId ? live(state.shoppingItems).find((i) => i.id === b.shoppingItemId) : undefined
        if (item) { item.checked = true; item.bought_batch_id = b.batchId }
        return { itemFound: !b.shoppingItemId || !!item }
      },
      setChecked: (itemId, checked) => {
        const i = state.shoppingItems.find((x) => x.id === itemId)
        if (i) i.checked = checked
      },
      unbuy: (batchId) => {
        state.batches = state.batches.filter((b) => b.id !== batchId)
        for (const i of state.shoppingItems) if (i.bought_batch_id === batchId) { i.checked = false; i.bought_batch_id = null }
      },
    }),
    trash: track('trash', {
      softDelete: (table, ids) => {
        if (table === 'ingredients') {
          for (const ingredientId of ids) {
            if (state.recipeLines.some((l) => l.ingredientId === ingredientId)) throw new ApiError('still referenced', '23503')
          }
          for (const i of state.ingredients) if (ids.includes(i.id)) i.deleted_at = NOW
        }
        // shortcut: other tables are not faked yet; add them with the first test that needs them
      },
      restore: (table, ids) => {
        if (table === 'ingredients') for (const i of state.ingredients) if (ids.includes(i.id)) i.deleted_at = null
      },
    }),
  }

  return { ...api, state, calls, failNext: (call, error = new Error(`fake failure: ${call}`)) => void failures.set(call, error) }
}
