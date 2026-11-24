// The Auth page's screens and the transitions between them, without React or Supabase (MR-015, MR-039).
// The page keeps the email and password; this module only decides what it shows next.

export type AuthScreen = 'signIn' | 'signUp' | 'checkEmail' | 'resetRequest' | 'resetSent' | 'setPassword' | 'signedIn'

/** What a sign-up attempt produced, from Supabase's { user, session, error }. */
export type SignUpOutcome = 'signedIn' | 'checkEmail' | 'refused'

export type AuthEvent =
  | { type: 'signedUp'; outcome: SignUpOutcome }
  | { type: 'recovery' }
  | { type: 'resetRequested' }
  | { type: 'back' }

/** An invite link opens sign-up; everything else opens sign-in. */
export function initialScreen(inviteCode: string): AuthScreen {
  return inviteCode ? 'signUp' : 'signIn'
}

/**
 * With "Confirm email" on, Supabase creates the user but returns no session: the account is waiting on the email.
 * With it off, the session arrives and sign-in proceeds. An error, or neither a user nor a session, is a refusal.
 */
export function signUpOutcome(input: {
  user: { id: string } | null
  session: unknown | null
  error: { message: string } | null
}): SignUpOutcome {
  if (input.error) return 'refused'
  if (input.session) return 'signedIn'
  return input.user ? 'checkEmail' : 'refused'
}

/** The next screen after an auth event. A refusal leaves the form as it is, with its error. */
export function reduceAuth(screen: AuthScreen, event: AuthEvent): AuthScreen {
  switch (event.type) {
    case 'signedUp':
      return event.outcome === 'refused' ? screen : event.outcome
    case 'recovery':
      return 'setPassword'
    case 'resetRequested':
      return 'resetSent'
    case 'back':
      return 'signIn'
  }
}
