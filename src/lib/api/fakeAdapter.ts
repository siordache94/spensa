// In-memory DataPort for tests: the second adapter that makes the seam real. No network, no React.
// It mirrors the server rules the app relies on (soft delete hides rows, unique names, FK-style delete guard),
// not the SQL. Add behaviour here only when a test needs it, and keep it as dumb as the real thing is smart.
import type { Tables } from '../database.types.ts'
import type { FinishAnswer } from '../../domain/checkinAnswers.ts'
import type { PantryEdits } from '../../domain/pantryEdits.ts'
import { mealLinesPayload } from '../../domain/mealLines.ts'
import type { MealAmount } from '../../domain/replay.ts'
import {
  ApiError, type DataPort, type HouseholdSettings, type PantryMealRow, type PantrySnapshotRow, type Recipe, type SnapshotBatch, type UnreadCheckinRow,
} from './port.ts'

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
  recipes: Recipe[]
  /** Unread meal check-ins, oldest first (what checkins.unread returns). */
  unreadCheckins: UnreadCheckinRow[]
  /** What pantry.saveEdits was called with, in order. */
  savedEdits: PantryEdits[]
  /** What checkins.finishShopping was called with, in order. */
  finishedShopping: { onDate: string; batches: SnapshotBatch[]; answers: FinishAnswer[] }[]
}

export type FakeApi = DataPort & {
  state: FakeState
  /** Every port call as 'group.method', in order. Assert on it to see what a page did. */
  calls: string[]
  /** Makes the household events feed fire, as a partner's write would. `by` = the writer's user id. */
  emitHouseholdEvent(by: string | null): void
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
  recipe: (o: Partial<Tables<'recipes'>> & { recipe_ingredients?: Recipe['recipe_ingredients'] } = {}): Recipe => ({
    created_at: NOW, created_by: null, deleted_at: null, deleted_by: null, household_id: 'h1', id: id(), instructions: '', name: 'soup',
    serves: 2, tags: [], updated_at: null, updated_by: null, recipe_ingredients: [], ...o,
  }),
  plannedMeal: (o: Partial<Tables<'planned_meals'>> = {}): PantryMealRow => ({
    cook_id: null, created_at: NOW, created_by: null, date: '2026-01-05', deleted_at: null, deleted_by: null, household_id: 'h1', id: id(),
    not_cooked: false, portions: 2, position: 0, recipe_id: null, skip_shopping: false, slot: 'dinner', updated_at: null, updated_by: null,
    planned_meal_lines: [], recipes: null, ...o,
  }),
}

