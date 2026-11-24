import { describe, expect, it } from 'vitest'
import type { PantryEvents } from '../domain/replay.ts'
import { expiringForReminder, expiryPush, isGone, listChangePush, listRecipients, localClock, reminderDue, whenLabel } from './notify.ts'

describe('listChangePush', () => {
  it('words a combined change like the in-app toast', () => {
    expect(listChangePush('Anna', ['need-a'], ['need-a', 'need-b', 'item-1'], new Set())).toEqual({
      title: 'Spensa', body: 'Anna changed the list: 2 added', kind: 'list', url: '/shop',
    })
    expect(listChangePush('Anna', ['need-a', 'need-c'], ['need-b'], new Set())?.body).toBe('Anna changed the list: 1 added, 2 removed')
  })
  it('does not count items that left the list because they were bought', () => {
    expect(listChangePush('Anna', ['need-a', 'item-1'], ['item-1'], new Set(['need-a']))).toBeNull()
    expect(listChangePush('Anna', ['need-a', 'need-b'], ['need-b'], new Set(['need-a']))).toBeNull()
  })
  it('is null when added and removed again inside the window', () => {
    expect(listChangePush('Anna', ['need-a'], ['need-a'], new Set())).toBeNull()
  })
})

describe('listRecipients', () => {
  it('never includes the author', () => {
    expect(listRecipients(['anna', 'ben'], ['anna'])).toEqual(['ben'])
    expect(listRecipients(['anna', 'ben'], ['ben', 'ben'])).toEqual(['anna'])
  })
  it('notifies nobody when both wrote in one window, or the author is unknown', () => {
    expect(listRecipients(['anna', 'ben'], ['anna', 'ben'])).toEqual([])
    expect(listRecipients(['anna', 'ben'], [])).toEqual([])
  })
})

