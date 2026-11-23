import { describe, expect, it } from 'vitest'
import {
  addDays,
  expiringSoon,
  replay,
  shoppingList,
  stockByIngredient,
  type Adjustment,
  type Batch,
  type Ingredient,
  type Meal,
  type PantryEvents,
} from './replay'

const batch = (id: string, qty: number, addedOn: string, expiresOn: string | null = null, ingredientId = 'pasta'): Batch => ({
  id,
  ingredientId,
  qty,
  addedOn,
  addedAt: `${addedOn}T09:00:00Z`,
  recordedAt: `${addedOn}T09:00:00Z`,
  expiresOn,
})
const meal = (id: string, date: string, portions: number, lines: Meal['lines']): Meal => ({ id, date, portions, lines })
const pasta80 = [{ ingredientId: 'pasta', qtyPerPortion: 80 }]
const adj = (a: Partial<Adjustment> & Pick<Adjustment, 'kind' | 'on'>): Adjustment => ({
  ingredientId: 'pasta',
  batchId: null,
  qty: null,
  at: `${a.on}T20:00:00Z`,
  recordedAt: `${a.on}T20:00:00Z`,
  ...a,
})
const ev = (e: Partial<PantryEvents>): PantryEvents => ({ batches: [], meals: [], adjustments: [], snapshot: null, ...e })

