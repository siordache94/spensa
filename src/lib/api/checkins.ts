// Meal check-ins (ADR 0005) on the phone: the shared unread list, answering, "didn't cook", per-meal amounts,
// the slot end times, the app icon badge, and "Done shopping" with its answers.
// A check-in is created by the server (push-cron) when a short meal's slot has ended 30 minutes ago; it stays
// unread, for both people, until someone answers it or "Done shopping" clears it as "cooked as planned".
import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { FinishAnswer } from '../../domain/checkinAnswers.ts'
import type { Day, MealAmount } from '../../domain/replay.ts'
import { slotEnd, type CheckinAnswer, type SlotEndTimes } from '../checkin.ts'
import { defineCommand, invalidateKeys, useCommand } from './command.ts'
import { useApi } from './context.tsx'
import { keys } from './keys.ts'
import { ApiError, PANTRY_CHANGED_MESSAGE, VERSION_CONFLICT, type SnapshotBatch, type UnreadCheckinRow } from './port.ts'

/** A meal's own amounts from the pantry data (`usePantry().meals`), or null when it follows its recipe. */
export function mealOwnLines(meal: { planned_meal_lines?: { ingredient_id: string; qty_total: number | string | null }[] | null }): MealAmount[] | null {
  const l = meal.planned_meal_lines
  return l && l.length ? l.map((x) => ({ ingredientId: x.ingredient_id, qty: x.qty_total === null ? null : Number(x.qty_total) })) : null
}

// ---- Unread check-ins -----------------------------------------------------------------------------------------
export type UnreadCheckin = {
  id: string
  mealId: string
  /** When the check-in came due. */
  createdAt: string
  date: Day
  slot: string
  portions: number
  cookId: string | null
  recipeName: string | null
}

const toUnread = (c: UnreadCheckinRow): UnreadCheckin[] => {
  const m = c.planned_meals
  return m ? [{ id: c.id, mealId: m.id, createdAt: c.created_at, date: m.date, slot: m.slot, portions: m.portions, cookId: m.cook_id, recipeName: m.recipes?.name ?? null }] : []
}

/** Unread check-ins of the household, oldest first, and their count (the app badge number). */
export function useUnreadCheckins() {
  const api = useApi()
  const q = useQuery({ queryKey: keys.checkins.unread(), queryFn: async () => (await api.checkins.unread()).flatMap(toUnread) })
  return { ...q, items: q.data ?? [], count: q.data?.length ?? 0 }
}

/**
 * Mount once, in the signed-in shell. Refetches check-ins (and pantry and settings, which the same signal covers) when
 * the household_events row changes, and keeps the app icon badge equal to the unread count.
 */
export function useCheckinsSync() {
  const qc = useQueryClient()
  const api = useApi()
  const { count, isSuccess } = useUnreadCheckins()
  useEffect(
    () => api.live.subscribeHouseholdEvents('checkins-signal', () => {
      void invalidateKeys(qc, [keys.checkins.all(), keys.pantry.all(), keys.household.all()])
    }),
    [api, qc],
  )
  useEffect(() => { if (isSuccess) void setAppBadge(count) }, [count, isSuccess])
}

/** Sets the app icon badge (Android, installed desktop PWAs, iOS 16.4+ with permission). A no-op where unsupported. */
export async function setAppBadge(count: number): Promise<void> {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
  try {
    if (count > 0) await nav.setAppBadge?.(count)
    else await nav.clearAppBadge?.()
  } catch { /* the badge is a nicety */ }
}

// ---- Commands --------------------------------------------------------------------------------------------------
/**
 * Answers a check-in: 'planned', 'changed' (send after the meal's amounts were edited), 'not_cooked' (also flags the
 * meal) or 'dismissed'. Output true when it cleared an unread check-in; false when someone already answered (retry-safe).
 */
