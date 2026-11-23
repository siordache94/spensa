import { describe, expect, it } from 'vitest'
import { buildEvents } from './pantryRows'
import { mealLinesPayload, seedMealLines } from './mealLines'

describe('meal lines', () => {
  it('seeds from the recipe scaled to the portions, keeping to-taste', () => {
    expect(seedMealLines([{ ingredientId: 'a', qtyPerPortion: 80 }, { ingredientId: 'salt', qtyPerPortion: null }], 3)).toEqual([
      { ingredientId: 'a', qty: 240 },
      { ingredientId: 'salt', qty: null },
    ])
  })
  it('builds the RPC payload and refuses duplicates and non-positive amounts', () => {
    expect(mealLinesPayload([{ ingredientId: 'a', qty: 5 }, { ingredientId: 'b', qty: null }])).toEqual([
      { ingredient_id: 'a', qty_total: 5 },
      { ingredient_id: 'b', qty_total: null },
    ])
    expect(() => mealLinesPayload([{ ingredientId: 'a', qty: 5 }, { ingredientId: 'a', qty: 6 }])).toThrow()
    expect(() => mealLinesPayload([{ ingredientId: 'a', qty: 0 }])).toThrow()
  })
  it('rows become events: not_cooked and own lines reach the replay input', () => {
    const e = buildEvents({
      batches: [], adjustments: [], snapshot: null,
      meals: [
        { id: 'm1', date: '2026-11-05', portions: 2, not_cooked: true, planned_meal_lines: null, recipes: { recipe_ingredients: [{ ingredient_id: 'a', qty_per_portion: '80' }] } },
        { id: 'm2', date: '2026-11-05', portions: 2, planned_meal_lines: [{ ingredient_id: 'a', qty_total: '300' }, { ingredient_id: 'b', qty_total: null }], recipes: null },
        { id: 'm3', date: '2026-11-05', portions: 2, planned_meal_lines: [], recipes: null },
      ],
    }, 'Europe/Rome')
    expect(e.meals[0]).toMatchObject({ notCooked: true, override: undefined })
    expect(e.meals[1].override).toEqual([{ ingredientId: 'a', qty: 300 }, { ingredientId: 'b', qty: null }])
    expect(e.meals[2].override).toBeUndefined()
  })
})
