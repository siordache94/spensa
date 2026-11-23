import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { createFakeAdapter, row } from './api/fakeAdapter.ts'
import { keys } from './api/keys.ts'
import {
  addBatchToPantry, CHECK_KEY, checkSwitch, onHandSwitch, removeBatchFromPantry, registerShopMutations, setCheckedInItems, setOnHandInPantry,
  UNCHECK_KEY, UN_ON_HAND_KEY, ON_HAND_KEY, BUY_KEY, UNBUY_KEY, SHOP_KEY, type Pantry,
} from './shopMutations.ts'

const pantry = (): Pantry => ({
  events: {
    batches: [{ id: 'b1', ingredientId: 'rice', qty: 500, addedOn: '2026-01-05', addedAt: '2026-01-05T09:00:00Z', recordedAt: '2026-01-05T09:00:00Z', expiresOn: null }],
  },
  domainIngredients: [{ id: 'rice', onHand: false }, { id: 'salt', onHand: false }],
  ingredients: [{ id: 'rice', on_hand: false }, { id: 'salt', on_hand: false }],
  batchAuthors: { b1: 'u1' },
})

describe('pure cache reducers', () => {
  it('setOnHandInPantry flips one ingredient in both views and leaves the rest', () => {
    const next = setOnHandInPantry(pantry(), 'rice', true)
    expect(next.domainIngredients).toEqual([{ id: 'rice', onHand: true }, { id: 'salt', onHand: false }])
    expect(next.ingredients).toEqual([{ id: 'rice', on_hand: true }, { id: 'salt', on_hand: false }])
    expect(next.events).toEqual(pantry().events)
  })

  it('setOnHandInPantry with the same value again changes nothing', () => {
    const once = setOnHandInPantry(pantry(), 'rice', true)
    expect(setOnHandInPantry(once, 'rice', true)).toEqual(once)
  })

  it('setOnHandInPantry for an unknown ingredient is a no-op on the lists', () => {
    const p = pantry()
    expect(setOnHandInPantry(p, 'nope', true)).toEqual(p)
  })

  it('setCheckedInItems sets checked on the one item and keeps the others', () => {
    const items = [{ id: 'a', checked: false }, { id: 'b', checked: true }]
    expect(setCheckedInItems(items, 'a', true)).toEqual([{ id: 'a', checked: true }, { id: 'b', checked: true }])
    expect(setCheckedInItems(items, 'b', false)).toEqual([{ id: 'a', checked: false }, { id: 'b', checked: false }])
  })

  it('setCheckedInItems with no cached list stays undefined', () => {
    expect(setCheckedInItems(undefined, 'a', true)).toBeUndefined()
  })

  it('addBatchToPantry appends the batch and records its author', () => {
    const batch = { id: 'b2', ingredientId: 'salt', qty: 1000, addedOn: '2026-01-05', addedAt: '2026-01-05T10:00:00Z', recordedAt: '9999-12-31T00:00:00Z', expiresOn: null }
    const next = addBatchToPantry(pantry(), batch, 'u2')
    expect(next.events.batches.map((b) => b.id)).toEqual(['b1', 'b2'])
    expect(next.batchAuthors).toEqual({ b1: 'u1', b2: 'u2' })
  })

  it('removeBatchFromPantry drops only that batch', () => {
    expect(removeBatchFromPantry(pantry(), 'b1').events.batches).toEqual([])
    expect(removeBatchFromPantry(pantry(), 'other').events.batches.map((b) => b.id)).toEqual(['b1'])
  })

  it('a switch(on) and its undo are the same shape with the boolean flipped', () => {
    const tick = onHandSwitch(true)
    const untick = onHandSwitch(false)
    const [onP] = tick.change(pantry(), undefined, 'salt')
    const [offP] = untick.change(onP, undefined, 'salt')
    expect(onP.ingredients.find((i) => i.id === 'salt')?.on_hand).toBe(true)
    expect(offP.ingredients.find((i) => i.id === 'salt')?.on_hand).toBe(false)

    const items = [{ id: 'a', checked: false }]
    expect(checkSwitch(true).change(pantry(), items, 'a')[1]).toEqual([{ id: 'a', checked: true }])
    expect(checkSwitch(false).change(pantry(), [{ id: 'a', checked: true }], 'a')[1]).toEqual([{ id: 'a', checked: false }])
  })
})

describe('shop mutation keys (persisted in localStorage with paused mutations: must not change)', () => {
  it('keeps the exact key values', () => {
    expect(keys.mutations.shop()).toEqual(['shop'])
    expect(BUY_KEY).toEqual(['shop', 'buy'])
    expect(ON_HAND_KEY).toEqual(['shop', 'on-hand'])
    expect(CHECK_KEY).toEqual(['shop', 'check'])
    expect(UNBUY_KEY).toEqual(['shop', 'unbuy'])
    expect(UN_ON_HAND_KEY).toEqual(['shop', 'un-on-hand'])
    expect(UNCHECK_KEY).toEqual(['shop', 'uncheck'])
    expect(SHOP_KEY).toEqual(['shop'])
  })
})

describe('registered switches run the write and the cache change', () => {
  it('unchecking a list item writes through the port and flips the cached item', async () => {
    const api = createFakeAdapter({ shoppingItems: [row.shoppingItem({ id: 'x1', text: 'milk', checked: true })] })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    registerShopMutations(qc, api)
    qc.setQueryData(keys.shop.items(), [{ id: 'x1', checked: true }])
    qc.setQueryData(keys.pantry.all(), pantry())

    const ctx = await qc.getMutationDefaults(UNCHECK_KEY).onMutate!('x1' as never, {} as never)
    expect(qc.getQueryData<{ checked: boolean }[]>(keys.shop.items())?.[0].checked).toBe(false)
    expect(ctx).toBeDefined()
    await qc.getMutationDefaults(UNCHECK_KEY).mutationFn!('x1' as never, {} as never)
    expect(api.calls).toEqual(['shop.setChecked'])
    expect(api.state.shoppingItems[0].checked).toBe(false)
  })

  it('ticking an on-hand ingredient writes the flag and updates the pantry cache', async () => {
    const api = createFakeAdapter({ ingredients: [row.ingredient({ id: 'salt', unit: 'to_taste' })] })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    registerShopMutations(qc, api)
    qc.setQueryData(keys.pantry.all(), pantry())

    await qc.getMutationDefaults(ON_HAND_KEY).onMutate!('salt' as never, {} as never)
    expect(qc.getQueryData<Pantry>(keys.pantry.all())?.ingredients.find((i) => i.id === 'salt')?.on_hand).toBe(true)
    await qc.getMutationDefaults(ON_HAND_KEY).mutationFn!('salt' as never, {} as never)
    expect(api.calls).toEqual(['ingredients.setOnHand'])
    expect(api.state.ingredients[0].on_hand).toBe(true)
  })
})
