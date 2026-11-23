import { describe, expect, it } from 'vitest'
import { finishAnswers, markNotCooked, recipeLines } from './checkinAnswers.ts'
import { replay, type PantryEvents } from './replay.ts'

describe('finishAnswers', () => {
  it('answers each unread meal as planned unless the dialog chose not cooked', () => {
    expect(finishAnswers(['a', 'b'], new Set(['b']))).toEqual([
      { meal_id: 'a', answer: 'planned' },
      { meal_id: 'b', answer: 'not_cooked' },
    ])
  })
  it('is empty when nothing is unread', () => {
    expect(finishAnswers([], new Set(['x']))).toEqual([])
  })
})

describe('markNotCooked', () => {
  const ev: PantryEvents = {
    batches: [{ id: 'b1', ingredientId: 'pasta', qty: 500, addedOn: '2026-11-01', addedAt: '2026-11-01T10:00:00Z', recordedAt: '2026-11-01T10:00:00Z', expiresOn: null }],
    meals: [
      { id: 'm1', date: '2026-11-20', portions: 2, lines: [{ ingredientId: 'pasta', qtyPerPortion: 100 }] },
      { id: 'm2', date: '2026-11-21', portions: 2, lines: [{ ingredientId: 'pasta', qtyPerPortion: 100 }] },
    ],
    adjustments: [],
    snapshot: null,
  }

  it('takes the marked meals out of the replay, so they consume nothing', () => {
    expect(replay(ev, '2026-11-23').remaining.get('b1')).toBe(100) // both meals eat 200
    expect(replay(markNotCooked(ev, new Set(['m1'])), '2026-11-23').remaining.get('b1')).toBe(300)
  })
  it('does not change the input', () => {
    markNotCooked(ev, new Set(['m1']))
    expect(ev.meals[0].notCooked).toBeUndefined()
  })
})

describe('recipeLines', () => {
  it('maps the embedded rows, numeric strings and to-taste lines included', () => {
    expect(
      recipeLines([
        { ingredient_id: 'pasta', qty_per_portion: '100.000' },
        { ingredient_id: 'salt', qty_per_portion: null },
      ]),
    ).toEqual([
      { ingredientId: 'pasta', qtyPerPortion: 100 },
      { ingredientId: 'salt', qtyPerPortion: null },
    ])
  })
})
