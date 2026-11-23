// The seam. DataPort is everything the app asks of its backend, grouped per aggregate.
// Two adapters: supabaseAdapter.ts (production) and fakeAdapter.ts (in-memory, for tests).
// Rules: methods are plain async functions with plain arguments, they throw ApiError (never return {data, error}),
// and they carry no React or TanStack Query. Keep this as small as the pages need: add a method when a page needs it.
import type { Tables, TablesInsert } from '../database.types.ts'
import type { Day, MealAmount } from '../../domain/replay.ts'
import type { FinishAnswer } from '../../domain/checkinAnswers.ts'
import type { PantryEdits } from '../../domain/pantryEdits.ts'
import type { CheckinAnswer } from '../checkin.ts'

/** Thrown by every adapter. `code` is the Postgres error code when there is one (23505 unique, 23503 foreign key). */
export class ApiError extends Error {
  code: string | undefined
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

export type Ingredient = Tables<'ingredients'>
export type IngredientInput = TablesInsert<'ingredients'>

/** Tables a client may soft-delete from. Nothing in the app hard-deletes (docs/adr/0003-soft-delete-and-authorship.md). */
export type SoftTable =
  | 'ingredients'
  | 'recipes'
  | 'recipe_ingredients'
  | 'planned_meals'
  | 'batches'
  | 'adjustments'
  | 'snapshots'
  | 'shopping_items'

export type HouseholdSettings = Pick<Tables<'households'>, 'id' | 'timezone' | 'expiring_days' | 'horizon_days' | 'slots' | 'slot_end_times'>

export type Recipe = Tables<'recipes'> & {
  recipe_ingredients: {
    ingredient_id: string
    qty_per_portion: number | null // null = to taste
    ingredients: { name: string; unit: Tables<'ingredients'>['unit'] }
  }[]
}
export type RecipeOption = Pick<Tables<'recipes'>, 'id' | 'name' | 'serves'>
/** What the recipe form saves. `id` null = a new recipe. `lines` are per portion; qty_per_portion null = to taste. */
export type RecipeSave = {
  id: string | null
  name: string
  instructions: string
  tags: string[]
  serves: number
  lines: { ingredient_id: string; qty_per_portion: number | null }[]
}
export type PlannedMeal = Tables<'planned_meals'>
export type PlannedMealInput = TablesInsert<'planned_meals'>

export type PantryMealRow = Tables<'planned_meals'> & {
  planned_meal_lines: { ingredient_id: string; qty_total: number | string | null }[]
  recipes: { id: string; name: string; recipe_ingredients: { ingredient_id: string; qty_per_portion: number | string | null }[] } | null
}
export type PantrySnapshotRow = Tables<'snapshots'> & { snapshot_batches: { batch_id: string; qty: number | string }[] }

/** A row of the shopping list with its ingredient (null for free text). */
export type ShoppingItemRow = Tables<'shopping_items'> & { ingredients: Pick<Tables<'ingredients'>, 'name' | 'unit' | 'category'> | null }
/** What a manual list item is: an ingredient from the catalogue, or free text (one of the two). */
export type ShoppingItemInput = Pick<TablesInsert<'shopping_items'>, 'ingredient_id' | 'text'>

/** An unread check-in with its planned meal (null when the meal was deleted). */
export type UnreadCheckinRow = {
  id: string
  created_at: string
  planned_meals: { id: string; date: string; slot: string; portions: number; cook_id: string | null; recipes: { name: string } | null } | null
}
export type SlotSettings = Pick<Tables<'households'>, 'slots' | 'slot_end_times'>
/** One batch of the "Done shopping" snapshot. */
export type SnapshotBatch = { batch_id: string; qty: number }

/** What the pantry needs from the database: raw rows, soft-deleted ones already hidden. */
export type PantryRows = {
  batches: Tables<'batches'>[]
  meals: PantryMealRow[]
  adjustments: Tables<'adjustments'>[]
  /** The latest snapshot, if any. */
  snapshot: PantrySnapshotRow | undefined
  ingredients: Tables<'ingredients'>[]
}

// batchId and addedAt are generated when ticking, so a retry can't double-insert.
export type Buy = {
  ingredientId: string
  name: string
  unit: Tables<'ingredients'>['unit']
  qty: number
  expiresOn: Day | null
  shoppingItemId?: string
  batchId: string
  addedAt: string
}

export interface DataPort {
  auth: {
    /** From the locally stored session, so it works offline. */
    currentUserId(): Promise<string | null>
  }
  household: {
    settings(): Promise<HouseholdSettings>
    /** The meal slots, in day order. */
    saveSlots(slots: string[]): Promise<void>
  }
  recipes: {
    list(): Promise<Recipe[]>
    /** Id, name and serves of every live recipe, for the planner's recipe picker. */
    options(): Promise<RecipeOption[]>
    /** Planned meals of one recipe after the latest snapshot (all of them when there is none). */
    planned(recipeId: string): Promise<PlannedMeal[]>
    /** Throws ApiError with the server code when the RPC refuses. */
    save(input: RecipeSave): Promise<void>
    /** Adds an ingredient from the recipe form's inline picker. Throws ApiError code 23505 when the name is taken. */
    createIngredient(row: Pick<IngredientInput, 'name' | 'unit'>): Promise<Ingredient>
  }
  plan: {
    /** Adds a planned meal (a copy, or a new one from the planner). */
    add(row: PlannedMealInput): Promise<void>
    move(id: string, to: { date: string; slot: string; position: number }): Promise<void>
    setPortions(id: string, portions: number): Promise<void>
    /** null = nobody cooks it. */
    setCook(id: string, cookId: string | null): Promise<void>
  }
  ingredients: {
    list(): Promise<Ingredient[]>
    /** Names of the live recipes that use this ingredient. */
    usage(ingredientId: string): Promise<string[]>
    /** `id` set = update, null = insert. Throws ApiError code 23505 when the name is taken. */
    save(id: string | null, row: IngredientInput): Promise<void>
    setOnHand(id: string, onHand: boolean): Promise<void>
  }
  pantry: {
    rows(): Promise<PantryRows>
    /** Adjustments, new batches and expiry fixes from the pantry editor. Only what changed is sent. */
    saveEdits(edits: PantryEdits): Promise<void>
  }
  shop: {
    /** The shopping list items, oldest first, bought and checked ones included (the page filters). */
    list(): Promise<ShoppingItemRow[]>
    /** Adds a manual item (an ingredient or free text). */
    addItem(item: ShoppingItemInput): Promise<void>
    /** Whether a meal is left off the trip's shopping (it is still planned and eaten). */
    setMealSkip(mealId: string, skip: boolean): Promise<void>
    /** Idempotent on batchId. `itemFound` is false when the list item was already deleted by the partner. */
    buy(b: Buy): Promise<{ itemFound: boolean }>
    setChecked(itemId: string, checked: boolean): Promise<void>
    unbuy(batchId: string): Promise<void>
  }
  checkins: {
    /** Unread check-ins of the household, oldest first. */
    unread(): Promise<UnreadCheckinRow[]>
    /** Answers one check-in. True when it cleared an unread check-in, false when already answered (retry-safe). */
    answer(mealId: string, answer: CheckinAnswer): Promise<boolean>
    /** "Didn't cook" on or off. Turning it on also answers the meal's unread check-in (a database trigger). */
    setNotCooked(mealId: string, notCooked: boolean): Promise<void>
    /** Replaces a meal's own amounts. An empty array removes them (the meal follows its recipe again). */
    saveMealLines(mealId: string, lines: MealAmount[]): Promise<void>
    /** The slots with their stored end times. */
    slotEndTimes(): Promise<SlotSettings>
    /** End time ('HH:MM') per slot name. */
    saveSlotEndTimes(times: Record<string, string>): Promise<void>
    /** "Done shopping": snapshot + answers in one transaction. */
    finishShopping(onDate: Day, batches: SnapshotBatch[], answers: FinishAnswer[]): Promise<void>
  }
  live: {
    /** Calls `onEvent` for every change to the household's events row (`by` = who wrote it, null if unknown). Returns the unsubscribe. */
    subscribeHouseholdEvents(topic: string, onEvent: (by: string | null) => void): () => void
  }
  trash: {
    /** Soft-deletes rows (children go with their parent). Throws ApiError code 23503 when something live still uses them. */
    softDelete(table: SoftTable, ids: string[]): Promise<void>
    /** Undo of softDelete. */
    restore(table: SoftTable, ids: string[]): Promise<void>
  }
}
