// Account aggregate: the user's own data export and account deletion. Pages import from here.
import { defineCommand } from './command.ts'

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

