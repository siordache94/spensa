// Auth aggregate: who is signed in (read from the local session, so it works offline), and sign in, sign up and out.
import { useQuery } from '@tanstack/react-query'
import { defineCommand } from './command.ts'
import { useApi } from './context.tsx'
import { keys } from './keys.ts'
import { ApiError } from './port.ts'

export type { AuthSession } from './port.ts'

/** Shown when a sign-up is refused: the server only allows allowlisted emails or a valid invite code. */
export const INVITE_ONLY_MESSAGE = 'Spensa is invite-only. Ask a household member for an invite link.'

// ---- Queries ---------------------------------------------------------------------------------------------------
/** The signed-in user's id. undefined while it is being read, null when signed out. Stays until sign-out. */
export function useMyId(): string | null | undefined {
  const api = useApi()
  return useQuery({ queryKey: keys.auth.uid(), staleTime: Infinity, queryFn: () => api.auth.currentUserId() }).data
}

/** The locally stored session (its metadata holds the name and invite code from the sign-up form). */
export function useAuthSession() {
  const api = useApi()
  return useQuery({ queryKey: keys.auth.session(), queryFn: () => api.auth.session() })
}

// ---- Commands --------------------------------------------------------------------------------------------------
export const signIn = defineCommand<{ email: string; password: string }>({
  name: 'auth.signIn',
  run: (api, { email, password }) => api.auth.signIn(email.trim(), password),
  invalidates: () => [],
})

export const signUp = defineCommand<{ email: string; password: string; inviteCode: string }>({
  name: 'auth.signUp',
  run: async (api, { email, password, inviteCode }) => {
    try {
      await api.auth.signUp(email.trim(), password, inviteCode.trim() || undefined)
    } catch (e) {
      if (e instanceof ApiError && (e.status === 403 || e.message.includes('invite-only'))) throw new Error(INVITE_ONLY_MESSAGE)
      throw e
    }
  },
  invalidates: () => [],
})

export const signInWithGoogle = defineCommand<void>({
  name: 'auth.signInWithGoogle',
  run: (api) => api.auth.signInWithGoogle(window.location.href),
  invalidates: () => [],
})

/** Global sign-out. Pages that also clear the cache pass their own onSuccess to useCommand. */
export const signOut = defineCommand<void>({
  name: 'auth.signOut',
  run: (api) => api.auth.signOut('global'),
  invalidates: () => [],
})
