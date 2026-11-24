// The Shop row's tap rules and accessible names, as pure functions. The pointer path (a native button's click) and the
// keyboard path (Enter/Space on the same button) share one decision, so they cannot drift apart.

/** A partner-ticked row acknowledges itself after this long on screen, so the highlight is seen and then clears. */
export const ACK_DWELL_MS = 3000

/**
 * The coyote window after an acknowledgement. A tap on a row that was held a moment ago lands as the acknowledgement
 * the person intended, never as an untick of the partner's purchase. The explicit put-back control ignores it.
 */
export const ACK_COYOTE_MS = 3000

export type RowKind = 'list' | 'cart'

/** What a row button says it does. */
export type RowAction = 'buy' | 'acknowledge' | 'putBack'

/**
 * Where the tap landed: the row button (its tick and its name), the amount pencil, or the explicit put-back control.
 * Only a list row draws a pencil; the name is never a separate control.
 */
export type TapTarget = 'row' | 'name' | 'pencil' | 'putBack'

/** What the page should do with a tap. `ignore` swallows it: the row was just acknowledged. */
export type TapAction = 'tick' | 'edit' | 'acknowledge' | 'untick' | 'ignore'

export type TapInput = {
  /** A list row is still to buy; a cart row was already ticked. */
  row: RowKind
  /** Cart rows: the row still shows the partner highlight. */
  held?: boolean
  /** Defaults to the row itself. */
  target?: TapTarget
  /** When this row was acknowledged on this phone (epoch ms), if it was. */
  ackedAt?: number
  /** When the tap is handled (epoch ms). */
  at: number
}

/**
 * One tap, one outcome.
 * - The pencil is the only way into amounts; a name tap is a row tap and ticks (MR-042).
 * - A list row ticks.
 * - A held cart row acknowledges only; it never runs the cart's untick.
 * - A normal cart row untick, except inside the coyote window after an acknowledgement.
 * - The explicit put-back control always untick, even while held or inside the window.
 */
export function tapAction({ row, held = false, target = 'row', ackedAt, at }: TapInput): TapAction {
  if (target === 'pencil') return 'edit'
  if (row === 'list') return 'tick'
  if (target === 'putBack') return 'untick'
  if (held) return 'acknowledge'
  // A clock that jumped backwards also counts as "inside": swallowing a tap is the safe side.
  if (ackedAt !== undefined && at - ackedAt < ACK_COYOTE_MS) return 'ignore'
  return 'untick'
}

/** The facts a row shows, as read out: name, amount, pack hint and note. */
export type RowFacts = {
  name: string
  figure?: string
  unit?: string
  /** Text in the amount column instead of a figure, e.g. "to taste". */
  free?: string
  pack?: string
  note?: string
}

const actionVerb: Record<RowAction, string> = { buy: 'Buy', acknowledge: 'Acknowledge', putBack: 'Put back' }

/** "Milk, 2 l, ≈ 3 packs, Staple, below min stock" - every visible fact, in the order it is shown. */
export function rowFactsLabel(row: RowFacts): string {
  const amount = row.free ?? [row.figure, row.unit].filter(Boolean).join(' ')
  return [row.name, amount, row.pack, row.note].filter((part): part is string => Boolean(part)).join(', ')
}

/** A row button's accessible name: the action and every fact. The visible name is always inside it (label in name). */
export function rowLabel(row: RowFacts, action: RowAction): string {
  return `${actionVerb[action]} ${rowFactsLabel(row)}`
}
