// Push aggregate: this device's subscription, the person's notification prefs, the test push, and the install prompt's
// data. The browser side (permission, the service worker, the subscription object) is in src/lib/push.ts.
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { defineCommand, useCommand } from './command.ts'
import { useApi } from './context.tsx'
import { useMyId } from './auth.ts'
import { keys } from './keys.ts'
import type { PushPrefsRow } from './port.ts'
import { askNotificationPermission, currentSubscriptionFields, hasDeviceSubscription, permissionRefusal, pushConfigured, pushEnv, subscribeDevice, unsubscribeDevice, usePushStatus } from '../push.ts'
import { isTime, pushStatus } from '../pushState.ts'

export type Prefs = PushPrefsRow // expiry_time 'HH:MM', null = Off
export const DEFAULT_PREFS: Prefs = { list_changes: true, meal_checkins: true, expiry_time: '09:00' }

// ---- Queries ---------------------------------------------------------------------------------------------------
/** Does this device have a subscription? undefined while checking. */
export function useDeviceSubscribed() {
  const status = usePushStatus()
  return useQuery({
    queryKey: keys.push.device(),
    enabled: pushConfigured && (status === 'available' || status === 'blocked') && !import.meta.env.DEV,
    queryFn: () => hasDeviceSubscription(),
  })
}

export function usePushPrefs() {
  const api = useApi()
  const me = useMyId()
  return useQuery({
    queryKey: keys.push.prefs(me),
    enabled: !!me,
    queryFn: async (): Promise<Prefs> => {
      const data = await api.push.prefs()
      return data ? { list_changes: data.list_changes, meal_checkins: data.meal_checkins, expiry_time: data.expiry_time?.slice(0, 5) ?? null } : DEFAULT_PREFS
    },
  })
}

/**
 * Self-heal once per load: if this device is subscribed but the server dropped its row (a 410, or the account
 * signed in elsewhere), store it again. Never prompts.
 */
export function useResyncSubscription() {
  const api = useApi()
  const me = useMyId()
  useEffect(() => {
    if (!pushConfigured || !me || import.meta.env.DEV || pushStatus(pushEnv()) !== 'available' || Notification.permission !== 'granted') return
    void currentSubscriptionFields()
      .then((s) => s && api.push.saveSubscription(s.endpoint, s.p256dh, s.auth))
      .catch(() => { /* best effort */ })
  }, [api, me])
}

// ---- Commands --------------------------------------------------------------------------------------------------
/**
 * Subscribe this device and store it, then the defaults (list changes on, reminder at 09:00). Permission must already be
 * granted: use useTurnOnNotifications, which asks in the tap.
 */
export const enableNotifications = defineCommand<void>({
  name: 'push.enable',
  run: async (api) => {
    const s = await subscribeDevice()
    await api.push.saveSubscription(s.endpoint, s.p256dh, s.auth)
    await api.push.ensurePrefs(DEFAULT_PREFS)
  },
  invalidates: () => [keys.push.all()],
})

/**
 * The "Turn on" tap. Asks for permission synchronously inside the tap (iOS rejects a request that comes after an await,
 * for example a paused mutation when offline). Only if granted does it run enableNotifications.
 */
export function useTurnOnNotifications(options: { onSuccess?: () => void; onError?: (e: Error) => void } = {}) {
  const [asking, setAsking] = useState(false)
  const mutation = useCommand(enableNotifications, options)
  const turnOn = () => {
    setAsking(true)
    // First statement of the handler: no await before the permission request.
    askNotificationPermission().then(
      (permission) => {
        setAsking(false)
        const refusal = permissionRefusal(permission)
        if (refusal) options.onError?.(refusal)
        else mutation.mutate()
      },
      (e: Error) => { setAsking(false); options.onError?.(e) },
    )
  }
  return { turnOn, isPending: asking || mutation.isPending }
}

/** Unsubscribes this device and removes its stored subscription. */
export const disableNotifications = defineCommand<void>({
  name: 'push.disable',
  run: async (api) => {
    const endpoint = await unsubscribeDevice()
    if (endpoint) await api.push.deleteSubscription(endpoint)
  },
  invalidates: () => [keys.push.all()],
})

/** Saves the person's prefs. Invalidates even when it fails (a failed write may have partly applied). */
export const savePushPrefs = defineCommand<Prefs>({
  name: 'push.savePrefs',
  run: async (api, next) => {
    if (next.expiry_time !== null && !isTime(next.expiry_time)) throw new Error('Pick a valid time.')
    await api.push.savePrefs(next)
  },
  invalidates: () => [keys.push.prefsAll()],
  when: 'settled',
})

/** Sends a test notification. Fails when the push service accepted it for no device. */
export const sendTestNotification = defineCommand<void>({
  name: 'push.test',
  run: async (api) => {
    let r
    try {
      r = await api.push.test()
    } catch (e) {
      throw new Error((e as Error).message || 'Could not send the test notification.')
    }
    if (r.sent === 0) {
      throw new Error(r.gone > 0 ? 'This device is no longer registered. Turn notifications off and on again.' : 'The push service did not accept it. Try again.')
    }
  },
  invalidates: () => [keys.push.all()],
})
