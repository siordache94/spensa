import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { runCommand } from './command.ts'
import { createFakeAdapter, row } from './fakeAdapter.ts'
import { keys } from './keys.ts'
import { addShoppingItem, clearCheckedItems, refreshShop, setMealSkipShopping, setPantryOnHand } from './shop.ts'
import { savePantryEdits } from './pantry.ts'
import type { Buy } from './port.ts'

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
async function prime(qc: QueryClient, key: readonly unknown[]) {
  await qc.prefetchQuery({ queryKey: key, queryFn: () => [] })
}
const stale = (qc: QueryClient, key: readonly unknown[]) => qc.getQueryState(key)?.isInvalidated

describe('shopping list commands', () => {
  it('adds a free-text item and invalidates the list', async () => {
    const api = createFakeAdapter()
    const qc = newClient()
    await prime(qc, keys.shop.items())

    await runCommand(qc, api, addShoppingItem, { text: 'bread' })

    expect(api.state.shoppingItems.map((i) => i.text)).toEqual(['bread'])
    expect(stale(qc, keys.shop.items())).toBe(true)
  })

  it('adds an ingredient item by id', async () => {
    const rice = row.ingredient({ id: 'rice', name: 'rice' })
    const api = createFakeAdapter({ ingredients: [rice] })
    const qc = newClient()

    await runCommand(qc, api, addShoppingItem, { ingredient_id: 'rice' })

    expect(api.state.shoppingItems.map((i) => i.ingredient_id)).toEqual(['rice'])
  })

  it('the list joins the ingredient name, unit and category', async () => {
    const rice = row.ingredient({ id: 'rice', name: 'rice', unit: 'g', category: 'dry goods' })
    const api = createFakeAdapter({ ingredients: [rice], shoppingItems: [row.shoppingItem({ ingredient_id: 'rice' }), row.shoppingItem({ text: 'milk' })] })

    const items = await api.shop.list()

    expect(items.map((i) => i.ingredients)).toEqual([{ name: 'rice', unit: 'g', category: 'dry goods' }, null])
  })

  it('clear checked soft-deletes only the ids given', async () => {
    const api = createFakeAdapter({
      shoppingItems: [row.shoppingItem({ id: 'a', text: 'a', checked: true }), row.shoppingItem({ id: 'b', text: 'b', checked: false })],
    })
    const qc = newClient()
    await prime(qc, keys.shop.items())

    await runCommand(qc, api, clearCheckedItems, { ids: ['a'] })

    expect((await api.shop.list()).map((i) => i.id)).toEqual(['b'])
    expect(stale(qc, keys.shop.items())).toBe(true)
  })

  it('setting a meal skip flips skip_shopping and refreshes the pantry', async () => {
    const api = createFakeAdapter({ meals: [row.plannedMeal({ id: 'm1' })] })
    const qc = newClient()
    await prime(qc, keys.pantry.all())

    await runCommand(qc, api, setMealSkipShopping, { mealId: 'm1', skip: true })

    expect(api.state.meals[0].skip_shopping).toBe(true)
    expect(stale(qc, keys.pantry.all())).toBe(true)
  })

  it('the pantry on-hand switch writes through and refreshes the pantry', async () => {
    const api = createFakeAdapter({ ingredients: [row.ingredient({ id: 'salt', unit: 'to_taste' })] })
    const qc = newClient()
    await prime(qc, keys.pantry.all())

    await runCommand(qc, api, setPantryOnHand, { id: 'salt', onHand: true })

    expect(api.state.ingredients[0].on_hand).toBe(true)
    expect(stale(qc, keys.pantry.all())).toBe(true)
  })

  it('refreshShop refetches pantry, list and settings together', async () => {
    const qc = newClient()
    await prime(qc, keys.pantry.all())
    await prime(qc, keys.shop.items())
    await prime(qc, keys.household.settings())

    await refreshShop(qc)

    expect(stale(qc, keys.pantry.all())).toBe(true)
    expect(stale(qc, keys.shop.items())).toBe(true)
    expect(stale(qc, keys.household.settings())).toBe(true)
  })
})

