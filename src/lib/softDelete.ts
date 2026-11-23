import { supabase } from './supabase'

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

/** Soft-deletes rows by id (sets deleted_at/deleted_by on the server; children go with their parent). */
export const softDelete = (tbl: SoftTable, ids: string[]) => supabase.rpc('soft_delete', { tbl, ids })

/** Undo of softDelete: clears deleted_at on those rows and on the children that were deleted with them. */
export const restoreRows = (tbl: SoftTable, ids: string[]) => supabase.rpc('restore', { tbl, ids })
