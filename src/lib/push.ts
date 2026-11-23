// Web push on this device: permission, the subscription, and the install prompts. See ADR 0004.
// The server side (saving the subscription, prefs, queries) is in src/lib/api/push.ts; this file has no data calls.
import { useSyncExternalStore } from 'react'
import { isDismissed, keyToBytes, pushStatus, type PushEnv, type PushStatus } from './pushState.ts'
import { readJson, writeJson } from './storage.ts'

const VAPID_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY
/** False in a build without VITE_VAPID_PUBLIC_KEY: every notification prompt stays hidden. */
export const pushConfigured = !!VAPID_KEY

export function pushEnv(): PushEnv {
  const nav = navigator as Navigator & { standalone?: boolean }
  const ios = /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1) // iPadOS reports as a Mac
  const standalone = nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  return { ios, standalone, supported, permission: 'Notification' in window ? Notification.permission : 'default' }
}

export const usePushStatus = (): PushStatus => pushStatus(pushEnv())

// ---- "Not now": per device, two weeks ---------------------------------------------------------------------
export type Prompt = 'notify' | 'install'
const key = (p: Prompt) => `spensa.prompt.${p}.dismissed`

const isStamp = (v: unknown): v is number | null => v === null || typeof v === 'number'

export function promptDismissed(p: Prompt, now = Date.now()): boolean {
  return isDismissed(readJson<number | null>(key(p), isStamp, null), now)
}
export function dismissPrompt(p: Prompt) {
  writeJson(key(p), Date.now()) // private mode: it comes back next visit
}

// ---- Android: beforeinstallprompt -------------------------------------------------------------------------
type InstallEvent = Event & { prompt(): Promise<unknown> }
let installEvent: InstallEvent | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e as InstallEvent; emit() })
  window.addEventListener('appinstalled', () => { installEvent = null; emit() })
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

/** An "Install app" action when the browser offers one (Chrome on Android), else null. */
export function useInstallApp(): (() => Promise<void>) | null {
  const ev = useSyncExternalStore(subscribe, () => installEvent)
  return ev ? async () => { await ev.prompt(); installEvent = null; emit() } : null
}

// ---- This device's subscription -------------------------------------------------------------------------
async function registration(): Promise<ServiceWorkerRegistration> {
  if (import.meta.env.DEV) throw new Error('Notifications need the built app (the service worker is off in dev).')
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise<never>((_, no) => setTimeout(() => no(new Error('The app is still starting. Try again in a moment.')), 8000))])
  return reg
}

const sameKey = (a: ArrayBuffer | null, b: Uint8Array) => !!a && new Uint8Array(a).length === b.length && new Uint8Array(a).every((v, i) => v === b[i])

/** The three values the server stores for a subscription. */
export type SubscriptionFields = { endpoint: string; p256dh: string; auth: string }

function fieldsOf(sub: PushSubscription): SubscriptionFields {
  const j = sub.toJSON()
  if (!j.endpoint || !j.keys?.p256dh || !j.keys.auth) throw new Error('The browser gave an incomplete subscription.')
  return { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }
}

/** The message for a permission answer that does not allow notifications, or null when it does. */
export function permissionRefusal(permission: NotificationPermission): Error | null {
  if (permission === 'granted') return null
  return new Error(permission === 'denied' ? 'Notifications are blocked. Allow them for Spensa in your browser or phone settings.' : 'Permission was not given.')
}

/**
 * Asks the browser for notification permission. Call it synchronously as the first thing in a tap handler (iOS only
 * honours the request inside the tap), so nothing may be awaited before this call. `request` is a parameter only so
 * tests can stub it.
 */
export async function askNotificationPermission(request: () => Promise<NotificationPermission> = () => Notification.requestPermission()): Promise<NotificationPermission> {
  return request() // no await before this line: an async function runs synchronously up to its first await
}

/**
 * Subscribes this device (reusing the subscription when the keys match) and returns the fields the server stores.
 * Permission must already be granted (see askNotificationPermission).
 */
export async function subscribeDevice(): Promise<SubscriptionFields> {
  if (!VAPID_KEY) throw new Error('Notifications are not set up for this app.')
  const reg = await registration()
  const bytes = keyToBytes(VAPID_KEY)
  let sub = await reg.pushManager.getSubscription()
  if (sub && !sameKey(sub.options.applicationServerKey, bytes)) { await sub.unsubscribe(); sub = null } // keys were rotated
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes })
  return fieldsOf(sub)
}

/** Unsubscribes this device. Returns the endpoint it had (so the server row can go), or null when there was none. */
export async function unsubscribeDevice(): Promise<string | null> {
  const sub = await (await registration()).pushManager.getSubscription()
  if (!sub) return null
  const { endpoint } = sub
  await sub.unsubscribe()
  return endpoint
}

/** The subscription's fields, or null when this device has none. Throws when the browser's subscription is incomplete. */
export async function currentSubscriptionFields(): Promise<SubscriptionFields | null> {
  const sub = await (await registration()).pushManager.getSubscription()
  return sub ? fieldsOf(sub) : null
}

export async function hasDeviceSubscription(): Promise<boolean> {
  return !!(await (await registration()).pushManager.getSubscription())
}
