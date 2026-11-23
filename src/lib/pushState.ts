// Pure decisions for the notification prompts (no DOM), so they can be unit tested.

export type PushEnv = {
  ios: boolean // iPhone / iPad
  standalone: boolean // running as an installed app (Home Screen), not in a browser tab
  supported: boolean // service workers, Push API and Notification all exist
  permission: 'default' | 'granted' | 'denied'
}

/**
 * - install-ios: iOS only delivers web push to a Home Screen app, so the page must be installed first.
 * - unsupported: this browser cannot do web push at all.
 * - blocked: the person said no in the browser; only the browser's site settings can undo it.
 * - available: can be turned on from a tap.
 */
export type PushStatus = 'install-ios' | 'unsupported' | 'blocked' | 'available'

export function pushStatus(env: PushEnv): PushStatus {
  if (env.ios && !env.standalone) return 'install-ios'
  if (!env.supported) return 'unsupported'
  if (env.permission === 'denied') return 'blocked'
  return 'available'
}

export const DISMISS_DAYS = 14

/** "Not now" hides a prompt for two weeks. `stamp` is when it was dismissed (ms), or null. */
export function isDismissed(stamp: number | null, now: number): boolean {
  return stamp !== null && Number.isFinite(stamp) && now - stamp < DISMISS_DAYS * 86_400_000 && now >= stamp
}

/** A VAPID public key (base64url) as the bytes pushManager.subscribe wants. */
export function keyToBytes(key: string): Uint8Array<ArrayBuffer> {
  const b64 = (key + '='.repeat((4 - (key.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** 'HH:MM:SS' from Postgres to the 'HH:MM' a time input takes. */
export const toInputTime = (t: string): string => t.slice(0, 5)
export const isTime = (t: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)
