import { useEffect, useRef } from 'react'
import { UNDO_MS } from '../lib/undoToast.ts'

/**
 * A short-lived "Bought Milk · Undo" bar above the shop dock. The parent keys it by tick id, so a new tick
 * remounts it and restarts the timer. It reports its own expiry through `onExpire`.
 */
export function UndoToast({ message, onUndo, onExpire }: { message: string; onUndo: () => void; onExpire: () => void }) {
  const expire = useRef(onExpire)
  // Keep the latest callback without restarting the timer: the parent passes a new function on every render.
  useEffect(() => { expire.current = onExpire }, [onExpire])
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
