import { describe, expect, it } from 'vitest'
import { buildEvents, buildIngredients, localDay } from './pantryRows.ts'
import { itemKey, needKey, resolvedKeys, toBuyKeys, type ShoppingItem } from './toBuy.ts'
import { diffToBuy } from '../lib/trip.ts'
import type { PantryEvents } from './replay.ts'

const ingredients = buildIngredients([
  { id: 'pasta', unit: 'g', pack_size: 500, min_stock: null, on_hand: false },
  { id: 'milk', unit: 'ml', pack_size: null, min_stock: 1000, on_hand: false },
  { id: 'salt', unit: 'to_taste', pack_size: null, min_stock: null, on_hand: false },
])
const meal = { id: 'm1', date: '2026-11-25', portions: 2, recipes: { recipe_ingredients: [{ ingredient_id: 'pasta', qty_per_portion: 100 }, { ingredient_id: 'salt', qty_per_portion: null }] } }
const events = (over: Partial<Parameters<typeof buildEvents>[0]> = {}): PantryEvents =>
  buildEvents({ batches: [], meals: [meal], adjustments: [], snapshot: null, ...over }, 'Europe/Rome')
const base = { ingredients, from: '2026-11-25', to: '2026-12-01', mealIds: new Set(['m1']), today: '2026-11-25' }
const item = (id: string, ingredientId: string | null, over: Partial<ShoppingItem> = {}): ShoppingItem => ({ id, ingredientId, checked: false, boughtBatchId: null, ...over })

describe('toBuyKeys', () => {
  it('lists needs (meal shortfall, staple below min stock, to-taste) and manual items', () => {
    const keys = toBuyKeys({ ...base, events: events(), items: [item('i1', null), item('i2', 'pasta')] })
    expect(keys.sort()).toEqual([needKey('milk'), needKey('pasta'), needKey('salt'), itemKey('i1'), itemKey('i2')].sort())
  })
  it('leaves out a skipped meal, a ticked free-text item and an item already bought', () => {
    const keys = toBuyKeys({ ...base, mealIds: new Set(), events: events(), items: [item('i1', null, { checked: true }), item('i2', 'pasta', { boughtBatchId: 'b' })] })
    expect(keys).toEqual([needKey('milk')])
  })
})

describe('what a partner changed (the toast rule, on the server)', () => {
  const before = toBuyKeys({ ...base, events: events(), items: [] })

  it('counts a manual item added', () => {
    const after = toBuyKeys({ ...base, events: events(), items: [item('i1', null)] })
    expect(diffToBuy(before, after)).toEqual({ added: [itemKey('i1')], removed: [] })
  })
  it('counts a meal skipped as removed', () => {
    const after = toBuyKeys({ ...base, mealIds: new Set(), events: events(), items: [] })
    expect(diffToBuy(before, after, resolvedKeys({ events: events(), ingredients, items: [], today: base.today })).removed.sort()).toEqual([needKey('pasta'), needKey('salt')])
  })
  it('does not count buying as removed', () => {
    const bought = events({ batches: [{ id: 'b1', ingredient_id: 'pasta', qty: 500, added_at: '2026-11-25T09:00:00Z', recorded_at: '2026-11-25T09:00:00Z', expires_on: null }] })
    const after = toBuyKeys({ ...base, events: bought, items: [] })
    const resolved = resolvedKeys({ events: bought, ingredients, items: [], today: base.today })
    expect(after).not.toContain(needKey('pasta'))
    expect(diffToBuy(before, after, resolved).removed).not.toContain(needKey('pasta'))
  })
  it('does not count ticking a manual item as removed, but a deleted one is', () => {
    const withItems = toBuyKeys({ ...base, events: events(), items: [item('i1', null), item('i2', null)] })
    const ticked = [item('i1', null, { checked: true }), item('i2', null)]
    const afterTick = toBuyKeys({ ...base, events: events(), items: ticked })
    expect(diffToBuy(withItems, afterTick, resolvedKeys({ events: events(), ingredients, items: ticked, today: base.today })).removed).toEqual([])
    const afterDelete = toBuyKeys({ ...base, events: events(), items: [item('i2', null)] }) // soft-deleted rows never load
    expect(diffToBuy(withItems, afterDelete, resolvedKeys({ events: events(), ingredients, items: [item('i2', null)], today: base.today })).removed).toEqual([itemKey('i1')])
  })
})

describe('localDay', () => {
  it('is the household calendar day', () => {
    expect(localDay('2026-11-25T23:30:00Z', 'Europe/Rome')).toBe('2026-11-26')
    expect(localDay('2026-11-25T23:30:00Z', 'America/New_York')).toBe('2026-11-25')
  })
})
