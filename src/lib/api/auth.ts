// Auth aggregate: who is signed in (read from the local session, so it works offline), and sign in, sign up and out.
import { useQuery } from '@tanstack/react-query'
import { defineCommand } from './command.ts'
import { useApi } from './context.tsx'
import { keys } from './keys.ts'
import { ApiError } from './port.ts'
import { readTrust } from '../deviceTrust.ts'

export type { AuthSession } from './port.ts'

/** Shown when a sign-up is refused: the server only allows allowlisted emails or a valid invite code. */
export const INVITE_ONLY_MESSAGE = 'Spensa is invite-only. Ask a household member for an invite link.'

const AUTH_ERROR_KEYS = ['error', 'error_code', 'error_description'] as const

/** Supabase sends a refused OAuth sign-in back in the query string and the hash. Returns the friendly message, or null. */
export function readAuthRedirectError(search: string, hash: string): string | null {
  for (const source of [search, hash]) {
    const params = new URLSearchParams(source.replace(/^[?#]/, ''))
    const description = params.get('error_description') ?? ''
    const error = params.get('error') ?? ''
    if (!description && !error) continue
    const text = description || error
    return /invite-only/i.test(text) ? INVITE_ONLY_MESSAGE : text
  }
  return null
}

/** Removes only the auth error params from the query and the hash. Other params (invite, Supabase's session tokens) stay. */
export function stripAuthRedirectError(search: string, hash: string): { search: string; hash: string } {
  if (readAuthRedirectError(search, hash) === null) return { search, hash }
  const strip = (source: string) => {
    const params = new URLSearchParams(source.replace(/^[?#]/, ''))
    if (!AUTH_ERROR_KEYS.some((key) => params.has(key))) return source
    for (const key of AUTH_ERROR_KEYS) params.delete(key)
    const text = params.toString()
    return text ? `${source[0] === '#' ? '#' : '?'}${text}` : ''
  }
  return { search: strip(search), hash: strip(hash) }
}

// ---- Queries ---------------------------------------------------------------------------------------------------
/**
 * The signed-in user's id. undefined while it is being read, null when signed out. Stays until sign-out.
 * Offline after the access token expired the adapter has no session (MR-008); the device-trust record still knows
 * who was signed in, so partner highlighting and cook actions keep working in the saved shell.
 */
export function useMyId(): string | null | undefined {
  const api = useApi()
  return useQuery({
    queryKey: keys.auth.uid(),
    staleTime: Infinity,
    queryFn: async () => (await api.auth.currentUserId()) ?? readTrust()?.userId ?? null,
  }).data
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

export const signUp = defineCommand<{ email: string; password: string; inviteCode: string }, { needsConfirmation: boolean }>({
  name: 'auth.signUp',
  run: async (api, { email, password, inviteCode }) => {
    try {
      return await api.auth.signUp(email.trim(), password, inviteCode.trim() || undefined)
    } catch (e) {
      if (e instanceof ApiError && (e.status === 403 || e.message.includes('invite-only'))) throw new Error(INVITE_ONLY_MESSAGE)
      throw e
    }
  },
  invalidates: () => [],
})

/** Sends the sign-up confirmation email again (MR-015). */
export const resendConfirmation = defineCommand<{ email: string }>({
  name: 'auth.resendConfirmation',
  run: (api, { email }) => api.auth.resendConfirmation(email.trim()),
  invalidates: () => [],
})

/** Sends the password reset email; the link opens this app (MR-039). */
export const requestPasswordReset = defineCommand<{ email: string }>({
  name: 'auth.requestPasswordReset',
  run: (api, { email }) => api.auth.requestPasswordReset(email.trim(), `${window.location.origin}${window.location.pathname}`),
  invalidates: () => [],
})

/** Sets the password of the recovery session, then ends it: the user signs in normally with the new password. */
export const setNewPassword = defineCommand<{ password: string }>({
  name: 'auth.setNewPassword',
  run: async (api, { password }) => {
    await api.auth.updatePassword(password)
    await api.auth.signOut('local')
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