describe('reminderDue', () => {
  const rome = 'Europe/Rome'
  it('is due from the chosen household-local time, once per day', () => {
    // 2026-11-25 08:59 Rome (CET, UTC+1) = 07:59Z
    expect(reminderDue(new Date('2026-11-25T07:59:00Z'), rome, '09:00', null)).toBe(false)
    expect(reminderDue(new Date('2026-11-25T08:00:00Z'), rome, '09:00', null)).toBe(true)
    expect(reminderDue(new Date('2026-11-25T08:00:00Z'), rome, '09:00', '2026-11-25')).toBe(false)
    expect(reminderDue(new Date('2026-11-25T08:00:00Z'), rome, '09:00', '2026-11-24')).toBe(true)
  })
  it('is never due when Off', () => {
    expect(reminderDue(new Date('2026-11-25T08:00:00Z'), rome, null, null)).toBe(false)
  })
  it('does not fire hours after the chosen time (turned on in the afternoon)', () => {
    expect(reminderDue(new Date('2026-11-25T08:00:00Z'), rome, '09:00', null)).toBe(true)
    expect(reminderDue(new Date('2026-11-25T13:00:00Z'), rome, '09:00', null)).toBe(false)
  })
  it('follows the household timezone, not the server', () => {
    const t = new Date('2026-11-25T08:00:00Z') // 09:00 Rome, 03:00 New York, 17:00 Tokyo
    expect(reminderDue(t, 'America/New_York', '09:00', null)).toBe(false)
    expect(reminderDue(t, 'America/New_York', '03:00', null)).toBe(true)
    expect(reminderDue(t, 'Asia/Tokyo', '17:00', null)).toBe(true)
  })
  it('follows DST: 09:00 is 08:00Z in winter and 07:00Z in summer', () => {
    expect(reminderDue(new Date('2026-07-15T06:59:00Z'), rome, '09:00', null)).toBe(false)
    expect(reminderDue(new Date('2026-07-15T07:00:00Z'), rome, '09:00', null)).toBe(true)
    expect(reminderDue(new Date('2026-07-15T08:00:00Z'), rome, '09:00', null)).toBe(true)
  })
  it('on the spring-forward day a time inside the skipped hour still fires once the clock passes it', () => {
    // 2026-03-29: 02:00 CET jumps to 03:00 CEST; 02:30 does not exist. 01:00Z = 03:00 CEST.
    expect(reminderDue(new Date('2026-03-29T00:59:00Z'), rome, '02:30', null)).toBe(false) // 01:59 CET
    expect(reminderDue(new Date('2026-03-29T01:00:00Z'), rome, '02:30', null)).toBe(true) // 03:00 CEST
  })
  it('on the fall-back day the repeated hour fires only once', () => {
    // 2026-10-25: 03:00 CEST falls back to 02:00 CET; 02:30 happens twice (00:30Z and 01:30Z).
    expect(reminderDue(new Date('2026-10-25T00:30:00Z'), rome, '02:30', null)).toBe(true)
    expect(reminderDue(new Date('2026-10-25T01:30:00Z'), rome, '02:30', '2026-10-25')).toBe(false)
  })
  it('uses the local day, which can differ from the UTC day', () => {
    // 23:30 New York on the 24th is already the 25th in UTC
    expect(localClock(new Date('2026-11-25T04:30:00Z'), 'America/New_York')).toEqual({ day: '2026-11-24', minutes: 23 * 60 + 30 })
  })
  it('fires a reminder after the last tick on the next midnight tick', () => {
    // Rome is CET (UTC+1) in November; 23:50 local is 22:50Z.
    expect(reminderDue(new Date('2026-11-25T21:00:00Z'), rome, '23:50', null)).toBe(false) // 22:00
    expect(reminderDue(new Date('2026-11-25T22:30:00Z'), rome, '23:50', null)).toBe(false) // 23:30
    expect(reminderDue(new Date('2026-11-25T22:50:00Z'), rome, '23:50', null)).toBe(true) // 23:50 (an on-time tick)
    expect(reminderDue(new Date('2026-11-25T23:00:00Z'), rome, '23:50', null)).toBe(true) // 00:00, the next tick
    expect(reminderDue(new Date('2026-11-25T23:10:00Z'), rome, '23:50', null)).toBe(true) // 00:10, still inside the grace
    expect(reminderDue(new Date('2026-11-25T23:10:00Z'), rome, '23:50', '2026-11-26')).toBe(false) // already handled today
    expect(reminderDue(new Date('2026-11-26T22:50:00Z'), rome, '23:50', '2026-11-26')).toBe(false) // the next evening, handled
    expect(reminderDue(new Date('2026-11-26T23:00:00Z'), rome, '23:50', '2026-11-26')).toBe(true) // the day after can fire
  })
  it('does not repeat an earlier evening reminder on the next midnight tick', () => {
    // 22:00 and 23:30 have a tick of their own day; their 3-hour grace must not send a second reminder at 00:00.
    expect(reminderDue(new Date('2026-11-25T21:00:00Z'), rome, '22:00', '2026-11-24')).toBe(true) // 22:00
    expect(reminderDue(new Date('2026-11-25T23:00:00Z'), rome, '22:00', '2026-11-25')).toBe(false) // 00:00, already sent
    expect(reminderDue(new Date('2026-11-25T22:30:00Z'), rome, '23:30', '2026-11-24')).toBe(true) // 23:30
    expect(reminderDue(new Date('2026-11-25T23:00:00Z'), rome, '23:30', '2026-11-25')).toBe(false) // 00:00, already sent
  })
  it('follows DST on the spring-forward and fall-back days, including a reminder just before midnight', () => {
    // 2026-03-29: CET (UTC+1) becomes CEST (UTC+2) at 01:00Z. 23:50 CEST = 21:50Z; midnight is 22:00Z.
    expect(reminderDue(new Date('2026-03-29T21:00:00Z'), rome, '23:50', null)).toBe(false) // 23:00 CEST
    expect(reminderDue(new Date('2026-03-29T21:50:00Z'), rome, '23:50', null)).toBe(true) // 23:50 CEST
    expect(reminderDue(new Date('2026-03-29T22:10:00Z'), rome, '23:50', null)).toBe(true) // 00:10 CEST on the 30th
    expect(reminderDue(new Date('2026-03-29T22:10:00Z'), rome, '23:50', '2026-03-30')).toBe(false)
    // 2026-10-25: CEST (UTC+2) falls back to CET (UTC+1) at 01:00Z. 23:50 CET = 22:50Z; midnight CET = 23:00Z.
    expect(reminderDue(new Date('2026-10-25T21:50:00Z'), rome, '23:50', null)).toBe(false) // 22:50 CET
    expect(reminderDue(new Date('2026-10-25T22:50:00Z'), rome, '23:50', null)).toBe(true) // 23:50 CET
    expect(reminderDue(new Date('2026-10-25T23:00:00Z'), rome, '23:50', null)).toBe(true) // 00:00 CET on the 26th
    expect(reminderDue(new Date('2026-10-25T23:10:00Z'), rome, '23:50', null)).toBe(true) // 00:10 CET on the 26th
    expect(reminderDue(new Date('2026-10-25T23:10:00Z'), rome, '23:50', '2026-10-26')).toBe(false)
  })
})

