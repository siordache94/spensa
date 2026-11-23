// Meal check-ins (ADR 0005): when one is due, who gets it, what the push says, and the URLs that answer it.
// Pure, so the phone, the service worker's tests and the push-cron edge function share one definition.
import { addDays, type Day } from '../domain/replay.ts'
import { localDay } from '../domain/pantryRows.ts'
import type { PushPayload } from './notify.ts'

export const CHECKIN_DELAY_MINUTES = 30
export const CHECKIN_ANSWERS = ['planned', 'changed', 'not_cooked', 'dismissed'] as const
export type CheckinAnswer = (typeof CHECKIN_ANSWERS)[number]

/** Slot name (lowercase) to its end time, 'HH:MM'. Stored on the household as `slot_end_times`. */
export type SlotEndTimes = Record<string, string>

/** Used for a slot with no entry in the household setting. Unknown names end at 21:30, so they are checked late rather than early. */
export const DEFAULT_SLOT_END: Record<string, string> = { breakfast: '10:00', lunch: '14:00', dinner: '21:30', snack: '17:00' }
export const FALLBACK_SLOT_END = '21:30'
export const isEndTime = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)

/** The end time of a slot: the household's setting, else the default for that name. */
export function slotEnd(slot: string, set: SlotEndTimes | null | undefined): string {
  const key = slot.trim().toLowerCase()
  const own = set && Object.entries(set).find(([k]) => k.trim().toLowerCase() === key)?.[1]
  return own && isEndTime(own) ? own : DEFAULT_SLOT_END[key] ?? FALLBACK_SLOT_END
}

/** Offset of a timezone from UTC at an instant, in ms (local minus UTC). Follows DST. */
function offsetMs(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(at))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - Math.floor(at / 1000) * 1000
}

/**
 * The instant at which the wall clock in `timeZone` reads `day` `time`. In a DST gap (a time that does not exist)
 * it lands on the same offset as just before, i.e. shortly after the gap; in the repeated hour it picks the first.
 */
export function zonedInstant(day: Day, time: string, timeZone: string): Date {
  const [y, mo, d] = day.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  const DAY = 86_400_000
  // the offsets in force a day before and a day after: they differ only on a DST change day
  const before = offsetMs(guess - DAY, timeZone)
  const after = offsetMs(guess + DAY, timeZone)
  const candidates = [guess - before, guess - after].filter((t) => offsetMs(t, timeZone) === guess - t)
  if (candidates.length === 0) return new Date(guess - before) // inside a gap: just after it
  return new Date(Math.min(...candidates))
}

/** When a meal's check-in becomes due: the slot's end plus 30 minutes. */
export function checkinDueAt(day: Day, slot: string, set: SlotEndTimes | null | undefined, timeZone: string): Date {
  return new Date(zonedInstant(day, slotEnd(slot, set), timeZone).getTime() + CHECKIN_DELAY_MINUTES * 60_000)
}

export type CheckinMeal = {
  id: string
  date: Day
  slot: string
  cookId: string | null
  createdAt: string
  recipeName: string | null
}

/**
 * Meals whose check-in should exist now: planned for today or yesterday (yesterday so a slot ending near midnight
 * still gets its check-in just after it; nothing older, so switching the feature on does not flood), whose due
 * time has passed, that the replay found short, that were planned before the due time (a meal added afterwards is
 * a record of something already eaten, not a plan to check), and that have no check-in yet.
 */
export function dueCheckins(a: {
  now: Date
  timeZone: string
  meals: CheckinMeal[]
  endTimes: SlotEndTimes | null | undefined
  shortMealIds: ReadonlySet<string>
  existing: ReadonlySet<string>
}): CheckinMeal[] {
  const today = localDay(a.now, a.timeZone)
  const yesterday = addDays(today, -1)
  return a.meals.filter((m) => {
    if ((m.date !== today && m.date !== yesterday) || !a.shortMealIds.has(m.id) || a.existing.has(m.id)) return false
    const due = checkinDueAt(m.date, m.slot, a.endTimes, a.timeZone)
    return a.now >= due && Date.parse(m.createdAt) <= due.getTime()
  })
}

/** The meal's cook, or everyone in the household when nobody cooks it (or the cook left). */
export function checkinRecipients(cookId: string | null, memberIds: string[]): string[] {
  return cookId && memberIds.includes(cookId) ? [cookId] : memberIds
}

/** The Plan tab with the meal open. `answer` is what the notification button chose; the app resolves it. */
export function checkinUrl(mealId: string, answer?: CheckinAnswer): string {
  const q = new URLSearchParams({ meal: mealId })
  if (answer) q.set('checkin', answer)
  return `/?${q.toString()}`
}

/** Reads `?meal=...&checkin=...` from a location search string; null when it is not a check-in link. */
export function parseCheckinParams(search: string): { mealId: string; answer: CheckinAnswer | null } | null {
  const q = new URLSearchParams(search)
  const mealId = q.get('meal')
  if (!mealId) return null
  const a = q.get('checkin')
  return { mealId, answer: (CHECKIN_ANSWERS as readonly string[]).includes(a ?? '') ? (a as CheckinAnswer) : null }
}

export const slotLabel = (slot: string) => slot.charAt(0).toUpperCase() + slot.slice(1)

/** Push-service topics are at most 32 url-safe characters: a uuid without dashes fits, and keeps meals from replacing each other. */
export const checkinTopic = (mealId: string) => mealId.replace(/-/g, '').slice(0, 32)

/** "Dinner: Pasta al pomodoro. Cooked as planned?", silent, with the two buttons (Android). `answer` is added by the sender. */
export function checkinPush(m: { id: string; slot: string; recipeName: string | null }, unread: number): PushPayload {
  return {
    title: 'Spensa',
    body: `${slotLabel(m.slot)}: ${m.recipeName?.trim() || 'Meal'}. Cooked as planned?`,
    kind: 'checkin',
    url: checkinUrl(m.id),
    silent: true,
    actions: [{ action: 'planned', title: 'Cooked as planned' }, { action: 'changed', title: 'Changed it' }],
    tag: `checkin-${m.id}`,
    topic: checkinTopic(m.id),
    mealId: m.id,
    unread,
  }
}