describe('replay', () => {
  it('meals take from the batch expiring soonest, undated last', () => {
    const e = ev({
      batches: [batch('dry', 500, '2026-11-01'), batch('fresh', 200, '2026-11-01', '2026-11-10')],
      meals: [meal('m', '2026-11-05', 4, pasta80)],
    })
    const { remaining, shortfalls } = replay(e, '2026-11-30')
    expect(remaining.get('fresh')).toBe(0)
    expect(remaining.get('dry')).toBe(380)
    expect(shortfalls).toEqual([])
  })

  it('skips batches expired on the meal day and reports the shortfall', () => {
    const e = ev({
      batches: [batch('old', 500, '2026-11-01', '2026-11-04')],
      meals: [meal('m', '2026-11-05', 2, pasta80)],
    })
    const { remaining, shortfalls } = replay(e, '2026-11-30')
    expect(remaining.get('old')).toBe(500)
    expect(shortfalls).toEqual([{ mealId: 'm', ingredientId: 'pasta', missing: 160 }])
  })

  it('never goes negative', () => {
    const e = ev({ batches: [batch('b', 100, '2026-11-01')], meals: [meal('m', '2026-11-02', 2, pasta80)] })
    const { remaining, shortfalls } = replay(e, '2026-11-30')
    expect(remaining.get('b')).toBe(0)
    expect(shortfalls[0].missing).toBe(60)
  })

  it('applies a batch bought on the meal day before the meal', () => {
    const e = ev({ batches: [batch('b', 500, '2026-11-05')], meals: [meal('m', '2026-11-05', 1, pasta80)] })
    expect(replay(e, '2026-11-05').remaining.get('b')).toBe(420)
  })

  it('ignores events after upTo', () => {
    const e = ev({ batches: [batch('b', 500, '2026-11-01')], meals: [meal('m', '2026-11-10', 1, pasta80)] })
    expect(replay(e, '2026-11-09').remaining.get('b')).toBe(500)
  })

  it('does not deduct to-taste lines', () => {
    const e = ev({
      batches: [batch('b', 500, '2026-11-01')],
      meals: [meal('m', '2026-11-02', 2, [{ ingredientId: 'pasta', qtyPerPortion: null }])],
    })
    expect(replay(e, '2026-11-30').remaining.get('b')).toBe(500)
  })

  describe('ordering by server time', () => {
    const snapshot = { onDate: '2026-11-10', takenAt: '2026-11-10T10:05:00Z', batches: [] }

    it('counts a batch ticked offline before the snapshot but recorded after it', () => {
      const late = { ...batch('milk', 1, '2026-11-10'), addedAt: '2026-11-10T10:00:00Z', recordedAt: '2026-11-10T10:10:00Z' }
      const { remaining } = replay(ev({ batches: [late], snapshot }), '2026-11-30')
      expect(remaining.get('milk')).toBe(1)
    })

    it('ignores a batch recorded before the snapshot that the snapshot does not list', () => {
      const early = { ...batch('milk', 1, '2026-11-10'), addedAt: '2026-11-10T10:20:00Z', recordedAt: '2026-11-10T10:00:00Z' }
      const { remaining } = replay(ev({ batches: [early], snapshot }), '2026-11-30')
      expect(remaining.get('milk') ?? 0).toBe(0)
    })

    it('treats a batch recorded exactly at taken_at as covered by the snapshot', () => {
      const same = { ...batch('milk', 1, '2026-11-10'), recordedAt: snapshot.takenAt }
      const { remaining } = replay(ev({ batches: [same], snapshot }), '2026-11-30')
      expect(remaining.get('milk') ?? 0).toBe(0)
    })

    const base = { ...batch('b', 100, '2026-11-01'), recordedAt: '2026-11-01T09:00:00Z' }
    const withB = { ...snapshot, batches: [{ batchId: 'b', qty: 100 }] }

    it('applies an adjustment made offline before the snapshot but recorded after it', () => {
      const a = adj({ kind: 'used', qty: 30, on: '2026-11-10', at: '2026-11-10T10:00:00Z', recordedAt: '2026-11-10T10:10:00Z' })
      const { remaining } = replay(ev({ batches: [base], adjustments: [a], snapshot: withB }), '2026-11-30')
      expect(remaining.get('b')).toBe(70)
    })

    it('ignores an adjustment recorded before the snapshot', () => {
      const a = adj({ kind: 'used', qty: 30, on: '2026-11-10', at: '2026-11-10T10:20:00Z', recordedAt: '2026-11-10T10:00:00Z' })
      const { remaining } = replay(ev({ batches: [base], adjustments: [a], snapshot: withB }), '2026-11-30')
      expect(remaining.get('b')).toBe(100)
    })
  })

  it('starts from the snapshot and ignores what it covers', () => {
    const e = ev({
      batches: [batch('a', 500, '2026-11-01'), batch('gone', 300, '2026-11-01'), batch('new', 200, '2026-11-12')],
      meals: [meal('before', '2026-11-05', 4, pasta80), meal('after', '2026-11-15', 1, pasta80)],
      adjustments: [adj({ kind: 'finished', on: '2026-11-06', batchId: 'a' })],
      snapshot: { onDate: '2026-11-10', takenAt: '2026-11-10T18:00:00Z', batches: [{ batchId: 'a', qty: 250 }] },
    })
    const { remaining } = replay(e, '2026-11-30')
    expect(remaining.get('gone') ?? 0).toBe(0)
    // 'after' takes 80 from whichever is first by FEFO; both undated, so the older batch 'a'
    expect(remaining.get('a')).toBe(170)
    expect(remaining.get('new')).toBe(200)
  })

  it('used X spills across batches; set, finished and discard hit the soonest batch', () => {
    const batches = [batch('soon', 100, '2026-11-01', '2026-11-08'), batch('late', 500, '2026-11-01', '2026-12-30')]
    const run = (a: Adjustment) => replay(ev({ batches, adjustments: [a] }), '2026-11-30').remaining
    const used = run(adj({ kind: 'used', qty: 150, on: '2026-11-03' }))
    expect([used.get('soon'), used.get('late')]).toEqual([0, 450])
    const set = run(adj({ kind: 'set', qty: 40, on: '2026-11-03' }))
    expect([set.get('soon'), set.get('late')]).toEqual([40, 500])
    const fin = run(adj({ kind: 'finished', on: '2026-11-03' }))
    expect([fin.get('soon'), fin.get('late')]).toEqual([0, 500])
    const dis = run(adj({ kind: 'discard', on: '2026-11-03', batchId: 'late' }))
    expect([dis.get('soon'), dis.get('late')]).toEqual([100, 0])
  })
})

