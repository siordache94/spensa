import { addDays, type Day } from '../domain/replay.ts'

/** A shopping trip: which planned meals it covers and the day it started. Kept per device. */
export type Trip = { mealIds: string[]; startedOn: Day }

const TRIP_KEY = 'spensa.shop.trip'
const ACK_KEY = 'spensa.shop.acked'

export function loadTrip(): Trip | null {
  try {
    const raw = JSON.parse(localStorage.getItem(TRIP_KEY) ?? 'null') as Trip | null
    if (raw && Array.isArray(raw.mealIds) && raw.mealIds.every((x) => typeof x === 'string') && typeof raw.startedOn === 'string') return raw
  } catch { /* unreadable: no trip */ }
  return null
}

export function saveTrip(trip: Trip | null) {
  try {
    if (trip) localStorage.setItem(TRIP_KEY, JSON.stringify(trip))
    else localStorage.removeItem(TRIP_KEY)
  } catch { /* private mode: the trip lasts until reload */ }
}

export function loadAcked(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(ACK_KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function saveAcked(ids: string[]) {
  try { localStorage.setItem(ACK_KEY, JSON.stringify(ids.slice(-200))) } catch { /* session only */ }
}

/** The date range a trip shops for: from the day it started to its last selected meal (or just that day with no meals). */
export function tripRange(startedOn: Day, mealDates: Day[]): { from: Day; to: Day } {
  const last = mealDates.reduce((a, d) => (d > a ? d : a), startedOn)
  return { from: startedOn, to: last }
}

/** Days shown in trip setup: today through the horizon, plus 7 more per "show more". */
export const setupEnd = (today: Day, horizonDays: number, extraWeeks: number): Day => addDays(today, horizonDays - 1 + 7 * extraWeeks)

/** "just now", "4 min", "2 h". */
export function relativeTime(iso: string, now: number): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000)
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`
  return `${Math.round(s / 3600)} h`
}
