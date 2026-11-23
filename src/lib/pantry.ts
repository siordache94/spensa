// Moved to ./api/pantry.ts. Re-exported so pages that haven't migrated yet keep their import path.
export { fetchPantry, invalidatePantry, localDay, today, usePantry } from './api/pantry.ts'
