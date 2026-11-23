// Account aggregate: the user's own data export and account deletion. Pages import from here.
import { useQueryClient } from '@tanstack/react-query'
import { defineCommand, useCommand } from './command.ts'
import { useApi } from './context.tsx'

/** The JSON of everything the household holds about the user (the page saves it as a file). */
export const exportMyData = defineCommand<void, unknown>({
  name: 'account.exportData',
  run: (api) => api.account.exportData(),
  invalidates: () => [],
})

/** Deletes the account on the server. Nothing local is invalidated: the caller clears the cache and signs out. */
export const deleteAccount = defineCommand<void>({
  name: 'account.delete',
  run: (api) => api.account.deleteAccount(),
  invalidates: () => [],
})

/**
 * deleteAccount, then the local side: the cache is cleared and this device signs out (the server session is already
 * gone, so the sign-out is local only).
 */
export function useDeleteAccount(options: { onError?: (e: Error) => void } = {}) {
  const api = useApi()
  const qc = useQueryClient()
  return useCommand(deleteAccount, {
    ...options,
    onSuccess: () => {
      qc.clear()
      void api.auth.signOut('local')
    },
  })
}
