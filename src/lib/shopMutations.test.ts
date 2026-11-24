import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { runCommand } from './api/command.ts'
import { createFakeAdapter, row } from './api/fakeAdapter.ts'
import { keys } from './api/keys.ts'
import { finishShopping } from './api/checkins.ts'
import type { Buy as BuyVars } from './api/port.ts'
import {
  addBatchToPantry, CHECK_KEY, checkSwitch, onHandSwitch, removeBatchFromPantry, registerShopMutations, setCheckedInItems, setOnHandInPantry,
  UNCHECK_KEY, UN_ON_HAND_KEY, ON_HAND_KEY, BUY_KEY, UNBUY_KEY, SHOP_KEY, SHOP_SCOPE, type Pantry,
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

// ---- Order (MR-004): every shop write shares one scope, so TanStack runs it in the order it was made ----------------
function gate() {
  let open!: () => void
  const opened = new Promise<void>((resolve) => { open = resolve })
  return { opened, open }
}

/** A client with the shop defaults registered and the caches a tick reads, as ShopPage has them. */
function shopClient(api: ReturnType<typeof createFakeAdapter>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  registerShopMutations(qc, api)
  qc.setQueryData(keys.pantry.all(), pantry())
  qc.setQueryData(keys.shop.items(), [{ id: 's1', checked: false }])
  return qc
}

const buyOf = (batchId: string): BuyVars => ({
  ingredientId: 'rice', name: 'rice', unit: 'g', qty: 500, expiresOn: null, shoppingItemId: 's1', batchId, addedAt: '2026-01-05T10:00:00Z',
})

type FinishInput = Parameters<typeof finishShopping.run>[1]

describe('shop mutations run in one scope', () => {
  it('an immediate undo of a slow tick still reaches the adapter after the buy', async () => {
    const api = createFakeAdapter({
      ingredients: [row.ingredient({ id: 'rice', name: 'rice', unit: 'g' })],
      shoppingItems: [row.shoppingItem({ id: 's1', ingredient_id: 'rice' })],
    })
    // The buy is slow on the wire; without a scope the undo would reach the adapter first and no-op.
    const slow = gate()
    const buy = api.shop.buy
    api.shop.buy = async (b) => { await slow.opened; return buy(b) }
    const qc = shopClient(api)

    const buying = qc.getMutationCache().build(qc, { mutationKey: BUY_KEY }).execute(buyOf('b2'))
    const undoing = qc.getMutationCache().build(qc, { mutationKey: UNBUY_KEY }).execute('b2')
    await Promise.resolve()
    slow.open()
    await Promise.all([buying, undoing])

    expect(api.calls.filter((c) => c === 'shop.buy' || c === 'shop.unbuy')).toEqual(['shop.buy', 'shop.unbuy'])
    expect(api.state.batches.filter((b) => !b.deleted_at)).toEqual([]) // bought, then unbought: the undo undid it
  })

  it('Done shopping waits for a slow tick, so its snapshot includes the new batch', async () => {
    const api = createFakeAdapter({
      ingredients: [row.ingredient({ id: 'rice', name: 'rice', unit: 'g' })],
      shoppingItems: [row.shoppingItem({ id: 's1', ingredient_id: 'rice' })],
    })
    const slow = gate()
    const buy = api.shop.buy
    api.shop.buy = async (b) => { await slow.opened; return buy(b) }
    const qc = shopClient(api)

    const buying = qc.getMutationCache().build(qc, { mutationKey: BUY_KEY }).execute(buyOf('b2'))
    // The page's finish uses the same scope with the command (finish_shopping itself is not a registered default).
    const finish = qc.getMutationCache().build(qc, {
      scope: SHOP_SCOPE,
      mutationFn: (input: FinishInput) => runCommand(qc, api, finishShopping, input),
    })
    const finishing = finish.execute({ onDate: '2026-01-05', batches: [{ batch_id: 'b2', qty: 500 }], answers: [], expectedAt: null })
    await Promise.resolve()
    slow.open()
    await Promise.all([buying, finishing])

    expect(api.calls.filter((c) => c === 'shop.buy' || c === 'checkins.finishShopping')).toEqual(['shop.buy', 'checkins.finishShopping'])
    expect(api.state.finishedShopping[0].batches).toEqual([{ batch_id: 'b2', qty: 500 }])
  })

  it('Done shopping also waits for a to-taste tick and a text tick, in the order they were made', async () => {
    const api = createFakeAdapter({
      ingredients: [row.ingredient({ id: 'salt', name: 'salt', unit: 'to_taste' })],
      shoppingItems: [row.shoppingItem({ id: 's1', text: 'milk' })],
      batches: [row.batch({ id: 'b1', ingredient_id: 'rice' })],
    })
    const slow = gate()
    const onHand = api.ingredients.setOnHand
    api.ingredients.setOnHand = async (id, value) => { await slow.opened; return onHand(id, value) }
    const qc = shopClient(api)

    const tasting = qc.getMutationCache().build(qc, { mutationKey: ON_HAND_KEY }).execute('salt')
    const checking = qc.getMutationCache().build(qc, { mutationKey: CHECK_KEY }).execute('s1')
    const finish = qc.getMutationCache().build(qc, {
      scope: SHOP_SCOPE,
      mutationFn: (input: FinishInput) => runCommand(qc, api, finishShopping, input),
    })
    const finishing = finish.execute({ onDate: '2026-01-05', batches: [{ batch_id: 'b1', qty: 500 }], answers: [], expectedAt: null })
    await Promise.resolve()
    slow.open()
    await Promise.all([tasting, checking, finishing])

    expect(api.calls.filter((c) => c === 'ingredients.setOnHand' || c === 'shop.setChecked' || c === 'checkins.finishShopping'))
      .toEqual(['ingredients.setOnHand', 'shop.setChecked', 'checkins.finishShopping'])
    expect(api.state.ingredients[0].on_hand).toBe(true)
    expect(api.state.shoppingItems[0].checked).toBe(true)
    expect(api.state.finishedShopping.at(-1)?.batches).toEqual([{ batch_id: 'b1', qty: 500 }])
  })

  it('every shop default carries the scope', () => {
    const qc = new QueryClient()
    registerShopMutations(qc, createFakeAdapter())
    for (const key of [BUY_KEY, UNBUY_KEY, ON_HAND_KEY, UN_ON_HAND_KEY, CHECK_KEY, UNCHECK_KEY]) {
      expect(qc.getMutationDefaults(key)?.scope).toEqual(SHOP_SCOPE)
    }
  })
})

// ---- MR-003: both phones bought the same item ----------------------------------------------------------------
describe('many purchases of one list item', () => {
  it('a second tick is reported as already bought and both batches persist', async () => {
    const api = createFakeAdapter({
      ingredients: [row.ingredient({ id: 'rice', name: 'rice', unit: 'g' })],
      shoppingItems: [row.shoppingItem({ id: 's1', ingredient_id: 'rice' })],
    })
    const qc = shopClient(api)

    const own = await qc.getMutationCache().build(qc, { mutationKey: BUY_KEY }).execute(buyOf('b2'))
    const partner = await qc.getMutationCache().build(qc, { mutationKey: BUY_KEY }).execute(buyOf('b3'))

    expect(own).toEqual({ batchId: 'b2', alreadyPurchased: false })
    expect(partner).toEqual({ batchId: 'b3', alreadyPurchased: true })
    expect(api.state.batches.filter((b) => !b.deleted_at).map((b) => b.id)).toEqual(['b2', 'b3'])
  })

  it('returning one purchase keeps the item bought; the last one puts it back', async () => {
    const api = createFakeAdapter({
      ingredients: [row.ingredient({ id: 'rice', name: 'rice', unit: 'g' })],
      shoppingItems: [row.shoppingItem({ id: 's1', ingredient_id: 'rice' })],
    })
    const qc = shopClient(api)
    await qc.getMutationCache().build(qc, { mutationKey: BUY_KEY }).execute(buyOf('b2'))
    await qc.getMutationCache().build(qc, { mutationKey: BUY_KEY }).execute(buyOf('b3'))

    await qc.getMutationCache().build(qc, { mutationKey: UNBUY_KEY }).execute('b2')
    expect(api.state.shoppingItems[0].bought_batch_id).toBe('b3')

    await qc.getMutationCache().build(qc, { mutationKey: UNBUY_KEY }).execute('b3')
    expect(api.state.shoppingItems[0].bought_batch_id).toBeNull()
  })
})