describe('replay consumed', () => {
  it('records what each meal took from which batch, skipping zero takes', () => {
    const e = ev({
      batches: [batch('fresh', 200, '2026-11-01', '2026-11-10'), batch('dry', 500, '2026-11-01')],
      meals: [meal('m1', '2026-11-05', 3, pasta80), meal('m2', '2026-11-06', 2, pasta80)],
    })
    expect(replay(e, '2026-11-30').consumed).toEqual([
      { mealId: 'm1', batchId: 'fresh', qty: 200 },
      { mealId: 'm1', batchId: 'dry', qty: 40 },
      { mealId: 'm2', batchId: 'dry', qty: 160 },
    ])
  })
})

describe('derived views', () => {
  it('sums stock per ingredient', () => {
    const e = ev({ batches: [batch('a', 100, '2026-11-01'), batch('b', 50, '2026-11-01'), batch('c', 2, '2026-11-01', null, 'eggs')] })
    const stock = stockByIngredient(e, replay(e, '2026-11-30').remaining)
    expect(stock.get('pasta')).toBe(150)
    expect(stock.get('eggs')).toBe(2)
  })

  it('lists batches expiring within the threshold, including expired ones', () => {
    const e = ev({
      batches: [batch('x', 1, '2026-11-01', '2026-11-19'), batch('y', 1, '2026-11-01', '2026-11-23'), batch('z', 1, '2026-11-01', '2026-11-24')],
    })
    const soon = expiringSoon(e, replay(e, '2026-11-20').remaining, '2026-11-20', 3)
    expect(soon.map((b) => b.id)).toEqual(['x', 'y'])
  })

  it('addDays crosses months', () => {
    expect(addDays('2026-11-29', 3)).toBe('2026-12-02')
  })
})

describe('shoppingList', () => {
  const ingredients: Ingredient[] = [
    { id: 'pasta', unit: 'g', packSize: 500, minStock: null, onHand: true },
    { id: 'milk', unit: 'ml', packSize: 1000, minStock: 1000, onHand: true },
    { id: 'salt', unit: 'to_taste', packSize: null, minStock: null, onHand: false },
  ]

  it('needs planned amount minus usable stock after earlier meals', () => {
    const e = ev({
      batches: [batch('b', 300, '2026-11-01', '2026-11-25')],
      meals: [
        meal('past', '2026-11-20', 1, pasta80), // eaten before the range
        meal('m1', '2026-11-24', 2, pasta80), // 160 of the remaining 220
        meal('m2', '2026-11-26', 2, pasta80), // batch expired by then: need all 160
      ],
    })
    expect(shoppingList(e, [ingredients[0]], '2026-11-23', '2026-11-29')).toEqual([
      { ingredientId: 'pasta', qty: 160, packs: 1 },
    ])
  })

  it('tops staples up to min stock and lists to-taste items marked out', () => {
    const e = ev({
      batches: [batch('m', 400, '2026-11-01', null, 'milk')],
      meals: [meal('m1', '2026-11-24', 2, [{ ingredientId: 'salt', qtyPerPortion: null }])],
    })
    expect(shoppingList(e, ingredients, '2026-11-23', '2026-11-29')).toEqual([
      { ingredientId: 'milk', qty: 600, packs: 1 },
      { ingredientId: 'salt', qty: null, packs: null },
    ])
  })

  it('with mealIds, counts only the selected meals in range', () => {
    const e = ev({
      meals: [meal('m1', '2026-11-24', 2, pasta80), meal('m2', '2026-11-25', 2, pasta80)],
    })
    expect(shoppingList(e, [ingredients[0]], '2026-11-23', '2026-11-29')).toEqual([{ ingredientId: 'pasta', qty: 320, packs: 1 }])
    expect(shoppingList(e, [ingredients[0]], '2026-11-23', '2026-11-29', new Set(['m2']))).toEqual([
      { ingredientId: 'pasta', qty: 160, packs: 1 },
    ])
  })

  it('an unselected earlier meal still eats the stock, so the selected later meal is fully short', () => {
    const e = ev({
      batches: [batch('b', 160, '2026-11-01')],
      meals: [meal('m1', '2026-11-24', 2, pasta80), meal('m2', '2026-11-25', 2, pasta80)],
    })
    expect(shoppingList(e, [ingredients[0]], '2026-11-23', '2026-11-29', new Set(['m2']))).toEqual([
      { ingredientId: 'pasta', qty: 160, packs: 1 },
    ])
  })

  it('with mealIds, lists a to-taste item only if a selected meal uses it', () => {
    const e = ev({
      meals: [
        meal('m1', '2026-11-24', 1, [{ ingredientId: 'salt', qtyPerPortion: null }]),
        meal('m2', '2026-11-25', 1, pasta80),
      ],
    })
    const both = [ingredients[0], ingredients[2]]
    expect(shoppingList(e, both, '2026-11-23', '2026-11-29', new Set(['m2']))).toEqual([{ ingredientId: 'pasta', qty: 80, packs: 1 }])
    expect(shoppingList(e, both, '2026-11-23', '2026-11-29', new Set(['m1']))).toEqual([{ ingredientId: 'salt', qty: null, packs: null }])
  })

  it('omitting mealIds is the same as selecting every meal in range', () => {
    const e = ev({
      batches: [batch('b', 300, '2026-11-01', '2026-11-25')],
      meals: [meal('m1', '2026-11-24', 2, pasta80), meal('m2', '2026-11-26', 2, pasta80), meal('m3', '2026-11-25', 1, [{ ingredientId: 'salt', qtyPerPortion: null }])],
    })
    const all = new Set(['m1', 'm2', 'm3'])
    expect(shoppingList(e, ingredients, '2026-11-23', '2026-11-29', all)).toEqual(shoppingList(e, ingredients, '2026-11-23', '2026-11-29'))
  })
})