describe('expiry wording', () => {
  const today = '2026-11-25'
  it('labels days', () => {
    expect(whenLabel(today, '2026-11-25')).toBe('today')
    expect(whenLabel(today, '2026-11-26')).toBe('tomorrow')
    expect(whenLabel(today, '2026-11-27')).toBe('in 2 days')
    expect(whenLabel('2026-12-30', '2027-01-02')).toBe('in 3 days')
  })
  it('lists items soonest first', () => {
    expect(expiryPush([{ name: 'Milk', on: '2026-11-26' }, { name: 'Spinach', on: '2026-11-27' }], today)).toEqual({
      title: 'Spensa', body: 'Expiring: Milk tomorrow, Spinach in 2 days', kind: 'expiry', url: '/pantry',
    })
  })
  it('caps the list', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => ({ name, on: '2026-11-25' }))
    expect(expiryPush(items, today)?.body).toBe('Expiring: a today, b today, c today, d today and 2 more')
  })
  it('sends nothing when nothing expires', () => {
    expect(expiryPush([], today)).toBeNull()
  })
})

describe('expiringForReminder', () => {
  const batch = (id: string, ingredientId: string, qty: number, expiresOn: string | null) => ({
    id, ingredientId, qty, addedOn: '2026-11-20', addedAt: '2026-11-20T09:00:00Z', recordedAt: '2026-11-20T09:00:00Z', expiresOn,
  })
  const events: PantryEvents = {
    batches: [
      batch('milk1', 'milk', 1000, '2026-11-26'),
      batch('milk2', 'milk', 1000, '2026-12-10'),
      batch('spin', 'spinach', 200, '2026-11-27'),
      batch('eaten', 'yogurt', 100, '2026-11-26'), // all used up by the meal below
      batch('old', 'cheese', 100, '2026-11-24'), // expired yesterday
      batch('far', 'rice', 100, '2026-12-25'),
      batch('none', 'salt', 100, null),
    ],
    meals: [{ id: 'm', date: '2026-11-22', portions: 1, lines: [{ ingredientId: 'yogurt', qtyPerPortion: 100 }] }],
    adjustments: [],
    snapshot: null,
  }
  const names = new Map([['milk', 'Milk'], ['spinach', 'Spinach'], ['yogurt', 'Yogurt'], ['cheese', 'Cheese'], ['rice', 'Rice'], ['salt', 'Salt']])
  it('uses the replay, so remaining stock decides, and skips expired and far-off batches', () => {
    const { remaining } = replayOf(events)
    expect(expiringForReminder(events, remaining, names, '2026-11-25', 2)).toEqual([
      { name: 'Milk', on: '2026-11-26' },
      { name: 'Spinach', on: '2026-11-27' },
    ])
  })
})

import { replay } from '../domain/replay.ts'
const replayOf = (e: PantryEvents) => replay(e, '2026-11-25')

describe('isGone', () => {
  it('treats 404 and 410 as a dead subscription only', () => {
    expect([404, 410].every(isGone)).toBe(true)
    expect([200, 201, 400, 401, 403, 413, 429, 500, 503].some(isGone)).toBe(false)
  })
})
