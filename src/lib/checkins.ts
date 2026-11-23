// Facade: the check-in hooks and commands live in src/lib/api/checkins.ts. Pages that have not moved yet keep this path.
import type { MealAmount } from '../domain/replay.ts'

export { CHECKIN_ANSWERS, parseCheckinParams, checkinUrl, slotEnd, slotLabel, type CheckinAnswer, type SlotEndTimes } from './checkin.ts'
export { setAppBadge, useCheckinsSync, useSaveSlotEndTimes, useSlotEndTimes, useUnreadCheckins, type UnreadCheckin } from './api/checkins.ts'

/** A meal's own amounts from the pantry data (`usePantry().meals`), or null when it follows its recipe. */
export function mealOwnLines(meal: { planned_meal_lines?: { ingredient_id: string; qty_total: number | string | null }[] | null }): MealAmount[] | null {
  const l = meal.planned_meal_lines
  return l && l.length ? l.map((x) => ({ ingredientId: x.ingredient_id, qty: x.qty_total === null ? null : Number(x.qty_total) })) : null
}
