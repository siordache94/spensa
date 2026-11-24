import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthSession } from './api/port.ts'
import {
  OFFLINE_GRACE_MS,
  decideSession,
  readTrust,
  recordTrust,
  resolveSession,
  trustIsFresh,
  type DeviceTrust,
} from './deviceTrust.ts'

/** A Map-backed stand-in for localStorage. */
function fakeStorage() {
  const m = new Map<string, string>()
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
  }
}

const NOW = Date.parse('2026-11-24T12:00:00Z')
const ME: AuthSession = { userId: 'u1', metadata: { full_name: 'Anna' } }
const trustAt = (verifiedAt: number): DeviceTrust => ({ userId: 'u1', metadata: { full_name: 'Anna' }, verifiedAt })

/** The two auth calls the resolver makes, with call counters. */
function fakeAuth(over: { session?: AuthSession | null; verifyUser?: 'ok' | 'invalid' | 'unreachable'; recoveryPending?: boolean } = {}) {
  const calls = { session: 0, verifyUser: 0 }
  return {
    calls,
    async session() {
      calls.session += 1
      return over.session ?? null
    },
    async verifyUser() {
      calls.verifyUser += 1
      return over.verifyUser ?? 'unreachable'
    },
    async recoveryPending() {
      return over.recoveryPending ?? false
    },
  }
}

describe('trustIsFresh (24 h offline grace)', () => {
  it('accepts a record inside the window and rejects one past it', () => {
    expect(trustIsFresh(trustAt(NOW), NOW)).toBe(true)
    expect(trustIsFresh(trustAt(NOW - OFFLINE_GRACE_MS + 1), NOW)).toBe(true)
    expect(trustIsFresh(trustAt(NOW - OFFLINE_GRACE_MS), NOW)).toBe(true)
    expect(trustIsFresh(trustAt(NOW - OFFLINE_GRACE_MS - 1), NOW)).toBe(false)
  })

  it('rejects no record and a timestamp in the future (clock skew)', () => {
    expect(trustIsFresh(null, NOW)).toBe(false)
    expect(trustIsFresh(trustAt(NOW + 1000), NOW)).toBe(false)
  })
})

describe('decideSession', () => {
  it('uses a live session, recording the server time when online', () => {
    expect(decideSession({ session: ME, online: true, trust: null, now: NOW })).toEqual({
      session: ME,
      source: 'live',
      verifiedAt: NOW,
      invalid: false,
    })
  })

  it('lets a fresh trust record stand in while offline', () => {
    const resolution = decideSession({ session: null, online: false, trust: trustAt(NOW - 60_000), now: NOW })
    expect(resolution).toEqual({
      session: { userId: 'u1', metadata: { full_name: 'Anna' } },
      source: 'trust',
      verifiedAt: NOW - 60_000,
      invalid: false,
    })
  })

  it('gates to sign-in offline after the window, without calling the record invalid', () => {
    const resolution = decideSession({ session: null, online: false, trust: trustAt(NOW - OFFLINE_GRACE_MS - 1), now: NOW })
    expect(resolution.session).toBeNull()
    expect(resolution.invalid).toBe(false)
    expect(resolution.verifiedAt).toBe(NOW - OFFLINE_GRACE_MS - 1)
  })

  it('has no session online without a live one, even with a fresh record', () => {
    expect(decideSession({ session: null, online: true, trust: trustAt(NOW), now: NOW }).session).toBeNull()
  })
})

describe('resolveSession', () => {
  let store: ReturnType<typeof fakeStorage>
  beforeEach(() => {
    store = fakeStorage()
    vi.stubGlobal('localStorage', store)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('records the trust record after an online session read', async () => {
    const auth = fakeAuth({ session: ME })
    const resolution = await resolveSession(auth, { online: true, now: NOW })
    expect(resolution.source).toBe('live')
    expect(readTrust()).toEqual({ userId: 'u1', metadata: { full_name: 'Anna' }, verifiedAt: NOW })
    expect(auth.calls.verifyUser).toBe(0)
  })

  it('ignores device trust while a recovery link is open and drops the record (MR-039)', async () => {
    recordTrust(ME, NOW - 60_000)
    const auth = fakeAuth({ session: null, recoveryPending: true })
    const resolution = await resolveSession(auth, { online: true, now: NOW })
    expect(resolution.session).toBeNull()
    expect(resolution.source).toBe('none')
    expect(readTrust()).toBeNull()
    expect(auth.calls.verifyUser).toBe(0)
  })

  it('opens the saved shell offline after the token expired, without asking the server', async () => {
    recordTrust(ME, NOW - 60_000)
    const auth = fakeAuth({ session: null })
    const resolution = await resolveSession(auth, { online: false, now: NOW })
    expect(resolution.session).toEqual(ME)
    expect(resolution.source).toBe('trust')
    expect(auth.calls.verifyUser).toBe(0)
  })

  it('gates to sign-in offline past 24 h and keeps the record for a later check', async () => {
    recordTrust(ME, NOW - OFFLINE_GRACE_MS - 1)
    const resolution = await resolveSession(fakeAuth({ session: null }), { online: false, now: NOW })
    expect(resolution.session).toBeNull()
    expect(resolution.invalid).toBe(false)
    expect(readTrust()).not.toBeNull()
  })

  it('clears the record only when the server confirms the session is gone', async () => {
    recordTrust(ME, NOW)
    const resolution = await resolveSession(fakeAuth({ session: null, verifyUser: 'invalid' }), { online: true, now: NOW })
    expect(resolution.session).toBeNull()
    expect(resolution.invalid).toBe(true)
    expect(readTrust()).toBeNull()
  })

  it('keeps a fresh record when the online check cannot reach the server', async () => {
    recordTrust(ME, NOW - 60_000)
    const resolution = await resolveSession(fakeAuth({ session: null, verifyUser: 'unreachable' }), { online: true, now: NOW })
    expect(resolution.session).toEqual(ME)
    expect(readTrust()).not.toBeNull()
  })

  it('does nothing without a session or a record', async () => {
    const resolution = await resolveSession(fakeAuth({ session: null }), { online: true, now: NOW })
    expect(resolution).toEqual({ session: null, source: 'none', verifiedAt: null, invalid: false })
  })
})
