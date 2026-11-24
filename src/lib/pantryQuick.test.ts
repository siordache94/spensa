import { describe, expect, it } from 'vitest'
import { applyQuickAction, changeSummary } from './pantryQuick.ts'
import type { EditLine } from '../domain/pantryEdits.ts'

const batch = (qty: number | null, extra: Partial<EditLine> = {}): EditLine => ({
  key: 'b1', batchId: 'b1', ingredientId: 'i1', qty, expiry: null, ...extra,
})
const fresh = (qty: number | null, extra: Partial<EditLine> = {}): EditLine => ({
  key: 'new-0', batchId: null, ingredientId: 'i1', qty, expiry: null, ...extra,
})

describe('applyQuickAction', () => {
  it('subtracts a used amount from the draft quantity', () => {
    expect(applyQuickAction(batch(750), 'used', 250)).toEqual({ qty: 500, removed: undefined })
  })

  it('keeps decimal quantities exact to three places', () => {
    expect(applyQuickAction(batch(0.75), 'used', 0.25).qty).toBe(0.5)
    expect(applyQuickAction(batch(1.2345), 'set', 0.33333).qty).toBe(0.333)
  })

  it('clamps a use larger than the batch to zero, never negative', () => {
    expect(applyQuickAction(batch(600), 'used', 900).qty).toBe(0)
  })

  it('sets the remaining quantity, including zero', () => {
    expect(applyQuickAction(batch(750), 'set', 500).qty).toBe(500)
    expect(applyQuickAction(batch(750), 'set', 0).qty).toBe(0)
  })

  it('clears a removal when the batch is amended back into stock', () => {
    expect(applyQuickAction(batch(750, { removed: 'finished' }), 'set', 500)).toEqual({ qty: 500, removed: undefined })
    expect(applyQuickAction(batch(750, { removed: 'discard' }), 'used', 250)).toEqual({ qty: 500, removed: undefined })
  })

  it('records why a batch left and keeps its last quantity', () => {
    expect(applyQuickAction(batch(600), 'finished')).toEqual({ qty: 600, removed: 'finished' })
    expect(applyQuickAction(batch(1), 'waste')).toEqual({ qty: 1, removed: 'discard' })
  })

  it('treats an empty quantity or a non-finite amount as zero', () => {
    expect(applyQuickAction(batch(null), 'set', 300)).toEqual({ qty: 300, removed: undefined })
    expect(applyQuickAction(batch(750), 'used', Number.NaN)).toEqual({ qty: 750, removed: undefined })
    expect(applyQuickAction(batch(750), 'used', -50)).toEqual({ qty: 750, removed: undefined })
  })
})

describe('changeSummary', () => {
  it('shows the amount before and after', () => {
    expect(changeSummary(batch(500), batch(750), 'g')).toBe('750 g → 500 g')
  })

  it('uses decimals as entered', () => {
    expect(changeSummary(batch(0.5), batch(0.75), 'g')).toBe('0.75 g → 0.5 g')
  })

  it('drops the unit for a count', () => {
    expect(changeSummary(batch(2), batch(4), 'count')).toBe('4 → 2')
  })

  it('names a finished batch', () => {
    expect(changeSummary(batch(600, { removed: 'finished' }), batch(600), 'g')).toBe('600 g → finished')
  })

  it('names a thrown-away batch', () => {
    expect(changeSummary(batch(600, { removed: 'discard' }), batch(600), 'g')).toBe('600 g → threw away')
  })

  it('returns null when the line did not change', () => {
    expect(changeSummary(batch(750), batch(750), 'g')).toBeNull()
    // an expiry-only correction is not an amount change
    expect(changeSummary(batch(750, { expiry: '2026-12-01' }), batch(750), 'g')).toBeNull()
  })

  it('returns null for a line added in this edit', () => {
    expect(changeSummary(fresh(500), undefined, 'g')).toBeNull()
  })

  it('returns null when the origin cannot be found', () => {
    expect(changeSummary(batch(500), undefined, 'g')).toBeNull()
  })
})
