import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { runCommand } from './command.ts'
import { createFakeAdapter, row } from './fakeAdapter.ts'
import { keys } from './keys.ts'
import { answerCheckin, finishShopping, saveMealLines, setNotCooked } from './checkins.ts'
import { PANTRY_CHANGED_MESSAGE, VERSION_CONFLICT, type UnreadCheckinRow } from './port.ts'

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
async function prime(qc: QueryClient, key: readonly unknown[]) {
  await qc.prefetchQuery({ queryKey: key, queryFn: () => [] })
}
const stale = (qc: QueryClient, key: readonly unknown[]) => qc.getQueryState(key)?.isInvalidated

/** An unread check-in for a meal that is still on the plan. */
const checkin = (id: string, mealId: string): UnreadCheckinRow => ({
  id,
  created_at: '2026-01-05T21:00:00Z',
  planned_meals: { id: mealId, date: '2026-01-05', slot: 'dinner', portions: 2, cook_id: null, recipes: { name: 'soup' } },
})

describe('check-in commands', () => {
  it('answering clears the unread check-in once, then reports it already answered', async () => {
    const api = createFakeAdapter({ unreadCheckins: [checkin('c1', 'm1')] })
    const qc = newClient()
    await prime(qc, keys.checkins.all())
    await prime(qc, keys.pantry.all())

    expect(await runCommand(qc, api, answerCheckin, { mealId: 'm1', answer: 'planned' })).toBe(true)
    expect(await runCommand(qc, api, answerCheckin, { mealId: 'm1', answer: 'planned' })).toBe(false)

    expect(api.state.unreadCheckins).toEqual([])
    expect(stale(qc, keys.checkins.all())).toBe(true)
    expect(stale(qc, keys.pantry.all())).toBe(true)
  })

  it('"didn\'t cook" flags the meal and answers its check-in', async () => {
    const api = createFakeAdapter({ meals: [row.plannedMeal({ id: 'm1' })], unreadCheckins: [checkin('c1', 'm1')] })
    const qc = newClient()

    await runCommand(qc, api, setNotCooked, { mealId: 'm1', value: true })

    expect(api.state.meals[0].not_cooked).toBe(true)
    expect(api.state.unreadCheckins).toEqual([])
  })

  it('saving per-meal amounts sends them as the payload; a bad amount is refused, and the pantry refreshes either way (settled)', async () => {
    const api = createFakeAdapter({ meals: [row.plannedMeal({ id: 'm1' })] })
    const qc = newClient()
    await prime(qc, keys.pantry.all())

    await expect(runCommand(qc, api, saveMealLines, { mealId: 'm1', lines: [{ ingredientId: 'a', qty: 0 }] })).rejects.toThrow()
    expect(api.state.meals[0].planned_meal_lines).toEqual([])
    expect(stale(qc, keys.pantry.all())).toBe(true)

    await runCommand(qc, api, saveMealLines, { mealId: 'm1', lines: [{ ingredientId: 'a', qty: 120 }, { ingredientId: 'b', qty: null }] })
    expect(api.state.meals[0].planned_meal_lines).toEqual([
      { ingredient_id: 'a', qty_total: 120 },
      { ingredient_id: 'b', qty_total: null },
    ])
    expect(stale(qc, keys.pantry.all())).toBe(true)
  })

  it('done shopping records the snapshot answers and clears every unread check-in', async () => {
    const api = createFakeAdapter({ batches: [row.batch({ id: 'b1' })], unreadCheckins: [checkin('c1', 'm1'), checkin('c2', 'm2')] })
    const qc = newClient()
    await prime(qc, keys.checkins.all())
    const answers = [{ meal_id: 'm1', answer: 'not_cooked' as const }, { meal_id: 'm2', answer: 'planned' as const }]

    await runCommand(qc, api, finishShopping, { onDate: '2026-01-05', batches: [{ batch_id: 'b1', qty: 200 }], answers, expectedAt: null })

    expect(api.state.finishedShopping).toEqual([{ onDate: '2026-01-05', batches: [{ batch_id: 'b1', qty: 200 }], answers, expectedAt: null }])
    expect(api.state.unreadCheckins).toEqual([])
    expect(stale(qc, keys.checkins.all())).toBe(true)
  })

  it('done shopping sends the version it was computed from and succeeds when it is still current', async () => {
    const api = createFakeAdapter({ batches: [row.batch({ id: 'b1' })], version: '2026-01-05T10:00:00.123456+00:00' })
    const qc = newClient()

    await runCommand(qc, api, finishShopping, {
      onDate: '2026-01-05',
      batches: [{ batch_id: 'b1', qty: 200 }],
      answers: [],
      expectedAt: '2026-01-05T10:00:00.123456+00:00',
    })

    expect(api.state.finishedShopping).toHaveLength(1)
  })

  it('a stale version is refused with one friendly sentence, and the pantry is refetched for the retry', async () => {
    const api = createFakeAdapter({ batches: [row.batch({ id: 'b1' })], version: '2026-01-05T10:00:00Z' })
    const qc = newClient()
    await prime(qc, keys.pantry.all())

    const finish = runCommand(qc, api, finishShopping, {
      onDate: '2026-01-05',
      batches: [{ batch_id: 'b1', qty: 200 }],
      answers: [],
      expectedAt: '2026-01-05T09:00:00Z',
    })

    await expect(finish).rejects.toMatchObject({ code: VERSION_CONFLICT, message: PANTRY_CHANGED_MESSAGE })
    expect(api.state.finishedShopping).toEqual([])
    expect(stale(qc, keys.pantry.all())).toBe(true)
  })

  it('a snapshot line naming an unknown batch is refused loudly', async () => {
    const api = createFakeAdapter({ version: 'v1' })
    const qc = newClient()

    const finish = runCommand(qc, api, finishShopping, {
      onDate: '2026-01-05',
      batches: [{ batch_id: 'gone', qty: 200 }],
      answers: [],
      expectedAt: 'v1',
    })

    await expect(finish).rejects.toMatchObject({ code: '23503' })
    await expect(finish).rejects.toThrow(/unknown batch gone/)
    expect(api.state.finishedShopping).toEqual([])
  })

  it('unread check-ins come back as the port rows', async () => {
    const api = createFakeAdapter({ unreadCheckins: [checkin('c1', 'm1')] })
    expect((await api.checkins.unread()).map((c) => c.id)).toEqual(['c1'])
  })
})

describe('household events feed', () => {
  it('calls the subscriber with the writer id until unsubscribed', async () => {
    const api = createFakeAdapter()
    const seen: (string | null)[] = []
    const unsubscribe = api.live.subscribeHouseholdEvents('shop', (by) => seen.push(by))

    api.emitHouseholdEvent('partner')
    unsubscribe()
    api.emitHouseholdEvent('partner')

    expect(seen).toEqual(['partner'])
  })
})
