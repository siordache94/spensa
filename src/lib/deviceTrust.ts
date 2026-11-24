// Device trust (MR-008): offline access must survive the Supabase access token expiring.
// auth-js returns no session after a failed refresh, so the shell would fall back to sign-in even though the household
// data is saved on the device. A trust record of the last user the server confirmed stands in for the session while
// offline, for a bounded grace window, and only an online, server-confirmed "gone" answer ends it (MR-007 teardown).
import type { AuthSession } from './api/port.ts'
import { readJson, removeKey, writeJson } from './storage.ts'

/** How long the saved data stays usable offline after the last online session check. */
export const OFFLINE_GRACE_MS = 24 * 60 * 60 * 1000

/** The last user the server confirmed on this device, and when (ms since the epoch). */
export type DeviceTrust = { userId: string; metadata: Record<string, unknown>; verifiedAt: number }

/** Where a resolved session came from: the local auth session, the trust record, or nowhere. */
export type SessionSource = 'live' | 'trust' | 'none'

/** What the app shows: a session (or none), and what the offline banner may report. */
export type SessionResolution = {
  session: AuthSession | null
  source: SessionSource
  /** When the server last confirmed the signed-in user (ms), or null when unknown. */
  verifiedAt: number | null
  /** True when the server confirmed the session is gone: local household data must be cleared. */
  invalid: boolean
}

/** The auth calls device trust needs; the adapter's `auth` group satisfies it. */
export type TrustAuth = {
  session(): Promise<AuthSession | null>
  verifyUser(): Promise<'ok' | 'invalid' | 'unreachable'>
  /** Optional so existing callers and tests need not provide it. */
  recoveryPending?(): Promise<boolean>
}

const KEY = 'spensa.device.trust'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** The stored trust record, or null when there is none (missing, unreadable or the wrong shape). */
export function readTrust(): DeviceTrust | null {
  const raw = readJson<Record<string, unknown>>(KEY, isRecord, {})
  const { userId, metadata, verifiedAt } = raw
  if (typeof userId !== 'string' || typeof verifiedAt !== 'number' || !Number.isFinite(verifiedAt)) return null
  return { userId, metadata: isRecord(metadata) ? metadata : {}, verifiedAt }
}

/** Remembers that the server confirmed `session` on this device at `now`. */
export function recordTrust(session: AuthSession, now = Date.now()): void {
  writeJson(KEY, { userId: session.userId, metadata: session.metadata, verifiedAt: now })
}

/** Forgets the device trust (explicit sign-out, account deletion, or a server-confirmed invalid session). */
export function clearTrust(): void {
  removeKey(KEY)
}

/** Whether the trust record may stand in for the session at `now`: the grace window is open. */
export function trustIsFresh(trust: DeviceTrust | null, now: number): boolean {
  if (!trust) return false
  const age = now - trust.verifiedAt
  return Number.isFinite(age) && age >= 0 && age <= OFFLINE_GRACE_MS
}

/**
 * The session policy, without IO. A live session wins. Offline, a fresh trust record stands in for it. A stale record
 * is not an error: there is simply no session, and the cache stays until an online check (MR-007 clears it then).
 */
export function decideSession(input: {
  session: AuthSession | null
  online: boolean
  trust: DeviceTrust | null
  now: number
}): SessionResolution {
  const { session, online, trust, now } = input
  if (session) return { session, source: 'live', verifiedAt: online ? now : trust?.verifiedAt ?? null, invalid: false }
  if (online) return { session: null, source: 'none', verifiedAt: null, invalid: false }
  if (trust && trustIsFresh(trust, now)) {
    return {
      session: { userId: trust.userId, metadata: trust.metadata },
      source: 'trust',
      verifiedAt: trust.verifiedAt,
      invalid: false,
    }
  }
  return { session: null, source: 'none', verifiedAt: trust?.verifiedAt ?? null, invalid: false }
}

/** The trusted stand-in for the signed-in user, as `decideSession` builds it. */
const trustedSession = (trust: DeviceTrust): AuthSession => ({ userId: trust.userId, metadata: trust.metadata })

/**
 * Resolves the session through device trust, above the adapter. Online, a session refreshes the trust record. Offline,
 * a missing session may only mean the access token expired, so a fresh trust record stands in for it. Online with no
 * local session, only the server may end the trust: a confirmed-invalid answer clears it and asks for data teardown.
 */
export async function resolveSession(auth: TrustAuth, options: { online?: boolean; now?: number } = {}): Promise<SessionResolution> {
  const online = options.online ?? navigator.onLine !== false
  const now = options.now ?? Date.now()
  // A password-recovery link creates a session we must not treat as signed in, and its device-trust stand-in would
  // skip the set-password screen entirely. Drop the record so the person resets and then signs in (MR-039).
  if (await auth.recoveryPending?.()) {
    clearTrust()
    return { session: null, source: 'none', verifiedAt: null, invalid: false }
  }
  const session = await auth.session().catch(() => null)
  const trust = readTrust()

  if (session) {
    // A session read while online means auth-js refreshed it when needed: the server still accepts this device.
    if (online) recordTrust(session, now)
    return decideSession({ session, online, trust, now })
  }
  if (online && trust) {
    const verdict = await auth.verifyUser()
    if (verdict === 'invalid') {
      clearTrust()
      return { session: null, source: 'none', verifiedAt: null, invalid: true }
    }
    if (verdict === 'ok') recordTrust(trustedSession(trust), now)
    // 'unreachable' (or an odd 'ok' without a local session): stay signed in while the record is fresh.
    if (verdict === 'ok' || trustIsFresh(trust, now)) {
      return { session: trustedSession(trust), source: 'trust', verifiedAt: now, invalid: false }
    }
  }
  return decideSession({ session: null, online, trust, now })
}
