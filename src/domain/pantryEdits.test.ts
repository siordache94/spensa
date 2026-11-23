import { describe, expect, it } from 'vitest'
import { diffEdits, type EditLine } from './pantryEdits.ts'

const line = (p: Partial<EditLine> & { key: string }): EditLine => ({ batchId: p.key, ingredientId: 'i1', qty: 100, expiry: null, ...p })
const base = [line({ key: 'b1' }), line({ key: 'b2', qty: 50 })]

describe('diffEdits', () => {
  it('writes nothing when nothing changed', () => {
    expect(diffEdits(base, base.map((l) => ({ ...l })))).toEqual({ adjustments: [], newBatches: [], expiries: [] })
  })
  it('sets a changed amount, targeting that batch only', () => {
    const r = diffEdits(base, [{ ...base[0], qty: 80 }, base[1]])
    expect(r.adjustments).toEqual([{ batch_id: 'b1', ingredient_id: 'i1', kind: 'set', qty: 80 }])
  })
  it('records removal as finished or discard', () => {
    const r = diffEdits(base, [{ ...base[0], removed: 'finished' }, { ...base[1], removed: 'discard' }])
    expect(r.adjustments.map((a) => [a.batch_id, a.kind, a.qty])).toEqual([['b1', 'finished', null], ['b2', 'discard', null]])
  })
  it('inserts new lines as batches and skips empty or removed ones', () => {
    const r = diffEdits(base, [...base, line({ key: 'n1', batchId: null, ingredientId: 'i2', qty: 3, expiry: '2026-12-01' }), line({ key: 'n2', batchId: null, qty: 0 })])
    expect(r.newBatches).toEqual([{ ingredient_id: 'i2', qty: 3, expires_on: '2026-12-01' }])
    expect(r.adjustments).toEqual([])
  })
  it('compares quantities at three decimals, rounding a half up (as the screens show them)', () => {
    // toFixed would send 0.1235 down to 0.123 and report no change; round3 gives 0.124, so the edit is saved
    const r = diffEdits([line({ key: 'b1', qty: 0.123 })], [line({ key: 'b1', qty: 0.1235 })])
    expect(r.adjustments).toEqual([{ batch_id: 'b1', ingredient_id: 'i1', kind: 'set', qty: 0.1235 }])
  })
  it('reports expiry corrections without an adjustment', () => {
    const r = diffEdits(base, [{ ...base[0], expiry: '2026-12-05' }, base[1]])
    expect(r).toEqual({ adjustments: [], newBatches: [], expiries: [{ batch_id: 'b1', expires_on: '2026-12-05' }] })
  })
})