describe('pantry editor save', () => {
  it('sends the diff to the port and refreshes the pantry', async () => {
    const api = createFakeAdapter()
    const qc = newClient()
    await prime(qc, keys.pantry.all())
    const edits = { adjustments: [], newBatches: [{ ingredient_id: 'rice', qty: 500, expires_on: null }], expiries: [] }

    await runCommand(qc, api, savePantryEdits, edits)

    expect(api.state.savedEdits).toEqual([edits])
    expect(stale(qc, keys.pantry.all())).toBe(true)
  })
})

// ---- MR-003: one list item, many purchases -------------------------------------------------------------------------
describe('two phones buying one list item', () => {
  const setup = () => {
    const api = createFakeAdapter({
      ingredients: [row.ingredient({ id: 'rice', name: 'rice', unit: 'g' })],
      shoppingItems: [row.shoppingItem({ id: 's1', ingredient_id: 'rice' }), row.shoppingItem({ id: 't1', text: 'bread' })],
    })
    const tick = (batchId: string, shoppingItemId = 's1', ingredientId = 'rice'): Buy => ({
      ingredientId, name: 'rice', unit: 'g', qty: 500, expiresOn: null, shoppingItemId, batchId, addedAt: '2026-01-05T10:00:00Z',
    })
    return { api, tick }
  }

  it('keeps both purchases and tells the second shopper', async () => {
    const { api, tick } = setup()

    expect(await api.shop.buy(tick('b1'))).toEqual({ batchId: 'b1', alreadyPurchased: false })
    expect(await api.shop.buy(tick('b2'))).toEqual({ batchId: 'b2', alreadyPurchased: true })

    expect(api.state.batches.map((b) => b.id)).toEqual(['b1', 'b2'])
    expect(api.state.batches.every((b) => b.shopping_item_id === 's1')).toBe(true)
    // a second purchase does not move the bought pointer: the item stays bought, both batches stay in the pantry
    expect(api.state.shoppingItems[0].bought_batch_id).toBe('b1')
  })

  it('a retry of the same batch is not a second purchase', async () => {
    const { api, tick } = setup()

    await api.shop.buy(tick('b1'))
    expect(await api.shop.buy(tick('b1'))).toEqual({ batchId: 'b1', alreadyPurchased: false })
    expect(api.state.batches).toHaveLength(1)
  })

  it('the item stays bought while one purchase remains, and returns with the last', async () => {
    const { api, tick } = setup()
    await api.shop.buy(tick('b1'))
    await api.shop.buy(tick('b2'))

    await api.shop.unbuy('b1')
    expect(api.state.shoppingItems[0].bought_batch_id).toBe('b2')

    await api.shop.unbuy('b2')
    expect(api.state.shoppingItems[0].bought_batch_id).toBeNull()
    expect(api.state.shoppingItems[0].checked).toBe(false)
  })

  it('derives the ingredient from the item and refuses a free-text item', async () => {
    const { api, tick } = setup()

    // the client's ingredientId is ignored: the item says rice, so the batch is rice
    await api.shop.buy(tick('b1', 's1', 'pasta'))
    expect(api.state.batches[0].ingredient_id).toBe('rice')

    await expect(api.shop.buy(tick('b2', 't1'))).rejects.toMatchObject({ code: '22023' })
    expect(api.state.batches.map((b) => b.id)).toEqual(['b1'])
  })

  it('refuses an item that is already gone', async () => {
    const { api, tick } = setup()
    api.state.shoppingItems[0].deleted_at = '2026-01-05T09:00:00Z'

    await expect(api.shop.buy(tick('b1'))).rejects.toMatchObject({ code: '23503' })
    expect(api.state.batches).toEqual([])
  })

  it('Done shopping can snapshot both purchases', async () => {
    const { api, tick } = setup()
    await api.shop.buy(tick('b1'))
    await api.shop.buy(tick('b2'))

    await api.checkins.finishShopping('2026-01-05', [{ batch_id: 'b1', qty: 500 }, { batch_id: 'b2', qty: 500 }], [], null)

    expect(api.state.finishedShopping[0].batches).toEqual([{ batch_id: 'b1', qty: 500 }, { batch_id: 'b2', qty: 500 }])
  })
})
