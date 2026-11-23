import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { deleteAccount, exportMyData } from './account.ts'
import { runCommand } from './command.ts'
import { createFakeAdapter } from './fakeAdapter.ts'

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

describe('account commands on the fake adapter', () => {
  it('exportMyData returns what the port returns', async () => {
    const api = createFakeAdapter({ userId: 'u1' })
    await expect(runCommand(newClient(), api, exportMyData, undefined)).resolves.toEqual({ user: 'u1' })
  })

  it('deleteAccount calls the port, and a failure propagates', async () => {
    const api = createFakeAdapter()
    api.failNext('account.deleteAccount')
    await expect(runCommand(newClient(), api, deleteAccount, undefined)).rejects.toThrow()
    await runCommand(newClient(), api, deleteAccount, undefined)
    expect(api.calls).toEqual(['account.deleteAccount', 'account.deleteAccount'])
  })
})
