import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { runCommand } from './command.ts'
import { INVITE_ONLY_MESSAGE, readAuthRedirectError, resendConfirmation, setNewPassword, signIn, signOut, signUp, stripAuthRedirectError } from './auth.ts'
import { createFakeAdapter } from './fakeAdapter.ts'
import { ApiError } from './port.ts'

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

describe('auth commands on the fake adapter', () => {
  it('a sign-up the server refuses with 403 gets the invite-only message', async () => {
    const api = createFakeAdapter()
    api.failNext('auth.signUp', new ApiError('forbidden', undefined, 403))

    await expect(runCommand(newClient(), api, signUp, { email: 'a@b.c', password: 'password1', inviteCode: '' })).rejects.toThrow(INVITE_ONLY_MESSAGE)
  })

  it('a sign-up refused for "invite-only" in the message gets the same message', async () => {
    const api = createFakeAdapter()
    api.failNext('auth.signUp', new ApiError('Database error: invite-only household'))

    await expect(runCommand(newClient(), api, signUp, { email: 'a@b.c', password: 'password1', inviteCode: 'X' })).rejects.toThrow(INVITE_ONLY_MESSAGE)
  })

  it('other sign-up errors keep the server message', async () => {
    const api = createFakeAdapter()
    api.failNext('auth.signUp', new ApiError('Password is too weak', undefined, 422))

    await expect(runCommand(newClient(), api, signUp, { email: 'a@b.c', password: 'password1', inviteCode: '' })).rejects.toThrow('Password is too weak')
  })

  it('sign-in reaches the port and a sign-in error keeps its message', async () => {
    const api = createFakeAdapter()
    await runCommand(newClient(), api, signIn, { email: ' a@b.c ', password: 'password1' })
    expect(api.calls).toContain('auth.signIn')

    api.failNext('auth.signIn', new ApiError('Invalid login credentials'))
    await expect(runCommand(newClient(), api, signIn, { email: 'a@b.c', password: 'nope' })).rejects.toThrow('Invalid login credentials')
  })

  it('sign-out clears the session', async () => {
    const api = createFakeAdapter({ userId: 'u1' })
    await expect(api.auth.session()).resolves.toEqual({ userId: 'u1', metadata: {} })

    await runCommand(newClient(), api, signOut, undefined)

    expect(await api.auth.currentUserId()).toBeNull()
    await expect(api.auth.session()).resolves.toBeNull()
  })
})

describe('sign-up confirmation and password recovery on the fake adapter', () => {
  it('reports needsConfirmation when the fake has Confirm email on, and leaves no session', async () => {
    const api = createFakeAdapter({ signUpNeedsConfirmation: true })

    await expect(runCommand(newClient(), api, signUp, { email: ' a@b.c ', password: 'password1', inviteCode: '' }))
      .resolves.toEqual({ needsConfirmation: true })
    expect(api.state.signUpEmails).toEqual(['a@b.c'])
    expect(await api.auth.session()).toBeNull()
  })

  it('reports no confirmation need when the fake auto-confirms', async () => {
    const api = createFakeAdapter()

    await expect(runCommand(newClient(), api, signUp, { email: 'a@b.c', password: 'password1', inviteCode: '' }))
      .resolves.toEqual({ needsConfirmation: false })
  })

  it('resendConfirmation records the email and needs no invite code', async () => {
    const api = createFakeAdapter()

    await runCommand(newClient(), api, resendConfirmation, { email: ' a@b.c ' })

    expect(api.state.resendEmails).toEqual(['a@b.c'])
  })

  it('records a reset request and applies the new password', async () => {
    const api = createFakeAdapter()

    await api.auth.requestPasswordReset('a@b.c', 'https://spensa.test/')
    expect(api.state.resetRequests).toEqual([{ email: 'a@b.c', redirectTo: 'https://spensa.test/' }])

    await api.auth.updatePassword('newpassword')
    expect(api.state.password).toBe('newpassword')
  })

  it('refuses a password change without a session', async () => {
    const api = createFakeAdapter({ userId: null })
    await expect(api.auth.updatePassword('newpassword')).rejects.toThrow('not signed in')
  })

  it('setNewPassword applies the password and ends the recovery session', async () => {
    const api = createFakeAdapter({ password: 'password1', userId: 'u1' })

    await runCommand(newClient(), api, setNewPassword, { password: 'newpassword' })

    expect(api.state.password).toBe('newpassword')
    await expect(api.auth.session()).resolves.toBeNull()
  })

  it('fires the recovery callback until it is unsubscribed', () => {
    const api = createFakeAdapter()
    let calls = 0
    const off = api.live.onPasswordRecovery(() => { calls += 1 })

    api.emitPasswordRecovery()
    expect(calls).toBe(1)

    off()
    api.emitPasswordRecovery()
    expect(calls).toBe(1)
  })
})

describe('readAuthRedirectError', () => {
  const invite = 'error=access_denied&error_code=&error_description=Spensa+is+invite-only.+Ask+a+household+member+for+an+invite+link.'
  const hash = invite + '&sb='

  it('reads the query string', () => {
    expect(readAuthRedirectError('?' + invite, '')).toBe(INVITE_ONLY_MESSAGE)
  })

  it('reads the hash', () => {
    expect(readAuthRedirectError('', '#' + hash)).toBe(INVITE_ONLY_MESSAGE)
  })

  it('reads when the error is in both', () => {
    expect(readAuthRedirectError('?' + invite, '#' + hash)).toBe(INVITE_ONLY_MESSAGE)
  })

  it('decodes + as spaces in a non-invite description', () => {
    expect(readAuthRedirectError('?error=server_error&error_description=Try+again+later', '')).toBe('Try again later')
  })

  it('falls back to error when there is no description', () => {
    expect(readAuthRedirectError('', '#error=access_denied')).toBe('access_denied')
  })

  it('returns null when there is no error', () => {
    expect(readAuthRedirectError('?invite=abc', '#access_token=x&type=recovery')).toBeNull()
    expect(readAuthRedirectError('', '')).toBeNull()
  })

  it('passes a non-invite error through', () => {
    expect(readAuthRedirectError('', '#error=access_denied&error_description=User+denied+access')).toBe('User denied access')
  })
})

describe('stripAuthRedirectError', () => {
  it('removes only the error params and keeps invite and session params', () => {
    const search = '?invite=abc&error=access_denied&error_description=Spensa+is+invite-only.'
    const hash = '#error=access_denied&error_description=Spensa+is+invite-only.&sb='
    expect(stripAuthRedirectError(search, hash)).toEqual({ search: '?invite=abc', hash: '#sb=' })
  })

  it('drops the hash when nothing is left in it', () => {
    expect(stripAuthRedirectError('?error=access_denied', '#error=access_denied&sb=')).toEqual({ search: '', hash: '#sb=' })
    expect(stripAuthRedirectError('', '#error=x')).toEqual({ search: '', hash: '' })
  })

  it('leaves the URL alone when there is no error', () => {
    expect(stripAuthRedirectError('?invite=a%20b', '#access_token=t')).toEqual({ search: '?invite=a%20b', hash: '#access_token=t' })
  })
})
