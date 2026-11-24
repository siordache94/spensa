// Everything on this device that belongs to the signed-in household, in one teardown. Device preferences (theme,
// density, prompt dismissals) are not household data and stay.
import type { QueryClient } from '@tanstack/react-query'
import { clearTrust } from './deviceTrust.ts'
import { clearPantryDrafts } from './pantryDraft.ts'
import { saveAcked } from './trip.ts'

/** The query cache is also written to localStorage by the persister in main.tsx, which registers how to remove it. */
let removePersistedCopy: () => void = () => {}

/** Called once from main.tsx, where the persister lives. */
export function registerPersistedCopyRemover(remove: () => void): void {
  removePersistedCopy = remove
}

/**
 * Clears the household data kept on this device: the trust record of who was signed in, any unsaved pantry draft, the
 * whole query cache (household rows, the remembered user id and the partner-ack highlights) and its persisted copy. Call
 * this on an explicit sign-out, account deletion and a server-confirmed invalid session, never on a transient null
 * session while offline (MR-007).
 */
export function clearLocalData(queryClient: Pick<QueryClient, 'clear'>): void {
  clearTrust()
  clearPantryDrafts()
  removePersistedCopy()
  queryClient.clear()
  saveAcked([])
}
