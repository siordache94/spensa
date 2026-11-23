import { useEffect, useRef } from 'react'

export const UNDO_MS = 4000

/** The toast's words for a tick: "Bought Milk" for a purchase or a to-taste row, "Checked Bread" for a free-text item. */
export const undoMessage = (kind: 'buy' | 'toTaste' | 'checkText', name: string) => `${kind === 'checkText' ? 'Checked' : 'Bought'} ${name}`

/** The Finish dialog's count line: "1 item not bought", "3 items not bought", or null when nothing is left. */
export const notBoughtLine = (n: number) => (n === 0 ? null : `${n} ${n === 1 ? 'item' : 'items'} not bought`)

/**
 * A short-lived "Bought Milk · Undo" bar above the shop dock. The parent keys it by tick id, so a new tick
 * remounts it and restarts the timer. It reports its own expiry through `onExpire`.
 */
export function UndoToast({ message, onUndo, onExpire }: { message: string; onUndo: () => void; onExpire: () => void }) {
  const expire = useRef(onExpire)
  expire.current = onExpire
  useEffect(() => {
    const t = setTimeout(() => expire.current(), UNDO_MS)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="sp-undo" role="status" aria-live="polite">
      <span className="sp-undo-msg">{message}</span>
      <span className="sp-undo-sep" aria-hidden="true">·</span>
      <button type="button" className="sp-undo-btn" onClick={onUndo}>Undo</button>
    </div>
  )
}