describe('didn\'t cook and per-meal amounts (ADR 0005)', () => {
  const stock = ev({ batches: [batch('p', 300, '2026-11-01')] })

  it('a not-cooked meal consumes nothing and is never short', () => {
    const e = { ...stock, meals: [{ ...meal('m', '2026-11-05', 4, pasta80), notCooked: true }] }
    const r = replay(e, '2026-11-10')
    expect(r.remaining.get('p')).toBe(300)
    expect(r.shortfalls).toEqual([])
    expect(r.consumed).toEqual([])
  })

  it('a not-cooked meal leaves more for later meals', () => {
    const e = { ...stock, meals: [{ ...meal('a', '2026-11-05', 4, pasta80), notCooked: true }, meal('b', '2026-11-06', 3, pasta80)] }
    const r = replay(e, '2026-11-10')
    expect(r.remaining.get('p')).toBe(60)
    expect(r.shortfalls).toEqual([])
  })

  it('does not put a not-cooked meal on the shopping list', () => {
    const e = { ...ev({}), meals: [{ ...meal('m', '2026-11-05', 2, [...pasta80, { ingredientId: 'salt', qtyPerPortion: null }]), notCooked: true }] }
    const ings: Ingredient[] = [
      { id: 'pasta', unit: 'g', packSize: null, minStock: null, onHand: false },
      { id: 'salt', unit: 'to_taste', packSize: null, minStock: null, onHand: false },
    ]
    expect(shoppingList(e, ings, '2026-11-01', '2026-11-30')).toEqual([])
  })

  it('own amounts replace the recipe lines for that meal', () => {
    const e = { ...stock, meals: [{ ...meal('m', '2026-11-05', 2, pasta80), override: [{ ingredientId: 'pasta', qty: 200 }] }] }
    const r = replay(e, '2026-11-10')
    expect(r.remaining.get('p')).toBe(100) // 200 g, not the recipe's 2 x 80 g
  })

  it('own amounts can add an ingredient the recipe does not have, and drop one it has', () => {
    const e = {
      batches: [batch('p', 300, '2026-11-01'), batch('c', 100, '2026-11-01', null, 'cheese'), batch('s', 100, '2026-11-01', null, 'sauce')],
      meals: [{
        ...meal('m', '2026-11-05', 2, [...pasta80, { ingredientId: 'sauce', qtyPerPortion: 50 }]),
        override: [{ ingredientId: 'pasta', qty: 160 }, { ingredientId: 'cheese', qty: 40 }],
      }],
      adjustments: [], snapshot: null,
    }
    const r = replay(e, '2026-11-10')
    expect(r.remaining.get('p')).toBe(140)
    expect(r.remaining.get('c')).toBe(60)
    expect(r.remaining.get('s')).toBe(100) // the recipe's sauce was left out of this meal
  })

  it('own amounts that exceed stock are a shortfall for that meal', () => {
    const e = { ...stock, meals: [{ ...meal('m', '2026-11-05', 2, pasta80), override: [{ ingredientId: 'pasta', qty: 350 }] }] }
    expect(replay(e, '2026-11-10').shortfalls).toEqual([{ mealId: 'm', ingredientId: 'pasta', missing: 50 }])
  })

  it('an empty override follows the recipe, and a null amount is to taste (consumes nothing)', () => {
    expect(replay({ ...stock, meals: [{ ...meal('m', '2026-11-05', 2, pasta80), override: [] }] }, '2026-11-10').remaining.get('p')).toBe(140)
    const e = { ...stock, meals: [{ ...meal('m', '2026-11-05', 2, pasta80), override: [{ ingredientId: 'pasta', qty: null }] }] }
    expect(replay(e, '2026-11-10').remaining.get('p')).toBe(300)
  })

  it('own amounts count for the shopping list', () => {
    const e = { ...ev({ batches: [batch('p', 100, '2026-11-01')] }), meals: [{ ...meal('m', '2026-11-05', 1, pasta80), override: [{ ingredientId: 'pasta', qty: 250 }] }] }
    const ings: Ingredient[] = [{ id: 'pasta', unit: 'g', packSize: null, minStock: null, onHand: false }]
    expect(shoppingList(e, ings, '2026-11-01', '2026-11-30')).toEqual([{ ingredientId: 'pasta', qty: 150, packs: null }])
  })
})

