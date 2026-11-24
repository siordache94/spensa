import { describe, expect, it } from 'vitest'
import { keys, shouldPersistQuery } from './keys.ts'

describe('shouldPersistQuery', () => {
  it('does not persist the auth session (user metadata)', () => {
    expect(shouldPersistQuery({ queryKey: keys.auth.session() })).toBe(false)
  })

  it('does not persist the user id, so a sign-out cannot leave it behind', () => {
    expect(shouldPersistQuery({ queryKey: keys.auth.uid() })).toBe(false)
  })

  it('persists every other query, including queries under the same prefixes', () => {
    expect(shouldPersistQuery({ queryKey: keys.household.all() })).toBe(true)
    expect(shouldPersistQuery({ queryKey: keys.push.prefs('u1') })).toBe(true)
    expect(shouldPersistQuery({ queryKey: ['auth', 'session', 'extra'] })).toBe(true)
    expect(shouldPersistQuery({ queryKey: ['auth', 'uid', 'extra'] })).toBe(true)
    expect(shouldPersistQuery({ queryKey: ['auth'] })).toBe(true)
  })
})
