import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { runCommand } from './command.ts'
import { createFakeAdapter, row } from './fakeAdapter.ts'
import { deleteIngredient, saveIngredient } from './ingredients.ts'
import { keys } from './keys.ts'
import { fetchPantry } from './pantry.ts'
import { BUY_KEY, registerShopMutations } from '../shopMutations.ts'

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

/** Put a query in the cache so we can see whether a command made it stale. */
async function prime<T>(qc: QueryClient, key: readonly unknown[], data: T) {
  await qc.prefetchQuery({ queryKey: key, queryFn: () => data })
  expect(qc.getQueryState(key)?.isInvalidated).toBe(false)
}
const stale = (qc: QueryClient, key: readonly unknown[]) => qc.getQueryState(key)?.isInvalidated

describe('ingredient commands on the fake adapter', () => {
  it('saveIngredient writes through the port and invalidates the ingredients list only', async () => {
    const api = createFakeAdapter()
    const qc = newClient()
    await prime(qc, keys.ingredients.all(), [])
    await prime(qc, keys.recipes.all(), [])

    await runCommand(qc, api, saveIngredient, { id: null, row: { name: 'rice', unit: 'g' } })

    expect(api.state.ingredients.map((i) => i.name)).toEqual(['rice'])
    expect(stale(qc, keys.ingredients.all())).toBe(true)
    expect(stale(qc, keys.recipes.all())).toBe(false)
  })

  it('a duplicate name fails with the friendly message and invalidates nothing', async () => {
    const api = createFakeAdapter({ ingredients: [row.ingredient({ name: 'rice' })] })
    const qc = newClient()
    await prime(qc, keys.ingredients.all(), [])

    await expect(runCommand(qc, api, saveIngredient, { id: null, row: { name: 'Rice', unit: 'g' } })).rejects.toThrow('An ingredient with this name already exists.')
    expect(stale(qc, keys.ingredients.all())).toBe(false)
  })

  it('deleteIngredient is refused while a recipe uses it, and soft-deletes otherwise', async () => {
    const used = row.ingredient({ id: 'used', name: 'salt' })
    const free = row.ingredient({ id: 'free', name: 'jam' })
    const api = createFakeAdapter({ ingredients: [used, free], recipeLines: [{ ingredientId: 'used', recipeName: 'Soup' }] })
    const qc = newClient()

    await expect(runCommand(qc, api, deleteIngredient, { id: 'used' })).rejects.toThrow('Remove it from these recipes to delete it.')
    await runCommand(qc, api, deleteIngredient, { id: 'free' })
    expect((await api.ingredients.list()).map((i) => i.id)).toEqual(['used'])
  })
})

describe('pantry on the fake adapter', () => {
  it('fetchPantry builds replay events from the port rows', async () => {
    const api = createFakeAdapter({
      ingredients: [row.ingredient({ id: 'i1' })],
      batches: [row.batch({ id: 'b1', ingredient_id: 'i1', qty: 500, created_by: 'u1' })],
    })
    const p = await fetchPantry(api, 'UTC', ['lunch', 'dinner'])
    expect(p.events.batches.map((b) => [b.id, b.qty])).toEqual([['b1', 500]])
    expect(p.batchAuthors).toEqual({ b1: 'u1' })
    expect(api.calls).toEqual(['pantry.rows'])
  })
})

describe('shop mutations registered by key (offline resume)', () => {
  it('the function found through the mutation key uses the adapter given at registration', async () => {
    const api = createFakeAdapter()
    const qc = newClient()
    registerShopMutations(qc, api)

    // After a reload TanStack rebuilds a paused mutation from { mutationKey, variables } and finds the fn here.
    const fn = qc.getMutationDefaults(BUY_KEY).mutationFn!
    await fn({ ingredientId: 'i1', name: 'rice', unit: 'g', qty: 200, expiresOn: null, batchId: 'b-1', addedAt: '2026-01-01T00:00:00Z' }, {} as never)

    expect(api.state.batches.map((b) => b.id)).toEqual(['b-1'])
    // retrying the same tick is idempotent
    await fn({ ingredientId: 'i1', name: 'rice', unit: 'g', qty: 200, expiresOn: null, batchId: 'b-1', addedAt: '2026-01-01T00:00:00Z' }, {} as never)
    expect(api.state.batches).toHaveLength(1)
  })
})
