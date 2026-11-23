// Meal check-ins on the phone (ADR 0005): the shared unread list, answering, "didn't cook", per-meal amounts,
// the slot end times setting, the app icon badge, and "Done shopping" with its answers.
// A check-in is created by the server (push-cron) when a short meal's slot has ended 30 minutes ago; it stays
// unread, for both people, until someone answers it or "Done shopping" clears it as "cooked as planned".
import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { mealLinesPayload } from '../domain/mealLines.ts'
import type { Day, MealAmount } from '../domain/replay.ts'
import { slotEnd, type CheckinAnswer, type SlotEndTimes } from './checkin.ts'
import { supabase } from './supabase.ts'

export { CHECKIN_ANSWERS, parseCheckinParams, checkinUrl, slotEnd, slotLabel, type CheckinAnswer, type SlotEndTimes } from './checkin.ts'

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

const CHECKINS = ['checkins'] as const
export const invalidateCheckins = (qc: QueryClient) => qc.invalidateQueries({ queryKey: CHECKINS })

async function fetchUnread(): Promise<UnreadCheckin[]> {
  // RLS hides deleted check-ins, and the embed of a deleted meal comes back null: those are skipped.
  const { data, error } = await supabase
    .from('meal_checkins')
    .select('id, planned_meal_id, created_at, planned_meals(id, date, slot, portions, cook_id, recipes(name))')
    .is('answered_at', null)
    .order('created_at')
  if (error) throw error
  return data.flatMap((c) => {
    const m = c.planned_meals
    return m ? [{ id: c.id, mealId: m.id, createdAt: c.created_at, date: m.date, slot: m.slot, portions: m.portions, cookId: m.cook_id, recipeName: m.recipes?.name ?? null }] : []
  })
}

/** Unread check-ins of the household, oldest first, and their count (the app badge number). */
export function useUnreadCheckins() {
  const q = useQuery({ queryKey: [...CHECKINS, 'unread'], queryFn: fetchUnread })
  return { ...q, items: q.data ?? [], count: q.data?.length ?? 0 }
}

/**
 * Mount once, in the signed-in shell. Refetches check-ins (and pantry and settings, which the same signal covers) when
 * the household_events row changes, and keeps the app icon badge equal to the unread count.
 */
export function useCheckinsSync() {
  const qc = useQueryClient()
  const { count, isSuccess } = useUnreadCheckins()
  useEffect(() => {
    const channel = supabase.channel('checkins-signal')
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'household_events' }, () => {
      void invalidateCheckins(qc)
      void qc.invalidateQueries({ queryKey: ['pantry'] })
      void qc.invalidateQueries({ queryKey: ['household'] })
    })
    channel.subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [qc])
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

// ---- Answering -------------------------------------------------------------------------------------------------
/**
 * Answers a check-in: 'planned', 'changed' (call after the meal's amounts were edited), 'not_cooked' (also flags the
 * meal) or 'dismissed'. True when it cleared an unread check-in; false when someone already answered, so retrying is safe.
 */
export async function answerCheckin(mealId: string, answer: CheckinAnswer): Promise<boolean> {
  const { data, error } = await supabase.rpc('answer_checkin', { p_meal: mealId, p_answer: answer })
  if (error) throw error
  return data
}

/** Mutation form of answerCheckin; refreshes the unread list, the pantry and the plan. */
export function useAnswerCheckin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { mealId: string; answer: CheckinAnswer }) => answerCheckin(v.mealId, v.answer),
    onSettled: () => Promise.all([invalidateCheckins(qc), qc.invalidateQueries({ queryKey: ['pantry'] })]),
  })
}

/** "Didn't cook" on or off. Turning it on also answers the meal's unread check-in (a database trigger). */
export async function setMealNotCooked(mealId: string, notCooked: boolean): Promise<void> {
  const { error } = await supabase.from('planned_meals').update({ not_cooked: notCooked }).eq('id', mealId)
  if (error) throw error
}

// ---- Per-meal amounts ----------------------------------------------------------------------------------------
/**
 * Replaces a meal's own amounts. They replace the recipe's lines for this meal, so send the full set (start from
 * seedMealLines(recipeLines, portions) in src/domain/mealLines.ts). An empty array removes them: the meal follows its recipe again.
 */
export async function saveMealLines(mealId: string, lines: MealAmount[]): Promise<void> {
  const { error } = await supabase.rpc('save_meal_lines', { p_meal: mealId, p_lines: mealLinesPayload(lines) })
  if (error) throw error
}
export const clearMealLines = (mealId: string) => saveMealLines(mealId, [])

export function useSaveMealLines() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { mealId: string; lines: MealAmount[] }) => saveMealLines(v.mealId, v.lines),
    onSettled: () => qc.invalidateQueries({ queryKey: ['pantry'] }),
  })
}

/** A meal's own amounts from the pantry data (`usePantry().meals`), or null when it follows its recipe. */
export function mealOwnLines(meal: { planned_meal_lines?: { ingredient_id: string; qty_total: number | string | null }[] | null }): MealAmount[] | null {
  const l = meal.planned_meal_lines
  return l && l.length ? l.map((x) => ({ ingredientId: x.ingredient_id, qty: x.qty_total === null ? null : Number(x.qty_total) })) : null
}

// ---- Slot end times ----------------------------------------------------------------------------------------------
/** The household's slots with the end time of each (stored value, else the default for that slot name). */
export function useSlotEndTimes() {
  const q = useQuery({
    queryKey: ['household', 'slot_end_times'],
    queryFn: async () => {
      const { data, error } = await supabase.from('households').select('slots, slot_end_times').single()
      if (error) throw error
      const stored = (data.slot_end_times ?? {}) as SlotEndTimes
      return { slots: data.slots, stored, resolved: Object.fromEntries(data.slots.map((s) => [s, slotEnd(s, stored)])) as SlotEndTimes }
    },
  })
  return { ...q, slots: q.data?.slots ?? [], endTimes: q.data?.resolved ?? {}, stored: q.data?.stored ?? {} }
}

/** Saves the end time ('HH:MM') of each slot. Keys are slot names; the database refuses anything but HH:MM. */
export async function saveSlotEndTimes(times: SlotEndTimes): Promise<void> {
  const { error } = await supabase.from('households').update({ slot_end_times: times }).not('id', 'is', null)
  if (error) throw error
}

export function useSaveSlotEndTimes() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: saveSlotEndTimes, onSettled: () => qc.invalidateQueries({ queryKey: ['household'] }) })
}

// ---- Done shopping -------------------------------------------------------------------------------------------------
export type FinishAnswer = { meal_id: string; answer: 'planned' | 'not_cooked' }

/**
 * "Done shopping": answers (per meal, from the finish dialog), saves the snapshot, clears the trip, and counts every
 * check-in still unread as "cooked as planned", all in one transaction. `batches` is the snapshot, as before:
 * [{ batch_id, qty }]. Compute the quantities with the not-cooked answers applied, because those meals stop consuming stock.
 */
export async function finishShopping(onDate: Day, batches: { batch_id: string; qty: number }[], answers: FinishAnswer[] = []): Promise<string> {
  const { data, error } = await supabase.rpc('finish_shopping', { on_date: onDate, batches, answers })
  if (error) throw error
  return data
}
