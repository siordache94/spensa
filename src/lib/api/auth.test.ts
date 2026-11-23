import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { runCommand } from './command.ts'
import { INVITE_ONLY_MESSAGE, signIn, signOut, signUp } from './auth.ts'
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
