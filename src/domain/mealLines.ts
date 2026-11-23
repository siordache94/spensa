// Per-meal amounts (ADR 0005). A meal either follows its recipe or, once it has its own lines, uses exactly those.
import type { MealAmount, RecipeLine } from './replay.ts'

/** Starting point for editing a meal's own amounts: the recipe's lines scaled to the meal's portions. */
export function seedMealLines(recipeLines: RecipeLine[], portions: number): MealAmount[] {
  return recipeLines.map((l) => ({ ingredientId: l.ingredientId, qty: l.qtyPerPortion === null ? null : l.qtyPerPortion * portions }))
}

/** Rows to send to save_meal_lines. Amounts that are not positive numbers are refused (null = to taste is allowed). */
export function mealLinesPayload(lines: MealAmount[]): { ingredient_id: string; qty_total: number | null }[] {
  const seen = new Set<string>()
  return lines.map((l) => {
    if (seen.has(l.ingredientId)) throw new Error('An ingredient can appear only once.')
    seen.add(l.ingredientId)
    if (l.qty !== null && !(l.qty > 0)) throw new Error('Amounts must be more than zero.')
    return { ingredient_id: l.ingredientId, qty_total: l.qty }
  })
}
