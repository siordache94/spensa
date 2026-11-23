// Stock is never stored: it is replayed from facts. See docs/adr/0001-stock-by-replay.md.

/** 'YYYY-MM-DD' in the household's local time. */
export type Day = string

export interface Batch {
  id: string
  ingredientId: string
  qty: number
  addedOn: Day
  addedAt: string // the phone's clock when ticked; display only
  recordedAt: string // server time; decides whether a snapshot covers it
  expiresOn: Day | null
}

export interface RecipeLine {
  ingredientId: string
  qtyPerPortion: number | null // null = to taste
}

/** What one meal takes of an ingredient in total; null = to taste. */
export interface MealAmount {
  ingredientId: string
  qty: number | null
}

export interface Meal {
  id: string
  date: Day
  portions: number
  lines: RecipeLine[]
  /** "Didn't cook": the meal consumes nothing (ADR 0005). */
  notCooked?: boolean
  /** Per-meal amounts. When present and not empty they replace the recipe lines for this meal (ADR 0005). */
  override?: MealAmount[]
  /** The household slot this meal is eaten in (e.g. 'lunch'). Only used for same-day ordering with `PantryEvents.slotOrder`. */
  slot?: string
  /** Position within its slot (the order the user saved them in). Only used with `PantryEvents.slotOrder`. */
  position?: number
}

export interface Adjustment {
  ingredientId: string
  batchId: string | null // null = soonest-expiring batch
  kind: 'used' | 'set' | 'finished' | 'discard'
  qty: number | null // for 'used' and 'set'
  on: Day
  at: string // the phone's clock; display only
  recordedAt: string // server time; decides whether a snapshot covers it
}

export interface Snapshot {
  onDate: Day
  takenAt: string
  batches: { batchId: string; qty: number }[]
}

export interface PantryEvents {
  batches: Batch[]
  meals: Meal[]
  adjustments: Adjustment[]
  snapshot: Snapshot | null
  /** The household's slots in day order, e.g. ['lunch','dinner']. When set, same-day meals are eaten in this order. Absent = stored order. */
  slotOrder?: string[]
}

export interface Shortfall {
  mealId: string
  ingredientId: string
  missing: number
}

export interface Ingredient {
  id: string
  unit: 'g' | 'ml' | 'count' | 'to_taste'
  packSize: number | null
  minStock: number | null
  onHand: boolean
}

export interface Need {
  ingredientId: string
  qty: number | null // null = to taste, just buy it
  packs: number | null
}

const EPS = 1e-9

/** What a meal takes: its own amounts when it has any, else the recipe's per-portion lines times portions. Nothing if not cooked. */
export function mealAmounts(m: Meal): MealAmount[] {
  if (m.notCooked) return []
  if (m.override && m.override.length > 0) return m.override
  return m.lines.map((l) => ({ ingredientId: l.ingredientId, qty: l.qtyPerPortion === null ? null : l.qtyPerPortion * m.portions }))
}

