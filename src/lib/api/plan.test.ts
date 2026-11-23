import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { runCommand } from './command.ts'
import { createFakeAdapter, row } from './fakeAdapter.ts'
import { addMeal, deleteMeal, moveMeal, setMealCook, setMealPortions } from './plan.ts'
import { keys } from './keys.ts'

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

async function prime<T>(qc: QueryClient, key: readonly unknown[], data: T) {
  await qc.prefetchQuery({ queryKey: key, queryFn: () => data })
  expect(qc.getQueryState(key)?.isInvalidated).toBe(false)
}
const stale = (qc: QueryClient, key: readonly unknown[]) => qc.getQueryState(key)?.isInvalidated

describe('planner commands on the fake adapter', () => {
  it('moveMeal changes date, slot and position, and invalidates the pantry', async () => {
    const api = createFakeAdapter({ meals: [row.plannedMeal({ id: 'm1', date: '2026-01-05', slot: 'lunch' })] })
    const qc = newClient()
    await prime(qc, keys.pantry.all(), {})
    await prime(qc, keys.recipes.all(), [])

    await runCommand(qc, api, moveMeal, { id: 'm1', to: { date: '2026-01-06', slot: 'dinner', position: 1 } })

    expect(api.state.meals[0]).toMatchObject({ date: '2026-01-06', slot: 'dinner', position: 1 })
    expect(stale(qc, keys.pantry.all())).toBe(true)
    expect(stale(qc, keys.recipes.all())).toBe(false)
  })

  it('addMeal (copy) adds a second meal with the same recipe and portions, and leaves the original', async () => {
    const api = createFakeAdapter({ meals: [row.plannedMeal({ id: 'm1', recipe_id: 'r1', portions: 3 })] })
    const qc = newClient()
    await prime(qc, keys.pantry.all(), {})

    await runCommand(qc, api, addMeal, { date: '2026-01-07', slot: 'lunch', position: 0, recipe_id: 'r1', portions: 3 })

    expect(api.state.meals).toHaveLength(2)
    expect(api.state.meals[1]).toMatchObject({ recipe_id: 'r1', portions: 3, date: '2026-01-07', slot: 'lunch' })
    expect(stale(qc, keys.pantry.all())).toBe(true)
  })

  it('deleteMeal soft-deletes the planned meal and invalidates the pantry', async () => {
    const api = createFakeAdapter({ meals: [row.plannedMeal({ id: 'm1' })] })
    const qc = newClient()
    await prime(qc, keys.pantry.all(), {})

    await runCommand(qc, api, deleteMeal, { id: 'm1' })

    expect(api.state.meals[0].deleted_at).not.toBeNull()
    expect(api.calls).toContain('trash.softDelete')
    expect(stale(qc, keys.pantry.all())).toBe(true)
  })

  it('setMealPortions and setMealCook update the meal', async () => {
    const api = createFakeAdapter({ meals: [row.plannedMeal({ id: 'm1', portions: 2, cook_id: null })] })
    const qc = newClient()

    await runCommand(qc, api, setMealPortions, { id: 'm1', portions: 4 })
    await runCommand(qc, api, setMealCook, { id: 'm1', cookId: 'u1' })

    expect(api.state.meals[0]).toMatchObject({ portions: 4, cook_id: 'u1' })
  })

  it('a failed move invalidates nothing', async () => {
    const api = createFakeAdapter({ meals: [row.plannedMeal({ id: 'm1' })] })
    const qc = newClient()
    await prime(qc, keys.pantry.all(), {})
    api.failNext('plan.move')

    await expect(runCommand(qc, api, moveMeal, { id: 'm1', to: { date: '2026-01-06', slot: 'lunch', position: 0 } })).rejects.toThrow()
    expect(stale(qc, keys.pantry.all())).toBe(false)
  })
})
