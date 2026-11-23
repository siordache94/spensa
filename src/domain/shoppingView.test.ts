import { describe, expect, it } from 'vitest'
import { replay, type Batch, type Meal, type Need, type PantryEvents } from './replay.ts'
import { buildShoppingView, groupByAisle, packLabel, snapshotPlan, type Entry, type ShoppingViewInput } from './shoppingView.ts'
import type { ShoppingItemRow } from '../lib/api/port.ts'

const batch = (id: string, qty: number): Batch => ({
  id, ingredientId: 'rice', qty, addedOn: '2026-01-01', addedAt: '2026-01-01T09:00:00Z', recordedAt: '2026-01-01T09:00:00Z', expiresOn: null,
})
const meal = (id: string, date: string, qty: number): Meal => ({ id, date, portions: 1, lines: [{ ingredientId: 'rice', qtyPerPortion: qty }] })
const events: PantryEvents = {
  batches: [batch('b1', 1000)],
  meals: [meal('m1', '2026-01-02', 300), meal('m2', '2026-01-03', 200)],
  adjustments: [],
  snapshot: null,
}
const TODAY = '2026-01-02'

describe('snapshotPlan', () => {
  it('with no "didn\'t cook" answers, saves the replay on screen as is, rounded to 3 decimals', () => {
    const { remaining } = replay(events, TODAY)
    const plan = snapshotPlan({ events, today: TODAY, remaining, unreadMealIds: [], notCooked: new Set() })
    expect(plan.answers).toEqual([])
    // 1000 g bought, 300 g eaten today (m1): 700 g left
    expect(plan.batches).toEqual([{ batch_id: 'b1', qty: 700 }])
  })

  it('answers every unread check-in, "planned" unless the dialog chose "didn\'t cook"', () => {
    const { remaining } = replay(events, TODAY)
    const plan = snapshotPlan({ events, today: TODAY, remaining, unreadMealIds: ['m1', 'm2'], notCooked: new Set(['m2']) })
    expect(plan.answers).toEqual([
      { meal_id: 'm1', answer: 'planned' },
      { meal_id: 'm2', answer: 'not_cooked' },
    ])
  })

  it('a "didn\'t cook" meal takes nothing from stock, so the snapshot keeps the 300 g', () => {
    const { remaining } = replay(events, TODAY)
    // m1 (today) is marked not cooked: its 300 g are not taken, so all 1000 g are left, not 700 g.
    const plan = snapshotPlan({ events, today: TODAY, remaining, unreadMealIds: ['m1'], notCooked: new Set(['m1']) })
    expect(plan.batches).toEqual([{ batch_id: 'b1', qty: 1000 }])
  })

  it('never includes empty batches', () => {
    const ev: PantryEvents = { ...events, meals: [], batches: [batch('b1', 0), batch('b2', 50)] }
    const { remaining } = replay(ev, TODAY)
    expect(snapshotPlan({ events: ev, today: TODAY, remaining, unreadMealIds: [], notCooked: new Set() }).batches).toEqual([{ batch_id: 'b2', qty: 50 }])
  })
})

const DAY = '2026-01-05'
// ---- buildShoppingView ---------------------------------------------------------------------------------------------

const ing = (id: string, over: Partial<ShoppingViewInput['ingredients'][number]> = {}): ShoppingViewInput['ingredients'][number] => ({
  id, name: id, unit: 'g', category: null, pack_size: null, shelf_life_days: null, on_hand: false, ...over,
})
const item = (id: string, over: Partial<ShoppingItemRow> = {}): ShoppingItemRow => ({
  id, ingredient_id: null, text: null, checked: false, qty: null, bought_batch_id: null, ingredients: null, ...over,
} as ShoppingItemRow)
const need = (ingredientId: string, qty: number | null, packs: number | null = null): Need => ({ ingredientId, qty, packs })
const base = (over: Partial<ShoppingViewInput> = {}): ShoppingViewInput => ({
  needs: [], stapleIds: new Set(), ingredients: [], items: [], batches: [], authors: {}, today: DAY, me: 'me', acked: [], tasted: [], ...over,
})
const names = (rows: Entry[]) => rows.map((r) => r.name)

describe('groupByAisle', () => {
  const e = (name: string, category: string | null): Entry => ({ key: name, name, category, tick: { kind: 'checkText', itemId: name } })

  it('walks the store: known aisles in order, other named aisles A-Z, uncategorised last', () => {
    const groups = groupByAisle([
      e('bread', 'Bakery'),
      e('milk', 'Dairy'),
      e('apple', 'produce'),
      e('cake', 'Bakery'),
      e('soap', null),
      e('ice', 'frozen'),
      e('tin', 'Other'),
      e('fish', 'Fish'),
    ])
    expect(groups.map(([c]) => c)).toEqual(['produce', 'Dairy', 'Fish', 'frozen', 'Bakery', null])
  })

  it('merges a real "other" category with the uncategorised rows at the end', () => {
    const groups = groupByAisle([e('a', 'other'), e('b', null), e('c', 'Dry Goods')])
    expect(groups.map(([c, rows]) => [c, names(rows)])).toEqual([['Dry Goods', ['c']], [null, ['a', 'b']]])
  })

  it('no rows, no groups', () => {
    expect(groupByAisle([])).toEqual([])
  })
})

