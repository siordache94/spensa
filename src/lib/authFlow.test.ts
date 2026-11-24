import { describe, expect, it } from 'vitest'
import { initialScreen, reduceAuth, signUpOutcome, type AuthScreen } from './authFlow.ts'

describe('signUpOutcome', () => {
  it('needs confirmation when Supabase returns a user but no session (Confirm email on)', () => {
    expect(signUpOutcome({ user: { id: 'u1' }, session: null, error: null })).toBe('checkEmail')
  })

  it('is signed in when a session comes back (Confirm email off)', () => {
    expect(signUpOutcome({ user: { id: 'u1' }, session: { access_token: 't' }, error: null })).toBe('signedIn')
  })

  it('is refused on an error, even if a stale user came along', () => {
    expect(signUpOutcome({ user: null, session: null, error: { message: 'invite-only' } })).toBe('refused')
    expect(signUpOutcome({ user: { id: 'u1' }, session: null, error: { message: 'invite-only' } })).toBe('refused')
  })

  it('is refused when nothing was created', () => {
    expect(signUpOutcome({ user: null, session: null, error: null })).toBe('refused')
  })
})

describe('reduceAuth', () => {
  const from = (screen: AuthScreen, outcome: 'signedIn' | 'checkEmail' | 'refused') =>
    reduceAuth(screen, { type: 'signedUp', outcome })

  it('starts on sign-up from an invite link, otherwise sign-in', () => {
    expect(initialScreen('INVITE1')).toBe('signUp')
    expect(initialScreen('')).toBe('signIn')
  })

  it('a sign-up that needs confirmation shows check email', () => {
    expect(from('signUp', 'checkEmail')).toBe('checkEmail')
  })

  it('a sign-up with a session is signed in', () => {
    expect(from('signUp', 'signedIn')).toBe('signedIn')
  })

  it('a refused sign-up leaves the form on screen', () => {
    expect(from('signUp', 'refused')).toBe('signUp')
  })

  it('a recovery link shows set a new password, from any screen', () => {
    expect(reduceAuth('signIn', { type: 'recovery' })).toBe('setPassword')
    expect(reduceAuth('signedIn', { type: 'recovery' })).toBe('setPassword')
  })

  it('a reset request shows the reset-sent panel', () => {
    expect(reduceAuth('resetRequest', { type: 'resetRequested' })).toBe('resetSent')
  })

  it('back always returns to sign in', () => {
    expect(reduceAuth('checkEmail', { type: 'back' })).toBe('signIn')
    expect(reduceAuth('resetSent', { type: 'back' })).toBe('signIn')
    expect(reduceAuth('setPassword', { type: 'back' })).toBe('signIn')
    expect(reduceAuth('resetRequest', { type: 'back' })).toBe('signIn')
  })
})
