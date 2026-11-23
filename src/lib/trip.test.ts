import { describe, expect, it } from 'vitest'
import { changeMessage, diffToBuy, relativeTime, selectedMealIds, tripRange } from './trip.ts'

describe('tripRange', () => {
  it('runs from today through the horizon', () => {
    expect(tripRange('2026-11-24', 7)).toEqual({ from: '2026-11-24', to: '2026-11-30' })
  })
  it('is just today with a horizon of 1', () => {
    expect(tripRange('2026-11-24', 1)).toEqual({ from: '2026-11-24', to: '2026-11-24' })
  })
})

describe('selectedMealIds', () => {
  const meals = [
    { id: 'a', date: '2026-11-24', skip_shopping: false },
    { id: 'b', date: '2026-11-25', skip_shopping: true },
    { id: 'c', date: '2026-11-26', skip_shopping: false },
    { id: 'd', date: '2026-12-09', skip_shopping: false },
    { id: 'e', date: '2026-11-23', skip_shopping: false },
  ]
  it('keeps meals in range that are not skipped', () => {
    expect([...selectedMealIds(meals, '2026-11-24', '2026-11-30')]).toEqual(['a', 'c'])
  })
})

describe('diffToBuy', () => {
  it('reports added and removed keys', () => {
    expect(diffToBuy(['x', 'y'], ['y', 'z', 'w'])).toEqual({ added: ['z', 'w'], removed: ['x'] })
  })
  it('is empty when nothing changed, whatever the order', () => {
    expect(diffToBuy(['x', 'y'], ['y', 'x'])).toEqual({ added: [], removed: [] })
  })
  it('does not count bought items as removed', () => {
    expect(diffToBuy(['x', 'y'], ['y'], new Set(['x']))).toEqual({ added: [], removed: [] })
  })
})

describe('changeMessage', () => {
  it('combines both counts', () => {
    expect(changeMessage('Anna', { added: [1, 2], removed: [3] })).toBe('Anna changed the list: 2 added, 1 removed')
  })
  it('names only what happened', () => {
    expect(changeMessage('Anna', { added: [], removed: [3] })).toBe('Anna changed the list: 1 removed')
  })
  it('is null for no change', () => {
    expect(changeMessage('Anna', { added: [], removed: [] })).toBeNull()
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