describe('buildShoppingView: trip needs', () => {
  it('buys the need, at least one pack, rounded to 3 decimals; the figure is rounded to 1', () => {
    const view = buildShoppingView(base({
      ingredients: [ing('rice', { pack_size: 500 }), ing('oats')],
      needs: [need('rice', 120, 1), need('oats', 1.23456)],
    }))
    const rice = view.entries.find((e) => e.key === 'need-rice')!
    const oats = view.entries.find((e) => e.key === 'need-oats')!
    expect(rice.buy?.qty).toBe(500)
    expect(rice.figure).toBe('120')
    expect(oats.buy?.qty).toBe(1.235)
    expect(oats.figure).toBe('1.2')
  })

  it('expiry is today plus the shelf life, or none without one', () => {
    const view = buildShoppingView(base({
      ingredients: [ing('milk', { shelf_life_days: 7 }), ing('salt')],
      needs: [need('milk', 1000), need('salt', 1000)],
    }))
    expect(view.entries.find((e) => e.name === 'milk')?.buy?.expiresOn).toBe('2026-01-12')
    expect(view.entries.find((e) => e.name === 'salt')?.buy?.expiresOn).toBeNull()
  })

  it('a staple below min stock carries the note; a meal need does not', () => {
    const view = buildShoppingView(base({
      ingredients: [ing('flour'), ing('pasta')],
      needs: [need('flour', 500), need('pasta', 200)],
      stapleIds: new Set(['flour']),
    }))
    expect(view.entries.find((e) => e.name === 'flour')?.note).toBe('Staple, below min stock')
    expect(view.entries.find((e) => e.name === 'pasta')?.note).toBeUndefined()
  })

  it('pack count reads "≈ n packs" / "1 pack"', () => {
    expect(packLabel(2)).toBe('≈ 2 packs')
    expect(packLabel(1)).toBe('≈ 1 pack')
    expect(packLabel(null)).toBeUndefined()
    const view = buildShoppingView(base({ ingredients: [ing('rice', { pack_size: 500 })], needs: [need('rice', 600, 2)] }))
    expect(view.entries[0].pack).toBe('≈ 2 packs')
  })

  it('a to-taste need is a row with no amount to buy, ticked as "mark on hand"', () => {
    const view = buildShoppingView(base({ ingredients: [ing('salt', { unit: 'to_taste' })], needs: [need('salt', null)] }))
    const row = view.entries[0]
    expect(row.free).toBe('to taste')
    expect(row.buy).toBeUndefined()
    expect(row.tick).toEqual({ kind: 'toTaste', ingredientId: 'salt' })
  })

  it('a need for an ingredient that is not in the catalogue is skipped', () => {
    expect(buildShoppingView(base({ needs: [need('ghost', 10)] })).entries).toEqual([])
  })
})

describe('buildShoppingView: manual list', () => {
  it('a list item for an ingredient uses its own quantity; without one it is one pack, else 1', () => {
    const view = buildShoppingView(base({
      ingredients: [ing('eggs', { pack_size: 6 }), ing('honey')],
      items: [
        item('i1', { ingredient_id: 'eggs', qty: 12, ingredients: { name: 'eggs', unit: 'count', category: 'dairy' } }),
        item('i2', { ingredient_id: 'eggs', ingredients: { name: 'eggs', unit: 'count', category: 'dairy' } }),
        item('i3', { ingredient_id: 'honey', ingredients: { name: 'honey', unit: 'g', category: null } }),
      ],
    }))
    const [a, b, c] = view.entries
    expect(a.buy?.qty).toBe(12)
    expect(a.buy?.shoppingItemId).toBe('i1')
    expect(a.figure).toBe('12')
    expect(b.buy?.qty).toBe(6)
    expect(b.figure).toBeUndefined()
    expect(c.buy?.qty).toBe(1)
  })

  it('a bought list item leaves the list and shows in the cart as its batch', () => {
    const view = buildShoppingView(base({
      ingredients: [ing('rice')],
      items: [item('i1', { ingredient_id: 'rice', bought_batch_id: 'b9', ingredients: { name: 'rice', unit: 'g', category: null } })],
      batches: [{ id: 'b9', ingredientId: 'rice', qty: 500, addedOn: DAY, addedAt: '2026-01-05T08:00:00Z', recordedAt: '', expiresOn: null }],
      authors: { b9: 'me' },
    }))
    expect(view.entries).toEqual([])
    expect(view.cart.map((c) => [c.key, c.name, c.untick])).toEqual([['batch-b9', 'rice', { kind: 'unbuy', batchId: 'b9' }]])
  })

  it('free text is on the list until ticked; ticked text is counted for the cart and not listed', () => {
    const view = buildShoppingView(base({
      items: [item('t1', { text: 'bread', checked: false }), item('t2', { text: 'batteries', checked: true })],
    }))
    expect(names(view.entries)).toEqual(['bread'])
    expect(view.entries[0].tick).toEqual({ kind: 'checkText', itemId: 't1' })
    expect(view.checkedTextCount).toBe(1)
    expect(view.cart.map((c) => [c.name, c.untick])).toEqual([['batteries', { kind: 'uncheck', itemId: 't2' }]])
  })

  it('the list is sorted by name, and the groups keep that order', () => {
    const view = buildShoppingView(base({
      ingredients: [ing('zucchini', { category: 'produce' }), ing('apple', { category: 'produce' }), ing('beans')],
      needs: [need('zucchini', 100), need('apple', 100), need('beans', 100)],
    }))
    expect(names(view.entries)).toEqual(['apple', 'beans', 'zucchini'])
    expect(view.groups.map(([c, rows]) => [c, names(rows)])).toEqual([['produce', ['apple', 'zucchini']], [null, ['beans']]])
  })
})

