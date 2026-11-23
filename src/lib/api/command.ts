// Commands: a write plus the query keys it makes stale, declared in one place.
// Pages never call invalidateQueries. They call useCommand(someCommand) and the command says what it invalidates.
import { useMutation, useQueryClient, type QueryClient, type QueryKey, type UseMutationOptions } from '@tanstack/react-query'
import { useApi } from './context.tsx'
import type { DataPort } from './port.ts'

export type Command<I, O = void> = {
  /** Only for debugging and the mutation devtools. */
  name: string
  run: (api: DataPort, input: I) => Promise<O>
  /** Keys (prefixes) that are stale after the command ran. Use `keys.*` only. */
  invalidates: (input: I, output: O) => QueryKey[]
  /** 'success' (default) invalidates when the write succeeded; 'settled' also after a failure (use when a failed write may have partly applied). */
  when?: 'success' | 'settled'
}

export const defineCommand = <I, O = void>(c: Command<I, O>): Command<I, O> => c

export const invalidateKeys = (qc: QueryClient, keysToInvalidate: QueryKey[]) =>
  Promise.all(keysToInvalidate.map((queryKey) => qc.invalidateQueries({ queryKey }))).then(() => undefined)

/** Run a command outside React (tests, scripts): write, then invalidate and wait for the refetches. */
export async function runCommand<I, O>(qc: QueryClient, api: DataPort, cmd: Command<I, O>, input: I): Promise<O> {
  let out: O
  try {
    out = await cmd.run(api, input)
  } catch (e) {
    if (cmd.when === 'settled') await invalidateKeys(qc, cmd.invalidates(input, undefined as O))
    throw e
  }
  await invalidateKeys(qc, cmd.invalidates(input, out))
  return out
}

/**
 * useMutation for a command. Invalidation is fired (not awaited) before the caller's onSuccess, like the old
 * `onSuccess: () => { queryClient.invalidateQueries(...); onClose() }`. Extra options (onSuccess, onError) are for UI only.
 */
export function useCommand<I, O>(cmd: Command<I, O>, options: Omit<UseMutationOptions<O, Error, I>, 'mutationFn'> = {}) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation<O, Error, I>({
    ...options,
    mutationFn: (input) => cmd.run(api, input),
    onSuccess: (out, input, ctx, meta) => {
      if (cmd.when !== 'settled') void invalidateKeys(qc, cmd.invalidates(input, out))
      return options.onSuccess?.(out, input, ctx, meta)
    },
    onSettled: (out, err, input, ctx, meta) => {
      if (cmd.when === 'settled') void invalidateKeys(qc, cmd.invalidates(input, out as O))
      return options.onSettled?.(out, err, input, ctx, meta)
    },
  })
}
