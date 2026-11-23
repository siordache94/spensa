import { describe, expect, it } from 'vitest'
import { markBought, restoreBought, toBuy } from './shopList.ts'

const items = [{ id: 'a', qty: 2 }, { id: 'b', qty: 1, bought_batch_id: null }]

describe('shop list', () => {
  it('hides bought items from the to-buy list', () => {
    expect(toBuy(markBought(items, 'a', 'x')).map((i) => i.id)).toEqual(['b'])
  })
  it('untick restores the same item untouched', () => {
    expect(restoreBought(markBought(items, 'a', 'x'), 'x')[0]).toEqual({ id: 'a', qty: 2, bought_batch_id: null })
  })
  it('restoring an unrelated batch changes nothing', () => {
    const bought = markBought(items, 'a', 'x')
    expect(restoreBought(bought, 'other')).toEqual(bought)
  })
})
