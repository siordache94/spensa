import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { runCommand } from './command.ts'
import { createFakeAdapter, row } from './fakeAdapter.ts'
import { createIngredient } from './ingredients.ts'
import { keys } from './keys.ts'

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

describe('createIngredient', () => {
  it('inserts the ingredient, returns its id and invalidates the ingredients list', async () => {
    const api = createFakeAdapter()
    const qc = newClient()
    await qc.prefetchQuery({ queryKey: keys.ingredients.all(), queryFn: () => [] })

    const id = await runCommand(qc, api, createIngredient, { name: 'rice', unit: 'g' })

    expect(typeof id).toBe('string')
    expect(api.state.ingredients.find((i) => i.id === id)).toMatchObject({ name: 'rice', unit: 'g' })
    expect(qc.getQueryState(keys.ingredients.all())?.isInvalidated).toBe(true)
  })

  it('a name taken in another case gives the plain message and invalidates nothing', async () => {
    const api = createFakeAdapter({ ingredients: [row.ingredient({ name: 'Rice' })] })
    const qc = newClient()
    await qc.prefetchQuery({ queryKey: keys.ingredients.all(), queryFn: () => [] })

    await expect(runCommand(qc, api, createIngredient, { name: 'rice', unit: 'g' })).rejects.toThrow('An ingredient with this name already exists.')
    expect(qc.getQueryState(keys.ingredients.all())?.isInvalidated).toBe(false)
  })
})
