// Quick pantry corrections (MR-019): the math and the one-line summary an edit row shows. Kept out of the page so the
// four actions and the change text are testable without a DOM. The page only paints what these return; every result
// goes through the draft's patch(), so Save is still the only write.
import type { EditLine } from '../domain/pantryEdits.ts'
import { formatQuantity, round3 } from './format.ts'

/** The four corrections: `used` subtracts, `set` replaces, the other two record why the batch left. */
export type QuickAction = 'used' | 'set' | 'finished' | 'waste'

/** What patch() needs: the resulting quantity, and (for a removal) why it left. */
export type QuickPatch = { qty: number; removed?: 'finished' | 'discard' }

/**
 * Apply one correction to a line. `used` never goes below zero: over-using is "gone", not a negative batch.
 * Used and Set also clear a previous removal, so a batch marked by mistake can be amended back into stock.
 */
export function applyQuickAction(line: Pick<EditLine, 'qty'>, action: QuickAction, amount = 0): QuickPatch {
  const current = line.qty ?? 0
  if (action === 'finished') return { qty: current, removed: 'finished' }
  if (action === 'waste') return { qty: current, removed: 'discard' }
  const value = Number.isFinite(amount) ? Math.max(0, amount) : 0
  const qty = action === 'set' ? value : Math.max(0, current - value)
  return { qty: round3(qty), removed: undefined }
}

/**
 * The pending-change line for an existing batch: "750 g → 500 g", "600 g → threw away", "1 kg → finished".
 * Null when nothing changed, and always null for a line added in this edit (a purchase is not a correction).
 * The unit comes through formatQuantity/visibleUnit, so a count reads "4 → 2", never "4 count".
 */
export function changeSummary(
  line: Pick<EditLine, 'batchId' | 'qty' | 'removed'>,
  origin: Pick<EditLine, 'qty'> | undefined,
  unit: string | null | undefined,
): string | null {
  if (line.batchId === null || !origin) return null
  const before = formatQuantity(origin.qty ?? 0, unit)
  if (line.removed === 'finished') return `${before} → finished`
  if (line.removed === 'discard') return `${before} → threw away`
  const after = round3(line.qty ?? 0)
  if (after === round3(origin.qty ?? 0)) return null
  return `${before} → ${formatQuantity(after, unit)}`
}