export const addDays = (d: Day, n: number): Day => {
  const t = new Date(`${d}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}

/** Same-day meal order: slot (known slots in household order, unknown last), then position, then id. Null when the slot order is unknown. */
const mealOrder = (slotOrder: string[] | undefined): ((a: Meal, b: Meal) => number) | null => {
  if (!slotOrder) return null
  const rank = (m: Meal) => {
    const i = m.slot === undefined ? -1 : slotOrder.indexOf(m.slot)
    return i < 0 ? slotOrder.length : i
  }
  return (a, b) => rank(a) - rank(b) || (a.position ?? 0) - (b.position ?? 0) || a.id.localeCompare(b.id)
}

export const byExpiry = (a: Batch, b: Batch) =>
  (a.expiresOn ?? '9999').localeCompare(b.expiresOn ?? '9999') || Date.parse(a.addedAt) - Date.parse(b.addedAt)

/** Replays every event up to and including `upTo`. */
export function replay(
  ev: PantryEvents,
  upTo: Day,
): { remaining: Map<string, number>; shortfalls: Shortfall[]; consumed: { mealId: string; batchId: string; qty: number }[] } {
  const snap = ev.snapshot
  const snapAt = snap ? Date.parse(snap.takenAt) : -Infinity
  const remaining = new Map<string, number>(snap?.batches.map((b) => [b.batchId, b.qty]))
  const shortfalls: Shortfall[] = []
  const consumed: { mealId: string; batchId: string; qty: number }[] = []
  const left = (id: string) => remaining.get(id) ?? 0

  // Batches with stock, soonest expiry first. With `day`, only those still usable that day.
  const fefo = (ingredientId: string, day: Day | null) =>
    ev.batches
      .filter((b) => b.ingredientId === ingredientId && left(b.id) > EPS && (day === null || b.expiresOn === null || b.expiresOn >= day))
      .sort(byExpiry)

  const take = (batches: Batch[], qty: number, mealId?: string) => {
    for (const b of batches) {
      const t = Math.min(qty, left(b.id))
      remaining.set(b.id, left(b.id) - t)
      if (mealId && t > 0) consumed.push({ mealId, batchId: b.id, qty: t })
      qty -= t
      if (qty <= EPS) return 0
    }
    return qty
  }

  const eat = (m: Meal) => {
    for (const l of mealAmounts(m)) {
      if (l.qty === null) continue
      const missing = take(fefo(l.ingredientId, m.date), l.qty, m.id)
      if (missing > EPS) shortfalls.push({ mealId: m.id, ingredientId: l.ingredientId, missing })
    }
  }

  const adjust = (a: Adjustment) => {
    const targets = a.batchId ? ev.batches.filter((b) => b.id === a.batchId && remaining.has(b.id)) : fefo(a.ingredientId, null)
    if (a.kind === 'used') return void take(targets, a.qty ?? 0)
    const first = targets[0]
    if (first) remaining.set(first.id, a.kind === 'set' ? Math.max(0, a.qty ?? 0) : 0)
  }

  type Step = { day: Day; rank: number; at: number; meal?: Meal; run: () => void }
  const steps: Step[] = [
    ...ev.batches
      .filter((b) => Date.parse(b.recordedAt) > snapAt)
      .map((b) => ({ day: b.addedOn, rank: 0, at: Date.parse(b.recordedAt), run: () => remaining.set(b.id, b.qty) })),
    ...ev.meals.filter((m) => !snap || m.date > snap.onDate).map((m) => ({ day: m.date, rank: 1, at: 0, meal: m, run: () => eat(m) })),
    ...ev.adjustments
      .filter((a) => Date.parse(a.recordedAt) > snapAt)
      .map((a) => ({ day: a.on, rank: 2, at: Date.parse(a.recordedAt), run: () => adjust(a) })),
  ]
  const byMeal = mealOrder(ev.slotOrder)
  steps
    .filter((s) => s.day <= upTo)
    .sort((x, y) => x.day.localeCompare(y.day) || x.rank - y.rank || x.at - y.at || (byMeal && x.meal && y.meal ? byMeal(x.meal, y.meal) : 0))
    .forEach((s) => s.run())

  return { remaining, shortfalls, consumed }
}

export function stockByIngredient(ev: PantryEvents, remaining: Map<string, number>): Map<string, number> {
  const stock = new Map<string, number>()
  for (const b of ev.batches) {
    const q = remaining.get(b.id) ?? 0
    if (q > EPS) stock.set(b.ingredientId, (stock.get(b.ingredientId) ?? 0) + q)
  }
  return stock
}

/** Batches with stock that expire within `days` of `today`, already expired ones included. */
export function expiringSoon(ev: PantryEvents, remaining: Map<string, number>, today: Day, days: number): Batch[] {
  const limit = addDays(today, days)
  return ev.batches
    .filter((b) => b.expiresOn !== null && b.expiresOn <= limit && (remaining.get(b.id) ?? 0) > EPS)
    .sort(byExpiry)
}

/**
 * What to buy for meals in [from, to], plus staples below min stock and to-taste items marked out.
 * With `mealIds`, only those meals in range are shopped for; the others still consume stock in the replay.
 */
export function shoppingList(ev: PantryEvents, ingredients: Ingredient[], from: Day, to: Day, mealIds?: ReadonlySet<string>): Need[] {
  const { remaining, shortfalls } = replay(ev, to)
  const inRange = new Set(ev.meals.filter((m) => m.date >= from && m.date <= to).map((m) => m.id))
  const shopFor = mealIds ? new Set([...inRange].filter((id) => mealIds.has(id))) : inRange
  const short = new Map<string, number>()
  for (const s of shortfalls) if (shopFor.has(s.mealId)) short.set(s.ingredientId, (short.get(s.ingredientId) ?? 0) + s.missing)
  const usable = stockByIngredient({ ...ev, batches: ev.batches.filter((b) => b.expiresOn === null || b.expiresOn >= to) }, remaining)
  const toTaste = new Set(
    ev.meals.filter((m) => shopFor.has(m.id)).flatMap((m) => mealAmounts(m).filter((l) => l.qty === null).map((l) => l.ingredientId)),
  )

  const needs: Need[] = []
  for (const i of ingredients) {
    if (i.unit === 'to_taste') {
      if (!i.onHand && toTaste.has(i.id)) needs.push({ ingredientId: i.id, qty: null, packs: null })
      continue
    }
    const qty = (short.get(i.id) ?? 0) + Math.max(0, (i.minStock ?? 0) - (usable.get(i.id) ?? 0))
    if (qty > EPS) needs.push({ ingredientId: i.id, qty, packs: i.packSize ? Math.ceil(qty / i.packSize - EPS) : null })
  }
  return needs
}