export const answerCheckin = defineCommand<{ mealId: string; answer: CheckinAnswer }, boolean>({
  name: 'checkins.answer',
  run: (api, { mealId, answer }) => api.checkins.answer(mealId, answer),
  invalidates: () => [keys.checkins.all(), keys.pantry.all()],
  when: 'settled',
})

/** "Didn't cook" on or off. Turning it on also answers the meal's unread check-in (a database trigger). */
export const setNotCooked = defineCommand<{ mealId: string; value: boolean }>({
  name: 'checkins.setNotCooked',
  run: (api, { mealId, value }) => api.checkins.setNotCooked(mealId, value),
  invalidates: () => [keys.pantry.all(), keys.checkins.all()],
  when: 'settled',
})

/**
 * Replaces a meal's own amounts. They replace the recipe's lines for this meal, so send the full set (start from
 * seedMealLines(recipeLines, portions) in src/domain/mealLines.ts). An empty array removes them: the meal follows its recipe again.
 */
export const saveMealLines = defineCommand<{ mealId: string; lines: MealAmount[] }>({
  name: 'checkins.saveMealLines',
  run: (api, { mealId, lines }) => api.checkins.saveMealLines(mealId, lines),
  invalidates: () => [keys.pantry.all()],
  when: 'settled',
})

/** Saves the end time ('HH:MM') of each slot. Keys are slot names; the database refuses anything but HH:MM. */
export const saveSlotEndTimes = defineCommand<SlotEndTimes>({
  name: 'household.saveSlotEndTimes',
  run: (api, times) => api.checkins.saveSlotEndTimes(times),
  invalidates: () => [keys.household.all()],
  when: 'settled',
})

/**
 * "Done shopping": answers (per meal, from the finish dialog), saves the snapshot, clears the trip, and counts every
 * check-in still unread as "cooked as planned", all in one transaction. The batches are the snapshot: compute the
 * quantities with the not-cooked answers applied (snapshotPlan in src/domain/shoppingView.ts).
 * `expectedAt` is the household version the snapshot was computed from; a household that moved since is refused
 * (VERSION_CONFLICT) so a partner's batch is never silently dropped (MR-005). The caller keeps the dialog open and
 * asks for one more tap with the refreshed quantities.
 */
export const finishShopping = defineCommand<{ onDate: Day; batches: SnapshotBatch[]; answers: FinishAnswer[]; expectedAt: string | null }>({
  name: 'checkins.finishShopping',
  run: async (api, { onDate, batches, answers, expectedAt }) => {
    try {
      await api.checkins.finishShopping(onDate, batches, answers, expectedAt)
    } catch (e) {
      // The server's message names the versions; the person gets one sentence and a fresh list instead.
      if (e instanceof ApiError && e.code === VERSION_CONFLICT) throw new ApiError(PANTRY_CHANGED_MESSAGE, VERSION_CONFLICT)
      throw e
    }
  },
  invalidates: () => [keys.pantry.all(), keys.checkins.all()],
  when: 'settled',
})

/** Whether a failed finish means someone else changed the pantry (refetch, keep the dialog open, ask for one more tap). */
export const isVersionConflict = (e: Error): boolean => e instanceof ApiError && e.code === VERSION_CONFLICT

// ---- Slot end times ----------------------------------------------------------------------------------------------
/** The household's slots with the end time of each (stored value, else the default for that slot name). */
export function useSlotEndTimes() {
  const api = useApi()
  const q = useQuery({
    queryKey: keys.household.slotEndTimes(),
    queryFn: async () => {
      const data = await api.checkins.slotEndTimes()
      const stored = (data.slot_end_times ?? {}) as SlotEndTimes
      return { slots: data.slots, stored, resolved: Object.fromEntries(data.slots.map((s) => [s, slotEnd(s, stored)])) as SlotEndTimes }
    },
  })
  return { ...q, slots: q.data?.slots ?? [], endTimes: q.data?.resolved ?? {}, stored: q.data?.stored ?? {} }
}

export const useSaveSlotEndTimes = () => useCommand(saveSlotEndTimes)
