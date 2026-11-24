import { describe, expect, it } from 'vitest'
import { buildEvents } from './pantryRows'
import { mealLinesPayload, recipeLinesPayload, seedMealLines } from './mealLines'

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

describe('recipe lines payload', () => {
  it('creating divides totals for N servings once, and to-taste stores null', () => {
    expect(recipeLinesPayload([
      { ingredientId: 'a', qty: 600, toTaste: false },
      { ingredientId: 'salt', qty: null, toTaste: true },
    ], 3, 'create')).toEqual([
      { ingredient_id: 'a', qty_per_portion: 200 },
      { ingredient_id: 'salt', qty_per_portion: null },
    ])
  })

  it('creating keeps decimal results', () => {
    expect(recipeLinesPayload([
      { ingredientId: 'a', qty: 100.5, toTaste: false },
      { ingredientId: 'b', qty: 1, toTaste: false },
    ], 2, 'create')).toEqual([
      { ingredient_id: 'a', qty_per_portion: 50.25 },
      { ingredient_id: 'b', qty_per_portion: 0.5 },
    ])
  })

  it('editing saves single-serving amounts exactly as typed, whatever the stored serves', () => {
    const lines = [
      { ingredientId: 'a', qty: 66.667, toTaste: false },
      { ingredientId: 'b', qty: 0.125, toTaste: false },
      { ingredientId: 'salt', qty: null, toTaste: true },
    ]
    expect(recipeLinesPayload(lines, 4, 'edit')).toEqual([
      { ingredient_id: 'a', qty_per_portion: 66.667 },
      { ingredient_id: 'b', qty_per_portion: 0.125 },
      { ingredient_id: 'salt', qty_per_portion: null },
    ])
  })

  it('to-taste lines ignore any typed amount', () => {
    expect(recipeLinesPayload([{ ingredientId: 'salt', qty: 3, toTaste: true }], 2, 'edit')).toEqual([
      { ingredient_id: 'salt', qty_per_portion: null },
    ])
  })

  it('refuses a missing ingredient, duplicates and non-positive amounts', () => {
    expect(() => recipeLinesPayload([{ ingredientId: null, qty: 1, toTaste: false }], 2, 'edit')).toThrow()
    expect(() => recipeLinesPayload([
      { ingredientId: 'a', qty: 1, toTaste: false },
      { ingredientId: 'a', qty: 2, toTaste: false },
    ], 2, 'edit')).toThrow()
    expect(() => recipeLinesPayload([{ ingredientId: 'a', qty: 0, toTaste: false }], 2, 'edit')).toThrow()
    expect(() => recipeLinesPayload([{ ingredientId: 'a', qty: -1, toTaste: false }], 2, 'edit')).toThrow()
    expect(() => recipeLinesPayload([{ ingredientId: 'a', qty: null, toTaste: false }], 2, 'edit')).toThrow()
  })

  it('refuses a create with no servings', () => {
    expect(() => recipeLinesPayload([], 0, 'create')).toThrow()
    expect(recipeLinesPayload([], 0, 'edit')).toEqual([])
  })
})
