// Database rows -> replay input. Pure, so the phone (src/lib/api/pantry.ts) and the push edge functions
// (supabase/functions) build the very same events from the same rows.
import type { Day, Ingredient, PantryEvents } from './replay.ts'

const dayFormats = new Map<string, Intl.DateTimeFormat>()
const dayFormat = (timeZone: string) => {
  let f = dayFormats.get(timeZone)
  if (!f) dayFormats.set(timeZone, (f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })))
  return f
}

/** The household-local calendar day of an instant ('YYYY-MM-DD'). */
export const localDay = (iso: string | Date, timeZone: string): Day => dayFormat(timeZone).format(new Date(iso))

const num = (v: number | string | null) => (v === null ? null : Number(v))

export type BatchRow = { id: string; ingredient_id: string; qty: number | string; added_at: string; recorded_at: string; expires_on: string | null }
export type MealRow = {
  id: string
  date: string
  portions: number
  not_cooked?: boolean
  /** Per-meal amounts (live rows only); when not empty they replace the recipe's lines for this meal. */
  planned_meal_lines?: { ingredient_id: string; qty_total: number | string | null }[] | null
  slot?: string
  position?: number
  recipes: { recipe_ingredients: { ingredient_id: string; qty_per_portion: number | string | null }[] } | null
}
export type AdjustmentRow = {
  ingredient_id: string
  batch_id: string | null
  kind: 'used' | 'set' | 'finished' | 'discard'
  qty: number | string | null
  recorded_at: string
  at: string
}
export type SnapshotRow = { on_date: string; taken_at: string; snapshot_batches: { batch_id: string; qty: number | string }[] }
export type IngredientRow = {
  id: string
  unit: Ingredient['unit']
  pack_size: number | string | null
  min_stock: number | string | null
  on_hand: boolean
}

export function buildEvents(
  rows: { batches: BatchRow[]; meals: MealRow[]; adjustments: AdjustmentRow[]; snapshot: SnapshotRow | null | undefined; slots?: string[] | null },
  tz: string,
): PantryEvents {
  const snap = rows.snapshot
  return {
    batches: rows.batches.map((b) => ({
      id: b.id,
      ingredientId: b.ingredient_id,
      qty: Number(b.qty),
      // server time, so a phone with a wrong clock can't hide or misplace its batch; added_at is for display
      addedOn: localDay(b.recorded_at, tz),
      addedAt: b.added_at,
      recordedAt: b.recorded_at,
      expiresOn: b.expires_on,
    })),
    meals: rows.meals.map((m) => ({
      id: m.id,
      date: m.date,
      portions: m.portions,
      lines: (m.recipes?.recipe_ingredients ?? []).map((l) => ({ ingredientId: l.ingredient_id, qtyPerPortion: num(l.qty_per_portion) })),
      notCooked: m.not_cooked ?? false,
      override: m.planned_meal_lines?.length ? m.planned_meal_lines.map((l) => ({ ingredientId: l.ingredient_id, qty: num(l.qty_total) })) : undefined,
      slot: m.slot,
      position: m.position,
    })),
    adjustments: rows.adjustments.map((a) => ({
      ingredientId: a.ingredient_id,
      batchId: a.batch_id,
      kind: a.kind,
      qty: num(a.qty),
      on: localDay(a.recorded_at, tz),
      at: a.at,
      recordedAt: a.recorded_at,
    })),
    snapshot: snap
      ? { onDate: snap.on_date, takenAt: snap.taken_at, batches: snap.snapshot_batches.map((s) => ({ batchId: s.batch_id, qty: Number(s.qty) })) }
      : null,
    slotOrder: rows.slots ?? undefined,
  }
}

export const buildIngredients = (rows: IngredientRow[]): Ingredient[] =>
  rows.map((i) => ({ id: i.id, unit: i.unit, packSize: num(i.pack_size), minStock: num(i.min_stock), onHand: i.on_hand }))