export function createFakeAdapter(seed: Partial<FakeState> = {}): FakeApi {
  const state: FakeState = {
    userId: 'u1',
    household: { id: 'h1', timezone: 'UTC', expiring_days: 3, horizon_days: 7, slots: ['lunch', 'dinner'], slot_end_times: {} },
    ingredients: [], recipeLines: [], batches: [], meals: [], adjustments: [], snapshot: undefined, shoppingItems: [], recipes: [],
    unreadCheckins: [], savedEdits: [], finishedShopping: [],
    ...seed,
  }
  const calls: string[] = []
  const listeners = new Set<(by: string | null) => void>()
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

  /** `recipeLines` is what usage and the ingredient delete guard read. Keeps it in step with a recipe. Matches by name (shortcut). */
  const syncRecipeLines = (recipe: Recipe, previousName = recipe.name) => {
    state.recipeLines = state.recipeLines.filter((l) => l.recipeName !== previousName)
    if (!recipe.deleted_at) {
      state.recipeLines.push(...recipe.recipe_ingredients.map((ri) => ({ ingredientId: ri.ingredient_id, recipeName: recipe.name })))
    }
  }

  const api: DataPort = {
    auth: track('auth', { currentUserId: () => state.userId }),
    household: track('household', {
      settings: () => state.household,
      saveSlots: (slots) => { state.household.slots = slots },
    }),
    recipes: track('recipes', {
      list: () => [...live(state.recipes)].sort((a, b) => a.name.localeCompare(b.name)),
      options: () => [...live(state.recipes)].sort((a, b) => a.name.localeCompare(b.name)).map((r) => ({ id: r.id, name: r.name, serves: r.serves })),
      planned: (recipeId) => {
        const cutoff = state.snapshot?.on_date
        return live(state.meals)
          .filter((m) => m.recipe_id === recipeId && (!cutoff || m.date > cutoff))
          .sort((a, b) => a.date.localeCompare(b.date) || a.slot.localeCompare(b.slot))
      },
      save: (input) => {
        const lines = input.lines.map((l) => {
          const ing = state.ingredients.find((i) => i.id === l.ingredient_id)
          return { ingredient_id: l.ingredient_id, qty_per_portion: l.qty_per_portion, ingredients: { name: ing?.name ?? '', unit: ing?.unit ?? 'g' } }
        })
        const existing = input.id ? state.recipes.find((r) => r.id === input.id) : undefined
        const previousName = existing?.name
        const target = existing ?? row.recipe({ name: input.name })
        Object.assign(target, { name: input.name, instructions: input.instructions, tags: input.tags, serves: input.serves, recipe_ingredients: lines })
        if (!existing) state.recipes.push(target)
        // shortcut: no unique-name check on recipes (the real RPC's rules are not known to the fake)
        syncRecipeLines(target, previousName)
      },
      createIngredient: (input) => {
        if (live(state.ingredients).some((i) => i.name.toLowerCase() === input.name.toLowerCase())) {
          throw new ApiError('duplicate key value violates unique constraint', '23505')
        }
        const created = row.ingredient({ name: input.name, unit: input.unit })
        state.ingredients.push(created)
        return created
      },
    }),
    plan: track('plan', {
      add: (input) => { state.meals.push(row.plannedMeal(input)) },
      move: (id, to) => {
        const m = state.meals.find((x) => x.id === id)
        if (m) Object.assign(m, to)
      },
      setPortions: (id, portions) => {
        const m = state.meals.find((x) => x.id === id)
        if (m) m.portions = portions
      },
      setCook: (id, cookId) => {
        const m = state.meals.find((x) => x.id === id)
        if (m) m.cook_id = cookId
      },
    }),
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
      saveEdits: (edits) => { state.savedEdits.push(edits) },
    }),
    shop: track('shop', {
      list: () =>
        live(state.shoppingItems).map((i) => {
          const ing = state.ingredients.find((x) => x.id === i.ingredient_id)
          return { ...i, ingredients: ing ? { name: ing.name, unit: ing.unit, category: ing.category } : null }
        }),
      addItem: (item) => {
        state.shoppingItems.push(row.shoppingItem(item))
      },
      setMealSkip: (mealId, skip) => {
        const m = state.meals.find((x) => x.id === mealId)
        if (m) m.skip_shopping = skip
      },
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
    checkins: track('checkins', {
      unread: () => [...state.unreadCheckins],
      // shortcut: the answer itself is not recorded; only whether the check-in was cleared
      answer: (mealId) => {
        const idx = state.unreadCheckins.findIndex((c) => c.planned_meals?.id === mealId)
        if (idx < 0) return false
        state.unreadCheckins.splice(idx, 1)
        return true
      },
      setNotCooked: (mealId, notCooked) => {
        const m = state.meals.find((x) => x.id === mealId)
        if (m) m.not_cooked = notCooked
        // the database trigger: "didn't cook" answers the meal's unread check-in
        if (notCooked) state.unreadCheckins = state.unreadCheckins.filter((c) => c.planned_meals?.id !== mealId)
      },
      saveMealLines: (mealId, lines: MealAmount[]) => {
        const m = state.meals.find((x) => x.id === mealId)
        const payload = mealLinesPayload(lines)
        if (m) m.planned_meal_lines = payload.map((l) => ({ ingredient_id: l.ingredient_id, qty_total: l.qty_total }))
      },
      slotEndTimes: () => ({ slots: state.household.slots, slot_end_times: state.household.slot_end_times }),
      saveSlotEndTimes: (times) => { state.household.slot_end_times = times },
      finishShopping: (onDate, batches, answers) => {
        state.finishedShopping.push({ onDate, batches, answers })
        state.unreadCheckins = []
      },
    }),
    live: {
      subscribeHouseholdEvents: (_topic: string, onEvent: (by: string | null) => void) => {
        listeners.add(onEvent)
        return () => { listeners.delete(onEvent) }
      },
    },
    trash: track('trash', {
      softDelete: (table, ids) => {
        if (table === 'ingredients') {
          for (const ingredientId of ids) {
            if (state.recipeLines.some((l) => l.ingredientId === ingredientId)) throw new ApiError('still referenced', '23503')
          }
          for (const i of state.ingredients) if (ids.includes(i.id)) i.deleted_at = NOW
        }
        if (table === 'recipes') {
          // a live planned meal still points at the recipe: the FK refuses, as in the database
          for (const id of ids) {
            if (live(state.meals).some((m) => m.recipe_id === id)) throw new ApiError('still referenced', '23503')
          }
          for (const r of state.recipes) if (ids.includes(r.id)) { r.deleted_at = NOW; syncRecipeLines(r) }
        }
        if (table === 'planned_meals') for (const m of state.meals) if (ids.includes(m.id)) m.deleted_at = NOW
        if (table === 'shopping_items') for (const i of state.shoppingItems) if (ids.includes(i.id)) i.deleted_at = NOW
        // shortcut: the other tables are not faked yet; add them with the first test that needs them
      },
      restore: (table, ids) => {
        if (table === 'ingredients') for (const i of state.ingredients) if (ids.includes(i.id)) i.deleted_at = null
        if (table === 'recipes') for (const r of state.recipes) if (ids.includes(r.id)) { r.deleted_at = null; syncRecipeLines(r) }
        if (table === 'planned_meals') for (const m of state.meals) if (ids.includes(m.id)) m.deleted_at = null
        if (table === 'shopping_items') for (const i of state.shoppingItems) if (ids.includes(i.id)) i.deleted_at = null
      },
    }),
  }

  return {
    ...api,
    state,
    calls,
    emitHouseholdEvent: (by) => { for (const l of listeners) l(by) },
    failNext: (call, error = new Error(`fake failure: ${call}`)) => void failures.set(call, error) }
}