describe('same-day meal order (slotOrder)', () => {
  const dayMeal = (id: string, slot: string, position = 0): Meal => ({ ...meal(id, '2026-11-05', 1, pasta80), slot, position })
  const stock100 = [batch('p', 100, '2026-11-01')]

  it('with slotOrder, lunch eats before dinner on the same day even when dinner was saved first', () => {
    const e = ev({ batches: stock100, meals: [dayMeal('dinner', 'dinner'), dayMeal('lunch', 'lunch')], slotOrder: ['lunch', 'dinner'] })
    const { remaining, shortfalls } = replay(e, '2026-11-30')
    expect(remaining.get('p')).toBe(0) // lunch 80, then dinner takes the last 20
    expect(shortfalls).toEqual([{ mealId: 'dinner', ingredientId: 'pasta', missing: 60 }])
  })

  it('without slotOrder, the stored order is kept: dinner saved first takes the stock', () => {
    const e = ev({ batches: stock100, meals: [dayMeal('dinner', 'dinner'), dayMeal('lunch', 'lunch')] })
    const { shortfalls } = replay(e, '2026-11-30')
    expect(shortfalls).toEqual([{ mealId: 'lunch', ingredientId: 'pasta', missing: 60 }])
  })

  it('unknown slots go after known ones; within a slot, position then id decide', () => {
    const e = ev({
      batches: stock100,
      meals: [dayMeal('snack', 'snack'), dayMeal('dinner-b', 'dinner', 1), dayMeal('dinner-a', 'dinner', 0)],
      slotOrder: ['lunch', 'dinner'],
    })
    const { shortfalls } = replay(e, '2026-11-30')
    // order: dinner-a (80), dinner-b (20 left, short 60), snack (nothing left, short 80)
    expect(shortfalls).toEqual([
      { mealId: 'dinner-b', ingredientId: 'pasta', missing: 60 },
      { mealId: 'snack', ingredientId: 'pasta', missing: 80 },
    ])
  })
})
