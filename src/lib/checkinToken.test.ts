import { describe, expect, it } from 'vitest'
import { signCheckinToken, verifyCheckinToken } from './checkinToken'

const secret = 'a-long-enough-shared-secret'
const now = new Date('2026-11-27T21:00:00Z')

describe('check-in token', () => {
  it('verifies for the same meal and returns the user', async () => {
    const t = await signCheckinToken(secret, 'user-1', 'meal-1', now)
    expect(await verifyCheckinToken(secret, t, 'meal-1', now)).toBe('user-1')
  })
  it('is bound to its meal, its user, and the secret', async () => {
    const t = await signCheckinToken(secret, 'user-1', 'meal-1', now)
    expect(await verifyCheckinToken(secret, t, 'meal-2', now)).toBeNull()
    expect(await verifyCheckinToken(secret, t.replace('user-1', 'user-2'), 'meal-1', now)).toBeNull()
    expect(await verifyCheckinToken('another-secret-entirely', t, 'meal-1', now)).toBeNull()
  })
  it('expires', async () => {
    const t = await signCheckinToken(secret, 'user-1', 'meal-1', now, 30)
    expect(await verifyCheckinToken(secret, t, 'meal-1', new Date('2026-12-26T21:00:00Z'))).toBe('user-1')
    expect(await verifyCheckinToken(secret, t, 'meal-1', new Date('2026-12-28T21:00:00Z'))).toBeNull()
  })
  it('rejects garbage', async () => {
    for (const bad of ['', 'a.b', 'a.b.c.d', 'u.notanumber.sig', 'u.99999999999.']) expect(await verifyCheckinToken(secret, bad, 'meal-1', now)).toBeNull()
  })
})
