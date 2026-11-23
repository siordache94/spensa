import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { runCommand } from './command.ts'
import { createFakeAdapter } from './fakeAdapter.ts'
import { keys } from './keys.ts'
import { savePushPrefs, sendTestNotification } from './push.ts'
import { ApiError } from './port.ts'

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
async function prime<T>(qc: QueryClient, key: readonly unknown[], data: T) {
  await qc.prefetchQuery({ queryKey: key, queryFn: () => data })
  expect(qc.getQueryState(key)?.isInvalidated).toBe(false)
}
const stale = (qc: QueryClient, key: readonly unknown[]) => qc.getQueryState(key)?.isInvalidated

const prefs = { list_changes: true, meal_checkins: false, expiry_time: '09:00' }

describe('push commands on the fake adapter', () => {
  it('savePushPrefs stores the prefs and invalidates every prefs query', async () => {
    const api = createFakeAdapter()
    const qc = newClient()
    await prime(qc, keys.push.prefs('u1'), prefs)

    await runCommand(qc, api, savePushPrefs, prefs)

    expect(api.state.prefs).toEqual(prefs)
    expect(stale(qc, keys.push.prefs('u1'))).toBe(true)
  })

  it('savePushPrefs refuses a bad time before it writes, and still invalidates (settled)', async () => {
    const api = createFakeAdapter()
    const qc = newClient()
    await prime(qc, keys.push.prefs('u1'), prefs)

    await expect(runCommand(qc, api, savePushPrefs, { ...prefs, expiry_time: '9am' })).rejects.toThrow('Pick a valid time.')
    expect(api.calls).not.toContain('push.savePrefs')
    expect(stale(qc, keys.push.prefs('u1'))).toBe(true)
  })

  it('a test push that reaches no device says why', async () => {
    const api = createFakeAdapter({ pushTest: { sent: 0, gone: 1, failed: 0 } })
    const qc = newClient()
    await prime(qc, keys.push.device(), true)

    await expect(runCommand(qc, api, sendTestNotification, undefined)).rejects.toThrow('This device is no longer registered.')
    expect(stale(qc, keys.push.device())).toBe(false)
  })

  it('a test push the service did not take gets the generic message; a server message is shown as is', async () => {
    const api = createFakeAdapter({ pushTest: { sent: 0, gone: 0, failed: 1 } })
    const qc = newClient()
    await expect(runCommand(qc, api, sendTestNotification, undefined)).rejects.toThrow('The push service did not accept it. Try again.')

    api.failNext('push.test', new ApiError('Missing VAPID key'))
    await expect(runCommand(qc, api, sendTestNotification, undefined)).rejects.toThrow('Missing VAPID key')
  })

  it('a delivered test push invalidates the push queries', async () => {
    const api = createFakeAdapter()
    const qc = newClient()
    await prime(qc, keys.push.device(), true)

    await runCommand(qc, api, sendTestNotification, undefined)
    expect(stale(qc, keys.push.device())).toBe(true)
  })
})
