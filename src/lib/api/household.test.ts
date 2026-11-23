import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { runCommand } from './command.ts'
import { createFakeAdapter } from './fakeAdapter.ts'
import { createHousehold, joinHousehold, rotateInviteCode, saveSlots, saveYourName, updateHousehold } from './household.ts'
import { keys } from './keys.ts'

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

/** Put a query in the cache so we can see whether a command made it stale. */
async function prime<T>(qc: QueryClient, key: readonly unknown[], data: T) {
  await qc.prefetchQuery({ queryKey: key, queryFn: () => data })
  expect(qc.getQueryState(key)?.isInvalidated).toBe(false)
}
const stale = (qc: QueryClient, key: readonly unknown[]) => qc.getQueryState(key)?.isInvalidated

describe('household commands on the fake adapter', () => {
  it('saveSlots writes the slots and invalidates household settings and the pantry', async () => {
    const api = createFakeAdapter()
    const qc = newClient()
    await prime(qc, keys.household.settings(), {})
    await prime(qc, keys.pantry.all(), {})
    await prime(qc, keys.ingredients.all(), [])

    await runCommand(qc, api, saveSlots, { slots: ['breakfast', 'dinner'] })

    expect(api.state.household.slots).toEqual(['breakfast', 'dinner'])
    expect(stale(qc, keys.household.settings())).toBe(true)
    expect(stale(qc, keys.pantry.all())).toBe(true)
    expect(stale(qc, keys.ingredients.all())).toBe(false)
  })

  it('updateHousehold writes only the given fields and invalidates settings, not the pantry', async () => {
    const api = createFakeAdapter()
    const qc = newClient()
    await prime(qc, keys.household.settings(), {})
    await prime(qc, keys.pantry.all(), {})

    await runCommand(qc, api, updateHousehold, { horizon_days: 10, expiry_reminder_days: 0 })

    expect(api.state.household).toMatchObject({ horizon_days: 10, expiry_reminder_days: 0, expiring_days: 3 })
    expect(stale(qc, keys.household.settings())).toBe(true)
    expect(stale(qc, keys.pantry.all())).toBe(false)
  })

  it('rotateInviteCode changes the code and invalidates the whole household prefix', async () => {
    const api = createFakeAdapter()
    const qc = newClient()
    await prime(qc, keys.household.settings(), {})
    const before = api.state.householdRow?.invite_code

    await runCommand(qc, api, rotateInviteCode, undefined)

    expect(api.state.householdRow?.invite_code).not.toBe(before)
    expect(stale(qc, keys.household.settings())).toBe(true)
  })

  it('a refused join gives the plain message and invalidates nothing', async () => {
    const api = createFakeAdapter()
    const qc = newClient()
    await prime(qc, keys.household.all(), null)

    await expect(runCommand(qc, api, joinHousehold, { code: 'WRONG', displayName: undefined })).rejects.toThrow(
      "That invite code doesn't match any household.",
    )
    expect(stale(qc, keys.household.all())).toBe(false)
  })

  it('an accepted join invalidates the household row', async () => {
    // the fake only knows the code of the household that exists: the joiner's cached row is still null
    const api = createFakeAdapter({ householdRow: { id: 'h1', name: 'Casa', invite_code: 'JOIN1' } })
    const qc = newClient()
    await prime(qc, keys.household.all(), null)

    await runCommand(qc, api, joinHousehold, { code: 'JOIN1', displayName: 'Ann' })
    expect(stale(qc, keys.household.all())).toBe(true)
  })

  it('createHousehold makes the household row and invalidates it; an unknown failure gets the generic message', async () => {
    const api = createFakeAdapter({ householdRow: null })
    const qc = newClient()
    await prime(qc, keys.household.all(), null)

    await runCommand(qc, api, createHousehold, { name: 'Casa Rossi', displayName: undefined })
    expect(api.state.householdRow?.name).toBe('Casa Rossi')
    expect(stale(qc, keys.household.all())).toBe(true)

    api.failNext('household.create', new Error('database exploded'))
    await expect(runCommand(qc, api, createHousehold, { name: 'x', displayName: undefined })).rejects.toThrow('Something went wrong. Try again.')
  })

  it('saveYourName writes the member name and invalidates the members list only', async () => {
    const api = createFakeAdapter({ members: [{ user_id: 'u1', display_name: 'Old' }] })
    const qc = newClient()
    await prime(qc, keys.household.members(), [])
    await prime(qc, keys.household.settings(), {})

    await runCommand(qc, api, saveYourName, { userId: 'u1', displayName: 'Ann' })

    expect(api.state.members[0].display_name).toBe('Ann')
    expect(stale(qc, keys.household.members())).toBe(true)
    expect(stale(qc, keys.household.settings())).toBe(false)
  })
})
