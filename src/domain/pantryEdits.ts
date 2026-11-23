import type { Day } from './replay.ts'

/** One batch line in the pantry editor. batchId null = a line added in this edit (a new purchase). */
export type EditLine = {
  key: string
  batchId: string | null
  ingredientId: string
  qty: number | null
  expiry: Day | null
  /** Set when the row was removed: why (maps to the 'finished' / 'discard' adjustment kinds). */
  removed?: 'finished' | 'discard'
}

export type EditAdjustment =
  | { batch_id: string; ingredient_id: string; kind: 'set'; qty: number }
  | { batch_id: string; ingredient_id: string; kind: 'finished' | 'discard'; qty: null }

export type PantryEdits = {
  adjustments: EditAdjustment[]
  newBatches: { ingredient_id: string; qty: number; expires_on: Day | null }[]
  /** Expiry corrections on existing batches (a fix to the batch, not stock movement). */
  expiries: { batch_id: string; expires_on: Day | null }[]
}

const round3 = (n: number) => Number(n.toFixed(3))

/** What the user changed: only differences between the lines when editing began (base) and the draft are returned. */
export function diffEdits(base: EditLine[], draft: EditLine[]): PantryEdits {
  const before = new Map(base.filter((l) => l.batchId).map((l) => [l.batchId!, l]))
  const out: PantryEdits = { adjustments: [], newBatches: [], expiries: [] }
  for (const l of draft) {
    if (l.batchId === null) {
      if (!l.removed && l.qty !== null && l.qty > 0) out.newBatches.push({ ingredient_id: l.ingredientId, qty: l.qty, expires_on: l.expiry })
      continue
    }
    const old = before.get(l.batchId)
    if (!old) continue
    if (l.removed) {
      out.adjustments.push({ batch_id: l.batchId, ingredient_id: l.ingredientId, kind: l.removed, qty: null })
      continue
    }
    if (l.qty !== null && round3(l.qty) !== round3(old.qty ?? 0)) {
      out.adjustments.push({ batch_id: l.batchId, ingredient_id: l.ingredientId, kind: 'set', qty: l.qty })
    }
    if (l.expiry !== old.expiry) out.expiries.push({ batch_id: l.batchId, expires_on: l.expiry })
  }
  return out
}
