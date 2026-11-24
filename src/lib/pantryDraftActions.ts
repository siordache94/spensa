// The pantry editor's one Save: the changed lines and any changed to-taste switches, then refresh the pantry.
// On-hand flags are written first because they are idempotent; retrying after a partial failure is safe.
import { useMutation, useQueryClient, type UseMutationOptions } from '@tanstack/react-query'
import type { PantryEdits } from '../domain/pantryEdits.ts'
import { defineCommand, runCommand } from './api/command.ts'
import { useApi } from './api/context.tsx'
import { keys } from './api/keys.ts'

export type PantryDraftSave = {
  edits: PantryEdits
  onHand: { id: string; onHand: boolean }[]
}

export const savePantryDraftCommand = defineCommand<PantryDraftSave>({
  name: 'pantry.saveDraft',
  run: async (api, { edits, onHand }) => {
    await Promise.all(onHand.map(({ id, onHand }) => api.ingredients.setOnHand(id, onHand)))
    if (edits.adjustments.length > 0 || edits.newBatches.length > 0 || edits.expiries.length > 0) {
      await api.pantry.saveEdits(edits)
    }
  },
  invalidates: () => [keys.pantry.all()],
  // A partial write still moved the pantry: refresh even when the save rejected.
  when: 'settled',
})

/**
 * Save for the editor, which leaves edit mode only after the refetch (so the amounts never flash back to the old ones).
 * Mirrors useSavePantryEdits, with the to-taste switches written in the same command.
 */
export function useSavePantryDraft(
  options: Omit<UseMutationOptions<void, Error, PantryDraftSave>, 'mutationFn'> = {},
) {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    ...options,
    mutationFn: (input: PantryDraftSave) => runCommand(queryClient, api, savePantryDraftCommand, input),
  })
}
