import { describe, expect, it } from 'vitest'
import { checkinDueAt, checkinPush, checkinRecipients, checkinTopic, checkinUrl, dueCheckins, parseCheckinParams, slotEnd, zonedInstant, type CheckinMeal } from './checkin'

const iso = (d: Date) => d.toISOString()

describe('slot end times', () => {
  it('uses the household setting, else the default for the slot name, else 21:30', () => {
    expect(slotEnd('lunch', { lunch: '13:15' })).toBe('13:15')
    expect(slotEnd('Lunch', {})).toBe('14:00')
    expect(slotEnd('dinner', null)).toBe('21:30')
    expect(slotEnd('supper', {})).toBe('21:30')
    expect(slotEnd('lunch', { lunch: 'noon' })).toBe('14:00') // a bad stored value is ignored
  })
})

describe('is due: slot end + 30 minutes in the household timezone', () => {
  it('Rome, summer and winter', () => {
    expect(iso(checkinDueAt('2026-10-24', 'dinner', {}, 'Europe/Rome'))).toBe('2026-10-24T20:00:00.000Z') // 22:00 CEST
    expect(iso(checkinDueAt('2026-10-26', 'dinner', {}, 'Europe/Rome'))).toBe('2026-10-26T21:00:00.000Z') // 22:00 CET
    expect(iso(checkinDueAt('2026-07-01', 'lunch', {}, 'Europe/Rome'))).toBe('2026-07-01T12:30:00.000Z') // 14:30 CEST
  })
  it('other timezones, including half-hour and no-DST zones', () => {
    expect(iso(checkinDueAt('2026-07-01', 'lunch', {}, 'Asia/Tokyo'))).toBe('2026-07-01T05:30:00.000Z')
    expect(iso(checkinDueAt('2026-07-01', 'lunch', {}, 'Asia/Kolkata'))).toBe('2026-07-01T09:00:00.000Z') // 14:30 IST
    expect(iso(checkinDueAt('2026-11-01', 'dinner', {}, 'America/New_York'))).toBe('2026-11-02T03:00:00.000Z') // EST after fall back
    expect(iso(checkinDueAt('2026-10-31', 'dinner', {}, 'America/New_York'))).toBe('2026-11-01T02:00:00.000Z') // EDT the day before
  })
  it('on the DST change days', () => {
    // 2026-03-29 Rome: 02:00 -> 03:00. Lunch (14:00) is after the change: CEST.
    expect(iso(checkinDueAt('2026-03-29', 'lunch', {}, 'Europe/Rome'))).toBe('2026-03-29T12:30:00.000Z')
    // a slot ending inside the repeated hour (2026-10-25 02:30 happens twice) takes the first
    expect(iso(zonedInstant('2026-10-25', '02:30', 'Europe/Rome'))).toBe('2026-10-25T00:30:00.000Z')
    // a time that does not exist (2026-03-29 02:30) lands after the gap, not before it
    expect(iso(zonedInstant('2026-03-29', '02:30', 'Europe/Rome'))).toBe('2026-03-29T01:30:00.000Z')
  })
  it('an edited end time moves it', () => {
    expect(iso(checkinDueAt('2026-07-01', 'dinner', { dinner: '23:45' }, 'Europe/Rome'))).toBe('2026-07-01T22:15:00.000Z') // 00:15 next day local
  })
})

const meal = (o: Partial<CheckinMeal> & { id: string }): CheckinMeal =>
  ({ date: '2026-11-27', slot: 'dinner', cookId: null, createdAt: '2026-11-20T10:00:00Z', recipeName: 'Pasta al pomodoro', ...o })
const base = { timeZone: 'Europe/Rome', endTimes: {}, shortMealIds: new Set(['a', 'b', 'c', 'd', 'e']), existing: new Set<string>() }
// Rome in November is UTC+1: dinner ends 21:30, check-in due 22:00 = 21:00Z

