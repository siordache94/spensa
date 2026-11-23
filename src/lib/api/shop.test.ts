import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { runCommand } from './command.ts'
import { createFakeAdapter, row } from './fakeAdapter.ts'
import { keys } from './keys.ts'
import { addShoppingItem, clearCheckedItems, refreshShop, setMealSkipShopping, setPantryOnHand } from './shop.ts'
import { savePantryEdits } from './pantry.ts'

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
