// Web push on this device: permission, subscription, the install prompts, and the person's prefs. See ADR 0004.
import { useEffect, useSyncExternalStore } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase.ts'
import { useMyId } from './members.ts'
import { isDismissed, isTime, keyToBytes, pushStatus, type PushEnv, type PushStatus } from './pushState.ts'

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

export function promptDismissed(p: Prompt, now = Date.now()): boolean {
  try {
    const raw = localStorage.getItem(key(p))
    return isDismissed(raw === null ? null : Number(raw), now)
  } catch {
    return false
  }
}
export function dismissPrompt(p: Prompt) {
  try { localStorage.setItem(key(p), String(Date.now())) } catch { /* private mode: it comes back next visit */ }
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

async function save(sub: PushSubscription) {
  const j = sub.toJSON()
  if (!j.endpoint || !j.keys?.p256dh || !j.keys.auth) throw new Error('The browser gave an incomplete subscription.')
  const { error } = await supabase.rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth })
  if (error) throw new Error(error.message)
}

/** Ask permission, subscribe this device, and store it. Call it straight from a tap (iOS requires that). */
export async function enablePush(): Promise<void> {
  if (!VAPID_KEY) throw new Error('Notifications are not set up for this app.')
  const permission = await Notification.requestPermission() // first await: still inside the tap
  if (permission !== 'granted') {
    throw new Error(permission === 'denied' ? 'Notifications are blocked. Allow them for Spensa in your browser or phone settings.' : 'Permission was not given.')
  }
  const reg = await registration()
  const bytes = keyToBytes(VAPID_KEY)
  let sub = await reg.pushManager.getSubscription()
  if (sub && !sameKey(sub.options.applicationServerKey, bytes)) { await sub.unsubscribe(); sub = null } // keys were rotated
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes })
  await save(sub)
  // First time: the defaults (list changes on, reminder at 09:00). Never overwrite choices already made.
  const { error } = await supabase.from('push_prefs').upsert({ list_changes: true, meal_checkins: true, expiry_time: '09:00' }, { onConflict: 'user_id', ignoreDuplicates: true })
  if (error) throw new Error(error.message)
}

export async function disablePush(): Promise<void> {
  const sub = await (await registration()).pushManager.getSubscription()
  if (!sub) return
  const { endpoint } = sub
  await sub.unsubscribe()
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
  if (error) throw new Error(error.message)
}

/** Does this device have a subscription? undefined while checking. */
export function useDeviceSubscribed() {
  const status = usePushStatus()
  return useQuery({
    queryKey: ['push', 'device'],
    enabled: pushConfigured && (status === 'available' || status === 'blocked') && !import.meta.env.DEV,
    queryFn: async () => !!(await (await registration()).pushManager.getSubscription()),
  })
}

/**
 * Self-heal once per load: if this device is subscribed but the server dropped its row (a 410, or the account
 * signed in elsewhere), store it again. Never prompts.
 */
export function useResyncSubscription() {
  const me = useMyId()
  useEffect(() => {
    if (!pushConfigured || !me || import.meta.env.DEV || pushStatus(pushEnv()) !== 'available' || Notification.permission !== 'granted') return
    void registration().then((r) => r.pushManager.getSubscription()).then((s) => s && save(s)).catch(() => { /* best effort */ })
  }, [me])
}

// ---- Per-person prefs --------------------------------------------------------------------------------------
export type Prefs = { list_changes: boolean; meal_checkins: boolean; expiry_time: string | null } // expiry_time 'HH:MM', null = Off
export const DEFAULT_PREFS: Prefs = { list_changes: true, meal_checkins: true, expiry_time: '09:00' }

export function usePushPrefs() {
  const me = useMyId()
  return useQuery({
    queryKey: ['push', 'prefs', me],
    enabled: !!me,
    queryFn: async (): Promise<Prefs> => {
      const { data, error } = await supabase.from('push_prefs').select('list_changes, meal_checkins, expiry_time').maybeSingle()
      if (error) throw error
      return data ? { list_changes: data.list_changes, meal_checkins: data.meal_checkins, expiry_time: data.expiry_time?.slice(0, 5) ?? null } : DEFAULT_PREFS
    },
  })
}

export function useSavePrefs() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (next: Prefs) => {
      if (next.expiry_time !== null && !isTime(next.expiry_time)) throw new Error('Pick a valid time.')
      const { error } = await supabase.from('push_prefs').upsert(next, { onConflict: 'user_id' })
      if (error) throw new Error(error.message)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['push', 'prefs'] }),
  })
}

export async function sendTestPush(): Promise<void> {
  const { data, error } = await supabase.functions.invoke('push-test', { method: 'POST' })
  if (error) {
    const res = (error as { context?: Response }).context
    const body = res ? await res.json().catch(() => null) as { error?: string } | null : null
    throw new Error(body?.error ?? 'Could not send the test notification.')
  }
  const r = data as { sent: number; gone: number; failed: number }
  if (r.sent === 0) throw new Error(r.gone > 0 ? 'This device is no longer registered. Turn notifications off and on again.' : 'The push service did not accept it. Try again.')
}