describe('buildShoppingView: cart and partner', () => {
  const batches = [
    { id: 'old', ingredientId: 'rice', qty: 500, addedOn: '2026-01-04', addedAt: '2026-01-04T10:00:00Z', recordedAt: '', expiresOn: null },
    { id: 'mine', ingredientId: 'rice', qty: 200, addedOn: DAY, addedAt: '2026-01-05T08:00:00Z', recordedAt: '', expiresOn: null },
    { id: 'theirs', ingredientId: 'oats', qty: 1000, addedOn: DAY, addedAt: '2026-01-05T09:00:00Z', recordedAt: '', expiresOn: null },
  ]
  const ingredients = [ing('rice'), ing('oats')]

  it('the cart is today\'s purchases, newest first; yesterday\'s are not in it', () => {
    const view = buildShoppingView(base({ ingredients, batches, authors: { mine: 'me', theirs: 'me', old: 'me' } }))
    expect(view.cart.map((c) => c.id)).toEqual(['theirs', 'mine'])
    expect(view.cart[1]).toMatchObject({ name: 'rice', figure: '200', unit: 'g', held: false, untick: { kind: 'unbuy', batchId: 'mine' } })
  })

  it('a partner purchase is held until acknowledged; its time is shown', () => {
    const authors = { mine: 'me', theirs: 'partner' }
    const held = buildShoppingView(base({ ingredients, batches, authors, acked: [] }))
    const row = held.cart.find((c) => c.id === 'theirs')!
    expect(row.held).toBe(true)
    expect(row.at).toBe('2026-01-05T09:00:00Z')

    const acked = buildShoppingView(base({ ingredients, batches, authors, acked: ['theirs'] }))
    expect(acked.cart.find((c) => c.id === 'theirs')!.held).toBe(false)
  })

  it('my own purchase is never held, even if not acknowledged', () => {
    const view = buildShoppingView(base({ ingredients, batches, authors: { mine: 'me', theirs: 'me' }, acked: [] }))
    expect(view.cart.every((c) => !c.held)).toBe(true)
  })

  it('with no known user, nothing counts as a partner purchase', () => {
    const view = buildShoppingView(base({ ingredients, batches, authors: { theirs: 'partner' }, me: null }))
    expect(view.cart.find((c) => c.id === 'theirs')!.held).toBe(false)
    expect(view.partnerLast).toBeUndefined()
  })

  it('partnerLast is the newest purchase by the partner today', () => {
    const view = buildShoppingView(base({ ingredients, batches, authors: { mine: 'me', theirs: 'partner' } }))
    expect(view.partnerLast).toEqual({ name: 'oats', addedAt: '2026-01-05T09:00:00Z' })
  })

  it('a to-taste item ticked this visit is in the cart only while it is on hand', () => {
    const on = buildShoppingView(base({ ingredients: [ing('salt', { unit: 'to_taste', on_hand: true })], tasted: ['salt'] }))
    expect(on.cart).toEqual([expect.objectContaining({ key: 'taste-salt', free: 'to taste', untick: { kind: 'unOnHand', ingredientId: 'salt' } })])
    const off = buildShoppingView(base({ ingredients: [ing('salt', { unit: 'to_taste', on_hand: false })], tasted: ['salt'] }))
    expect(off.cart).toEqual([])
  })

  it('the cart lists batches, then to-taste items, then ticked text', () => {
    const view = buildShoppingView(base({
      ingredients: [ing('rice'), ing('salt', { unit: 'to_taste', on_hand: true })],
      batches: [{ id: 'b', ingredientId: 'rice', qty: 1, addedOn: DAY, addedAt: '2026-01-05T08:00:00Z', recordedAt: '', expiresOn: null }],
      items: [item('t', { text: 'tape', checked: true })],
      tasted: ['salt'],
      authors: { b: 'me' },
    }))
    expect(view.cart.map((c) => c.key)).toEqual(['batch-b', 'taste-salt', 'text-t'])
  })

  it('a batch of an ingredient that is no longer known is left out of the cart', () => {
    const view = buildShoppingView(base({ ingredients: [], batches: [{ id: 'x', ingredientId: 'gone', qty: 1, addedOn: DAY, addedAt: '', recordedAt: '', expiresOn: null }] }))
    expect(view.cart).toEqual([])
  })
})
