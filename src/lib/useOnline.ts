// Connection state and the one action that is gated on it (MR-053). `navigator.onLine` only says the device has a
// network interface, so it is not a general "the server is reachable" check: ticks stay offline-capable and queue,
// but finishing a trip must not be queued with a version and date captured at tap time.
import { useSyncExternalStore } from 'react'

/** A missing `navigator` (SSR, tests) counts as online; only an explicit `false` means offline. */
export function isOnline(nav?: { onLine?: boolean }): boolean {
  const source = nav ?? (typeof navigator === 'undefined' ? undefined : navigator)
  return source?.onLine !== false
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

const getSnapshot = () => isOnline()
const getServerSnapshot = () => true

/** The live connection state, re-rendering on the browser's `online` and `offline` events. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/** Why the finish cannot run now, if it cannot. `waiting` is the queued shop writes that must land first (MR-004). */
export type FinishBlock = 'offline' | 'waiting' | null

/**
 * Done shopping needs a connection. Offline, the finish must wait for the person to come back online rather than
 * queue: a resumed finish would send the version and date it captured when tapped. Ticks are unaffected.
 */
export function finishBlock({ online, waiting }: { online: boolean; waiting: number }): FinishBlock {
  if (!online) return 'offline'
  if (waiting > 0) return 'waiting'
  return null
}
