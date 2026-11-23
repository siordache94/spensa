// Pure rules for push notifications (ADR 0004). Shared by the phone (settings UI) and the edge functions.
import { addDays, expiringSoon, type Day, type PantryEvents } from '../domain/replay.ts'
import { localDay } from '../domain/pantryRows.ts'
import { changeMessage, diffToBuy } from './trip.ts'

export const LIST_WINDOW_SECONDS = 30
export const REMINDER_GRACE_MINUTES = 180

export type PushPayload = { title: string; body: string; kind: 'list' | 'expiry' | 'test'; url: string }

/** The combined list push, or null when the window netted out to nothing (added then removed again, or bought). */
export function listChangePush(who: string, before: string[], after: string[], resolved: ReadonlySet<string>): PushPayload | null {
  const body = changeMessage(who, diffToBuy(before, after, resolved))
  return body ? { title: 'Spensa', body, kind: 'list', url: '/shop' } : null
}

/**
 * Who gets a list-change push: everyone except the author. If both members wrote inside one window nobody is
 * the clear author, and each has just seen their own edit, so nobody is notified.
 */
export function listRecipients(members: string[], authors: string[]): string[] {
  const writers = new Set(authors)
  if (writers.size !== 1) return []
  return members.filter((m) => !writers.has(m))
}

/** 'HH:MM' or 'HH:MM:SS' to minutes since midnight. */
export const minutesOfDay = (t: string): number => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

/** Wall-clock minutes since midnight, and the calendar day, of an instant in a timezone. */
export function localClock(now: Date, timeZone: string): { day: Day; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  return { day: localDay(now, timeZone), minutes: get('hour') * 60 + get('minute') }
}

/**
 * Is this person's daily reminder due? Their chosen time is wall-clock in the household timezone, so it
 * follows DST. Due from that time until `graceMinutes` later (so a late tick still sends, but turning the
 * reminder on at 14:00 for 09:00 does not fire at once), and only once per local day.
 */
export function reminderDue(now: Date, timeZone: string, time: string | null, checkedOn: Day | null, graceMinutes = REMINDER_GRACE_MINUTES): boolean {
  if (!time) return false
  const { day, minutes } = localClock(now, timeZone)
  if (checkedOn === day) return false
  const at = minutesOfDay(time)
  return minutes >= at && minutes < at + graceMinutes
}

/** "today", "tomorrow", "in 2 days". */
export const whenLabel = (today: Day, on: Day): string => {
  if (on <= today) return 'today'
  if (on === addDays(today, 1)) return 'tomorrow'
  return `in ${Math.round((Date.parse(on) - Date.parse(today)) / 86_400_000)} days`
}

export type ExpiringItem = { name: string; on: Day }

/**
 * Batches with stock left that expire from today through `days` ahead, one entry per ingredient (its soonest
 * batch), soonest first. Already-expired batches are left out: they were reported on the days before, and a
 * reminder that repeats every morning until the shelf is cleaned would only get muted.
 */
export function expiringForReminder(events: PantryEvents, remaining: Map<string, number>, names: Map<string, string>, today: Day, days: number): ExpiringItem[] {
  const seen = new Set<string>()
  const out: ExpiringItem[] = []
  for (const b of expiringSoon(events, remaining, today, days)) {
    const name = names.get(b.ingredientId)
    if (!name || !b.expiresOn || b.expiresOn < today || seen.has(b.ingredientId)) continue
    seen.add(b.ingredientId)
    out.push({ name, on: b.expiresOn })
  }
  return out.sort((a, b) => a.on.localeCompare(b.on) || a.name.localeCompare(b.name))
}

/** "Expiring: Milk tomorrow, Spinach in 2 days", or null when nothing expires. */
export function expiryPush(items: ExpiringItem[], today: Day, maxShown = 4): PushPayload | null {
  if (items.length === 0) return null
  const shown = items.slice(0, maxShown).map((i) => `${i.name} ${whenLabel(today, i.on)}`)
  const more = items.length - shown.length
  return { title: 'Spensa', body: `Expiring: ${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''}`, kind: 'expiry', url: '/pantry' }
}

/** A push service answers 404 or 410 for a subscription that is gone for good. */
export const isGone = (status: number) => status === 404 || status === 410