describe('dueCheckins', () => {
  it('not before slot end + 30 minutes, then yes', () => {
    expect(dueCheckins({ ...base, now: new Date('2026-11-27T20:59:00Z'), meals: [meal({ id: 'a' })] })).toEqual([])
    expect(dueCheckins({ ...base, now: new Date('2026-11-27T21:00:00Z'), meals: [meal({ id: 'a' })] }).map((m) => m.id)).toEqual(['a'])
  })
  it('only short meals, and only once', () => {
    const now = new Date('2026-11-27T21:10:00Z')
    expect(dueCheckins({ ...base, now, meals: [meal({ id: 'x' })] })).toEqual([]) // not short
    expect(dueCheckins({ ...base, now, existing: new Set(['a']), meals: [meal({ id: 'a' })] })).toEqual([])
  })
  it('lunch is due earlier than dinner on the same day', () => {
    const now = new Date('2026-11-27T13:45:00Z') // 14:45 Rome
    expect(dueCheckins({ ...base, now, meals: [meal({ id: 'a', slot: 'lunch' }), meal({ id: 'b' })] }).map((m) => m.id)).toEqual(['a'])
  })
  it('yesterday still counts just after midnight, older days and tomorrow never', () => {
    const now = new Date('2026-11-27T23:30:00Z') // 00:30 on the 28th in Rome
    const out = dueCheckins({ ...base, now, endTimes: { dinner: '23:45' }, meals: [meal({ id: 'a', date: '2026-11-27' }), meal({ id: 'b', date: '2026-11-25' }), meal({ id: 'c', date: '2026-11-29' })] })
    expect(out.map((m) => m.id)).toEqual(['a'])
  })
  it('a meal planned after its due time is a record, not a plan', () => {
    const now = new Date('2026-11-27T21:10:00Z')
    expect(dueCheckins({ ...base, now, meals: [meal({ id: 'a', createdAt: '2026-11-27T21:05:00Z' })] })).toEqual([])
  })
  it('follows the household timezone, not the server', () => {
    const meals = [meal({ id: 'a' })]
    // the same instant is 22:10 in Rome (due) and 16:10 in New York (not yet)
    const now = new Date('2026-11-27T21:10:00Z')
    expect(dueCheckins({ ...base, now, meals })).toHaveLength(1)
    expect(dueCheckins({ ...base, now, timeZone: 'America/New_York', meals })).toEqual([])
  })
})

describe('who gets it', () => {
  it('the cook only, when there is one in the household', () => {
    expect(checkinRecipients('u1', ['u1', 'u2'])).toEqual(['u1'])
  })
  it('everyone when nobody cooks, or the cook is no longer a member', () => {
    expect(checkinRecipients(null, ['u1', 'u2'])).toEqual(['u1', 'u2'])
    expect(checkinRecipients('gone', ['u1', 'u2'])).toEqual(['u1', 'u2'])
  })
})

describe('the push', () => {
  const p = checkinPush({ id: '0a1b2c3d-0000-4000-8000-000000000001', slot: 'dinner', recipeName: 'Pasta al pomodoro' }, 2)
  it('is silent, has the two actions, and opens the meal', () => {
    expect(p).toMatchObject({
      kind: 'checkin', silent: true, unread: 2,
      body: 'Dinner: Pasta al pomodoro. Cooked as planned?',
      url: '/?meal=0a1b2c3d-0000-4000-8000-000000000001',
      actions: [{ action: 'planned', title: 'Cooked as planned' }, { action: 'changed', title: 'Changed it' }],
    })
    expect(p).not.toHaveProperty('vibrate')
  })
  it('has a per-meal tag and a topic of at most 32 characters, so meals do not replace each other', () => {
    expect(p.tag).toBe('checkin-0a1b2c3d-0000-4000-8000-000000000001')
    expect(checkinTopic('0a1b2c3d-0000-4000-8000-000000000001')).toHaveLength(32)
  })
  it('copes with a removed recipe', () => {
    expect(checkinPush({ id: 'x', slot: 'lunch', recipeName: null }, 1).body).toBe('Lunch: Meal. Cooked as planned?')
  })
})

describe('check-in links', () => {
  it('round trips', () => {
    expect(parseCheckinParams(checkinUrl('m1', 'changed').slice(1))).toEqual({ mealId: 'm1', answer: 'changed' })
    expect(parseCheckinParams('?meal=m1')).toEqual({ mealId: 'm1', answer: null })
    expect(parseCheckinParams('?meal=m1&checkin=bogus')).toEqual({ mealId: 'm1', answer: null })
    expect(parseCheckinParams('?x=1')).toBeNull()
  })
})
