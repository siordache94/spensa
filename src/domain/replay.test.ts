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
  expiresOn,
})
const meal = (id: string, date: string, portions: number, lines: Meal['lines']): Meal => ({ id, date, portions, lines })
const pasta80 = [{ ingredientId: 'pasta', qtyPerPortion: 80 }]
const adj = (a: Partial<Adjustment> & Pick<Adjustment, 'kind' | 'on'>): Adjustment => ({
  ingredientId: 'pasta',
  batchId: null,
  qty: null,
  at: `${a.on}T20:00:00Z`,
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
})
