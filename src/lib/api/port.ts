// The seam. DataPort is everything the app asks of its backend, grouped per aggregate.
// Two adapters: supabaseAdapter.ts (production) and fakeAdapter.ts (in-memory, for tests).
// Rules: methods are plain async functions with plain arguments, they throw ApiError (never return {data, error}),
// and they carry no React or TanStack Query. Keep this as small as the pages need: add a method when a page needs it.
import type { Tables, TablesInsert } from '../database.types.ts'
import type { Day } from '../../domain/replay.ts'

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

export type PantryMealRow = Tables<'planned_meals'> & {
  planned_meal_lines: { ingredient_id: string; qty_total: number | string | null }[]
  recipes: { id: string; name: string; recipe_ingredients: { ingredient_id: string; qty_per_portion: number | string | null }[] } | null
}
export type PantrySnapshotRow = Tables<'snapshots'> & { snapshot_batches: { batch_id: string; qty: number | string }[] }

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
  }
  shop: {
    /** Idempotent on batchId. `itemFound` is false when the list item was already deleted by the partner. */
    buy(b: Buy): Promise<{ itemFound: boolean }>
    setChecked(itemId: string, checked: boolean): Promise<void>
    unbuy(batchId: string): Promise<void>
  }
  trash: {
    /** Soft-deletes rows (children go with their parent). Throws ApiError code 23503 when something live still uses them. */
    softDelete(table: SoftTable, ids: string[]): Promise<void>
    /** Undo of softDelete. */
    restore(table: SoftTable, ids: string[]): Promise<void>
  }
}
