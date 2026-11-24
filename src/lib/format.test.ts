import { describe, expect, it } from 'vitest'
import { formatDay, formatQuantity, round1, round3, visibleUnit } from './format.ts'

describe('round1 / round3', () => {
  it('rounds to one and three decimals', () => {
    expect(round1(12.34)).toBe(12.3)
    expect(round1(12.36)).toBe(12.4)
    expect(round3(1 / 3)).toBe(0.333)
    expect(round3(2 / 3)).toBe(0.667)
  })

  it('agrees with the toFixed version on the values the screens show', () => {
    const toFixed3 = (n: number) => Number(n.toFixed(3))
    const typical = [0, 0.5, 1, 2.25, 7.125, 80, 100, 123.456, 250, 500, 1000, 0.333, 0.0042, 3.14159, 1.9996]
    for (const n of typical) expect(round3(n)).toBe(toFixed3(n))
  })

  it('agrees with toFixed on a sum of 3-decimal quantities', () => {
    const batches = [0.125, 0.25, 0.5, 1.125]
    const sum = batches.reduce((s, x) => s + x, 0)
    expect(round3(sum)).toBe(Number(sum.toFixed(3)))
  })

  it('differs from toFixed only on exact binary halves at the third decimal', () => {
    // documented difference: toFixed sends 0.1235 down, Math.round sends it up
    expect(round3(0.1235)).toBe(0.124)
    expect(Number((0.1235).toFixed(3))).toBe(0.123)
  })

  it('rounds the whole quantity unit to the nearest step', () => {
    expect(round1(0.04)).toBe(0)
    expect(round1(0.05)).toBe(0.1)
  })
})

describe('formatDay', () => {
  it('renders the short date the list rows share', () => {
    expect(formatDay('2026-11-23')).toBe('23 Nov')
  })

  it('uses the same locale whatever the device locale', () => {
    expect(formatDay('2026-11-23', { day: 'numeric', month: 'short', year: 'numeric' })).toBe('23 Nov 2026')
    expect(formatDay('2026-11-23', { weekday: 'short', day: 'numeric', month: 'short' })).toBe('Mon 23 Nov')
  })

  it('keeps a calendar day on its UTC day', () => {
    expect(formatDay('2026-01-01')).toBe('1 Jan')
  })
})

describe('visibleUnit / formatQuantity', () => {
  it('never shows count as a unit', () => {
    expect(visibleUnit('count')).toBe('')
    expect(formatQuantity(4, 'count')).toBe('4')
  })

  it('keeps the metric units and drops the to-taste unit word', () => {
    expect(visibleUnit('g')).toBe('g')
    expect(formatQuantity(300, 'g')).toBe('300 g')
    expect(visibleUnit('to_taste')).toBe('')
  })

  it('has no unit when there is none', () => {
    expect(visibleUnit(undefined)).toBe('')
    expect(formatQuantity(2)).toBe('2')
  })
})
