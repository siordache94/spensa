import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { runCommand } from './command.ts'
import { createFakeAdapter, row } from './fakeAdapter.ts'
import { keys } from './keys.ts'
import { deleteRecipe, RECIPE_IN_USE_MESSAGE, restoreRecipe, restoreRecipeMeals, saveRecipe, unplanRecipeMeals } from './recipes.ts'

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

/** Put a query in the cache so we can see whether a command made it stale. */
async function prime<T>(qc: QueryClient, key: readonly unknown[], data: T) {
  await qc.prefetchQuery({ queryKey: key, queryFn: () => data })
  expect(qc.getQueryState(key)?.isInvalidated).toBe(false)
}
const stale = (qc: QueryClient, key: readonly unknown[]) => qc.getQueryState(key)?.isInvalidated

describe('recipe commands on the fake adapter', () => {
  it('saveRecipe inserts a recipe with its lines and invalidates the recipes list only', async () => {
    const rice = row.ingredient({ id: 'rice', name: 'rice', unit: 'g' })
    const api = createFakeAdapter({ ingredients: [rice] })
    const qc = newClient()
    await prime(qc, keys.recipes.all(), [])
    await prime(qc, keys.ingredients.all(), [])

    await runCommand(qc, api, saveRecipe, {
      id: null, name: 'Risotto', instructions: 'Stir.', tags: ['dinner'], serves: 2,
      lines: [{ ingredient_id: 'rice', qty_per_portion: 75 }],
    })

    expect(api.calls).toContain('recipes.save')
    expect((await api.recipes.list()).map((r) => [r.name, r.recipe_ingredients[0].ingredients.name])).toEqual([['Risotto', 'rice']])
    expect(api.state.recipeLines).toEqual([{ ingredientId: 'rice', recipeName: 'Risotto' }])
    expect(stale(qc, keys.recipes.all())).toBe(true)
    expect(stale(qc, keys.ingredients.all())).toBe(false)
  })

  it('saveRecipe with an id edits the recipe in place and keeps its lines in step', async () => {
    const api = createFakeAdapter({ ingredients: [row.ingredient({ id: 'rice' }), row.ingredient({ id: 'salt', name: 'salt' })] })
    const qc = newClient()
    await runCommand(qc, api, saveRecipe, { id: null, name: 'Soup', instructions: '', tags: [], serves: 2, lines: [{ ingredient_id: 'rice', qty_per_portion: 50 }] })
    const id = api.state.recipes[0].id

    await runCommand(qc, api, saveRecipe, { id, name: 'Soup', instructions: 'Boil.', tags: [], serves: 4, lines: [{ ingredient_id: 'salt', qty_per_portion: null }] })

    expect(api.state.recipes).toHaveLength(1)
    expect(api.state.recipes[0]).toMatchObject({ instructions: 'Boil.', serves: 4 })
    expect(api.state.recipeLines).toEqual([{ ingredientId: 'salt', recipeName: 'Soup' }])
  })

  it('deleteRecipe soft-deletes it, and restoreRecipe brings it and its lines back', async () => {
    const api = createFakeAdapter({ ingredients: [row.ingredient({ id: 'rice' })] })
    const qc = newClient()
    await runCommand(qc, api, saveRecipe, { id: null, name: 'Rice', instructions: '', tags: [], serves: 2, lines: [{ ingredient_id: 'rice', qty_per_portion: 75 }] })
    const id = api.state.recipes[0].id
    await prime(qc, keys.recipes.all(), [])

    await runCommand(qc, api, deleteRecipe, { id })
    expect(await api.recipes.list()).toEqual([])
    expect(api.state.recipeLines).toEqual([])
    expect(stale(qc, keys.recipes.all())).toBe(true)

    await runCommand(qc, api, restoreRecipe, { id })
    expect((await api.recipes.list()).map((r) => r.name)).toEqual(['Rice'])
    expect(api.state.recipeLines).toEqual([{ ingredientId: 'rice', recipeName: 'Rice' }])
  })

  it('deleteRecipe is refused while planned meals use the recipe, with the friendly message and no invalidation', async () => {
    const recipe = row.recipe({ id: 'r1', name: 'Soup' })
    const api = createFakeAdapter({ recipes: [recipe], meals: [row.plannedMeal({ recipe_id: 'r1' })] })
    const qc = newClient()
    await prime(qc, keys.recipes.all(), [])

    await expect(runCommand(qc, api, deleteRecipe, { id: 'r1' })).rejects.toThrow(RECIPE_IN_USE_MESSAGE)
    expect(api.state.recipes[0].deleted_at).toBeNull()
    expect(stale(qc, keys.recipes.all())).toBe(false)
  })

  it('unplanRecipeMeals refreshes the recipe view even when the write fails (settled)', async () => {
    const meal = row.plannedMeal({ id: 'm1', recipe_id: 'r1' })
    const api = createFakeAdapter({ meals: [meal] })
    const qc = newClient()
    await prime(qc, keys.recipes.planned('r1'), [meal])
    await prime(qc, keys.plan.plannedMeals(), [])
    await prime(qc, keys.pantry.all(), {})
    api.failNext('trash.softDelete')

    await expect(runCommand(qc, api, unplanRecipeMeals, { recipeId: 'r1', ids: ['m1'] })).rejects.toThrow()
    expect(stale(qc, keys.recipes.planned('r1'))).toBe(true)
    expect(stale(qc, keys.plan.plannedMeals())).toBe(true)
    expect(stale(qc, keys.pantry.all())).toBe(true)
  })

  it('unplan then restoreRecipeMeals (the Undo) hides and brings back the meals', async () => {
    const api = createFakeAdapter({ meals: [row.plannedMeal({ id: 'm1', recipe_id: 'r1' }), row.plannedMeal({ id: 'm2', recipe_id: 'r1' })] })
    const qc = newClient()

    await runCommand(qc, api, unplanRecipeMeals, { recipeId: 'r1', ids: ['m1', 'm2'] })
    expect(await api.recipes.planned('r1')).toEqual([])

    await runCommand(qc, api, restoreRecipeMeals, { recipeId: 'r1', ids: ['m1', 'm2'] })
    expect((await api.recipes.planned('r1')).map((m) => m.id)).toEqual(['m1', 'm2'])
  })
})
