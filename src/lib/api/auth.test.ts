import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { runCommand } from './command.ts'
import { INVITE_ONLY_MESSAGE, readAuthRedirectError, signIn, signOut, signUp, stripAuthRedirectError } from './auth.ts'
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
