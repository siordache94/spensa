import { describe, expect, it } from 'vitest'
import { round1, round3 } from './format.ts'

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
