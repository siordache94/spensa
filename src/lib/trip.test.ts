import { describe, expect, it } from 'vitest'
import { relativeTime, setupEnd, tripRange } from './trip.ts'

describe('tripRange', () => {
  it('runs from the start day to the last selected meal', () => {
    expect(tripRange('2026-11-24', ['2026-11-25', '2026-11-26', '2026-11-24'])).toEqual({ from: '2026-11-24', to: '2026-11-26' })
  })
  it('is a single day with no meals', () => {
    expect(tripRange('2026-11-24', [])).toEqual({ from: '2026-11-24', to: '2026-11-24' })
  })
})

describe('setupEnd', () => {
  it('covers the horizon, then 7 more days per extension', () => {
    expect(setupEnd('2026-11-24', 3, 0)).toBe('2026-11-26')
    expect(setupEnd('2026-11-24', 3, 1)).toBe('2026-12-03')
  })
})

describe('relativeTime', () => {
  const t = Date.parse('2026-11-24T12:00:00Z')
  it('reads naturally', () => {
    expect(relativeTime('2026-11-24T11:59:40Z', t)).toBe('just now')
    expect(relativeTime('2026-11-24T11:56:00Z', t)).toBe('4 min')
    expect(relativeTime('2026-11-24T09:50:00Z', t)).toBe('2 h')
  })
})
