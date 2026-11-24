import { describe, expect, it } from 'vitest'
import { ACK_COYOTE_MS, ACK_DWELL_MS, rowFactsLabel, rowLabel, tapAction } from './shopRow.ts'

const AT = 1_000_000

describe('tapAction', () => {
  it('ticks an unheld list row', () => {
    expect(tapAction({ row: 'list', at: AT })).toBe('tick')
  })

  it('ticks a list row from its name: the name is part of the row, not an editor', () => {
    expect(tapAction({ row: 'list', target: 'name', at: AT })).toBe('tick')
  })

  it('opens the amount editor only from the pencil', () => {
    expect(tapAction({ row: 'list', target: 'pencil', at: AT })).toBe('edit')
  })

  it('treats a cart row name like the row itself', () => {
    expect(tapAction({ row: 'cart', target: 'name', at: AT })).toBe('untick')
    expect(tapAction({ row: 'cart', target: 'name', held: true, at: AT })).toBe('acknowledge')
  })

  it('acknowledges a held cart row and never untick it', () => {
    expect(tapAction({ row: 'cart', held: true, at: AT })).toBe('acknowledge')
    // even if an acknowledgement was just recorded, the highlight still owns the tap
    expect(tapAction({ row: 'cart', held: true, ackedAt: AT - 10, at: AT })).toBe('acknowledge')
  })

  it('untick a normal cart row', () => {
    expect(tapAction({ row: 'cart', at: AT })).toBe('untick')
    expect(tapAction({ row: 'cart', ackedAt: AT - ACK_COYOTE_MS, at: AT })).toBe('untick')
  })

  it('ignores a cart tap inside the coyote window after an acknowledgement', () => {
    expect(tapAction({ row: 'cart', ackedAt: AT, at: AT })).toBe('ignore')
    expect(tapAction({ row: 'cart', ackedAt: AT, at: AT + 1 })).toBe('ignore')
    expect(tapAction({ row: 'cart', ackedAt: AT, at: AT + ACK_COYOTE_MS - 1 })).toBe('ignore')
    // a backwards clock jump must not put the partner's purchase back
    expect(tapAction({ row: 'cart', ackedAt: AT, at: AT - 1 })).toBe('ignore')
  })

  it('always honours the explicit put-back control', () => {
    expect(tapAction({ row: 'cart', target: 'putBack', at: AT })).toBe('untick')
    expect(tapAction({ row: 'cart', target: 'putBack', held: true, at: AT })).toBe('untick')
    expect(tapAction({ row: 'cart', target: 'putBack', ackedAt: AT, at: AT })).toBe('untick')
  })

  it('walks a partner row from held to acknowledged to swept, never back to the cart', () => {
    // A tap while the highlight is up acknowledges (MR-044); the same tap after the dwell cleared it is swallowed by
    // the coyote window; only a later tap on the row is an explicit "put it back".
    expect(tapAction({ row: 'cart', held: true, at: AT })).toBe('acknowledge')
    expect(tapAction({ row: 'cart', held: false, ackedAt: AT, at: AT + 1 })).toBe('ignore')
    expect(tapAction({ row: 'cart', held: false, ackedAt: AT, at: AT + ACK_COYOTE_MS })).toBe('untick')
  })

  it('keeps the three-second dwell and the three-second coyote window', () => {
    expect(ACK_DWELL_MS).toBe(3000)
    expect(ACK_COYOTE_MS).toBe(3000)
  })
})

describe('rowFactsLabel', () => {
  it('reads name, amount, pack hint and note in shown order', () => {
    expect(rowFactsLabel({ name: 'Milk', figure: '2', unit: 'l', pack: '≈ 3 packs', note: 'Staple, below min stock' }))
      .toBe('Milk, 2 l, ≈ 3 packs, Staple, below min stock')
  })

  it('uses the free-text amount when there is no figure', () => {
    expect(rowFactsLabel({ name: 'Salt', free: 'to taste' })).toBe('Salt, to taste')
  })

  it('skips the facts a row does not show', () => {
    expect(rowFactsLabel({ name: 'Bread' })).toBe('Bread')
  })
})

describe('rowLabel', () => {
  it('names the action before the facts', () => {
    expect(rowLabel({ name: 'Milk', figure: '2', unit: 'l' }, 'buy')).toBe('Buy Milk, 2 l')
    expect(rowLabel({ name: 'Milk', figure: '2', unit: 'l' }, 'putBack')).toBe('Put back Milk, 2 l')
  })

  it('carries the partner note on an acknowledgement', () => {
    expect(rowLabel({ name: 'Milk', figure: '2', unit: 'l', note: 'ticked by partner · just now' }, 'acknowledge'))
      .toBe('Acknowledge Milk, 2 l, ticked by partner · just now')
  })
})
