// Meal check-ins in the phone's logic (ADR 0005): the answers the "Done shopping" dialog sends, the replay those
// answers imply for the snapshot, and the recipe's lines as the replay reads them.
import type { PantryEvents, RecipeLine } from './replay.ts'

export type FinishAnswer = { meal_id: string; answer: 'planned' | 'not_cooked' }

/** One answer per unread meal: 'not_cooked' when the dialog chose it, else 'planned' (the default). */
export function finishAnswers(mealIds: readonly string[], notCooked: ReadonlySet<string>): FinishAnswer[] {
  return mealIds.map((id) => ({ meal_id: id, answer: notCooked.has(id) ? 'not_cooked' : 'planned' }))
}

/** The replay input with these meals marked "didn't cook", so the snapshot is computed as the server will apply it. */
export function markNotCooked(ev: PantryEvents, mealIds: ReadonlySet<string>): PantryEvents {
  return { ...ev, meals: ev.meals.map((m) => (mealIds.has(m.id) ? { ...m, notCooked: true } : m)) }
}

/** A recipe's ingredient rows (as embedded in the planned meals) in the replay's shape. */
export function recipeLines(rows: { ingredient_id: string; qty_per_portion: number | string | null }[]): RecipeLine[] {
  return rows.map((l) => ({ ingredientId: l.ingredient_id, qtyPerPortion: l.qty_per_portion === null ? null : Number(l.qty_per_portion) }))
}
