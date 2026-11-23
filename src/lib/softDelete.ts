import { supabaseAdapter } from './api/supabaseAdapter.ts'
import type { SoftTable } from './api/port.ts'

export type { SoftTable }

// Legacy wrappers for pages that haven't migrated yet. They keep the old `{ error }` return shape.
// New code: api.trash.softDelete / api.trash.restore through a command (see src/lib/api/README.md).
const wrap = async (run: () => Promise<void>) => {
  try {
    await run()
    return { error: null }
  } catch (e) {
    return { error: e as Error & { code?: string } }
  }
}

/** Soft-deletes rows by id (sets deleted_at/deleted_by on the server; children go with their parent). */
export const softDelete = (tbl: SoftTable, ids: string[]) => wrap(() => supabaseAdapter.trash.softDelete(tbl, ids))

/** Undo of softDelete: clears deleted_at on those rows and on the children that were deleted with them. */
export const restoreRows = (tbl: SoftTable, ids: string[]) => wrap(() => supabaseAdapter.trash.restore(tbl, ids))
