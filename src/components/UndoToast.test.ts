import { describe, expect, it } from 'vitest'
import { notBoughtLine, undoMessage } from './UndoToast.tsx'

describe('undoMessage', () => {
  it('says bought for purchases and to-taste rows, checked for free-text items', () => {
    expect(undoMessage('buy', 'Milk')).toBe('Bought Milk')
    expect(undoMessage('toTaste', 'Salt')).toBe('Bought Salt')
    expect(undoMessage('checkText', 'Bread')).toBe('Checked Bread')
  })
})

describe('notBoughtLine', () => {
  it('is null when nothing is left to buy', () => {
    expect(notBoughtLine(0)).toBeNull()
  })
  it('uses the singular for one item', () => {
    expect(notBoughtLine(1)).toBe('1 item not bought')
  })
  it('uses the plural otherwise', () => {
    expect(notBoughtLine(4)).toBe('4 items not bought')
  })
})
