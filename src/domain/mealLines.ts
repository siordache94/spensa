// Per-meal amounts (ADR 0005) and the recipe form's line payload. A meal either follows its recipe or, once it has
// its own lines, uses exactly those.
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

/**
 * One recipe line as typed in the form. `qty` is in the unit as displayed: the total for `serves` servings when
 * creating a recipe, the single-serving amount when editing one. `toTaste` comes from the ingredient's unit.
 */
export type RecipeLineDraft = {
  ingredientId: string | null
  qty: number | null
  toTaste: boolean
}

/**
 * Validates the form's lines and maps them to the save payload. `qty_per_portion` is the single-serving amount and
 * the only stored amount: creating collects totals for `serves` and divides once, editing saves the typed amount
 * as-is. To-taste lines store null. Throws on a missing ingredient, a duplicate, a non-positive amount or an
 * invalid serves count.
 */
export function recipeLinesPayload(
  lines: RecipeLineDraft[],
  serves: number,
  mode: 'create' | 'edit',
): { ingredient_id: string; qty_per_portion: number | null }[] {
  if (mode === 'create' && !(serves > 0)) throw new Error('Serves must be more than zero.')

  const seen = new Set<string>()
  return lines.map((line) => {
    if (line.ingredientId === null) throw new Error('Choose an ingredient for every line.')
    if (seen.has(line.ingredientId)) throw new Error('An ingredient can appear only once.')
    seen.add(line.ingredientId)

    if (line.toTaste) return { ingredient_id: line.ingredientId, qty_per_portion: null }
    if (line.qty === null || !(line.qty > 0)) throw new Error('Amounts must be more than zero.')

    return { ingredient_id: line.ingredientId, qty_per_portion: mode === 'create' ? line.qty / serves : line.qty }
  })
}
