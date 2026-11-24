// The pantry editor's draft: persisted per household in sessionStorage and rebased onto fresh server facts when the
// household changes underneath it (MR-013). Pure apart from the small storage wrapper, so the merge rules are testable.
import { round3 } from './format.ts'
import type { EditLine } from '../domain/pantryEdits.ts'

/** A draft line plus what the server showed when editing began, so Save can write only the difference. */
export type PantryDraft = {
  lines: EditLine[]
  shown: string[]
  origin: EditLine[]
  /** household_events.at when the draft was started (undefined while the event clock is unknown). */
  version: string | undefined
  /** To-taste switches the user changed: ingredient id -> on hand. Unchanged ingredients are absent. */
  onHand: Record<string, boolean>
}

type StoredPantryDraft = PantryDraft & { savedAt: number }

export type PantryDraftStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  readonly length?: number
  key?(index: number): string | null
}

/** Old drafts are confusing more than useful; a session's work is normally minutes old. */
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000

const PREFIX = 'spensa.pantryDraft.'

export const pantryDraftKey = (householdId: string) => `${PREFIX}${householdId}`

function defaultStorage(): PantryDraftStorage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    // Blocked storage (some privacy modes) must not stop the editor from working.
    return null
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function isLine(value: unknown): value is EditLine {
  if (!isRecord(value)) return false
  return (
    typeof value.key === 'string' &&
    (value.batchId === null || typeof value.batchId === 'string') &&
    typeof value.ingredientId === 'string' &&
    (value.qty === null || (typeof value.qty === 'number' && Number.isFinite(value.qty))) &&
    (value.expiry === null || typeof value.expiry === 'string') &&
    (value.removed === undefined || value.removed === 'finished' || value.removed === 'discard')
  )
}

function isLineArray(value: unknown): value is EditLine[] {
  return Array.isArray(value) && value.every(isLine)
}

function isStoredDraft(value: unknown): value is StoredPantryDraft {
  if (!isRecord(value)) return false
  return (
    isLineArray(value.lines) &&
    isLineArray(value.origin) &&
    Array.isArray(value.shown) &&
    value.shown.every((id) => typeof id === 'string') &&
    (value.version === undefined || typeof value.version === 'string') &&
    isRecord(value.onHand) &&
    Object.values(value.onHand).every((onHand) => typeof onHand === 'boolean') &&
    typeof value.savedAt === 'number' &&
    Number.isFinite(value.savedAt)
  )
}

/** The stored draft for this household, or null when there is none, it is malformed, or it has expired. */
export function loadPantryDraft(
  householdId: string,
  now: number = Date.now(),
  storage: PantryDraftStorage | null = defaultStorage(),
): PantryDraft | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(pantryDraftKey(householdId))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isStoredDraft(parsed) || now - parsed.savedAt > DRAFT_TTL_MS) {
      storage.removeItem(pantryDraftKey(householdId))
      return null
    }
    return {
      lines: parsed.lines,
      shown: parsed.shown,
      origin: parsed.origin,
      version: parsed.version,
      onHand: parsed.onHand,
    }
  } catch {
    return null
  }
}

export function savePantryDraft(
  householdId: string,
  draft: PantryDraft,
  now: number = Date.now(),
  storage: PantryDraftStorage | null = defaultStorage(),
): void {
  if (!storage) return
  try {
    storage.setItem(pantryDraftKey(householdId), JSON.stringify({ ...draft, savedAt: now }))
  } catch {
    // A full or unavailable sessionStorage must never break editing.
  }
}

export function clearPantryDraft(
  householdId: string,
  storage: PantryDraftStorage | null = defaultStorage(),
): void {
  if (!storage) return
  try {
    storage.removeItem(pantryDraftKey(householdId))
  } catch {
    // Nothing to do: the draft is only a convenience.
  }
}

/** Sign-out clears every household's draft on this device. */
export function clearPantryDrafts(storage: PantryDraftStorage | null = defaultStorage()): void {
  if (!storage) return
  try {
    const keys: string[] = []
    for (let i = 0; i < (storage.length ?? 0); i++) {
      const key = storage.key?.(i)
      if (key?.startsWith(PREFIX)) keys.push(key)
    }
    keys.forEach((key) => storage.removeItem(key))
  } catch {
    // Nothing to do: the draft is only a convenience.
  }
}

/** Whether the server moved since the draft was stored. Unknown clocks cannot be compared safely. */
export const draftNeedsRebase = (
  storedVersion: string | undefined,
  freshVersion: string | undefined,
): boolean => storedVersion !== undefined && freshVersion !== undefined && storedVersion !== freshVersion

export type DroppedChange = 'amount' | 'expiry' | 'removal'

/** A user edit whose batch no longer exists on the server. The UI names the ingredient and lists the changes. */
export type DroppedEdit = {
  batchId: string
  ingredientId: string
  changes: DroppedChange[]
}

export type RebaseResult = {
  lines: EditLine[]
  origin: EditLine[]
  shown: string[]
  dropped: DroppedEdit[]
}

const qtyOf = (line: EditLine) => (line.qty === null ? null : round3(line.qty))

/** The fields the user explicitly changed on one base batch. Removal swallows amount/expiry (removal wins). */
function changedFields(old: EditLine, next: EditLine): DroppedChange[] {
  if (next.removed !== old.removed) return ['removal']
  const changes: DroppedChange[] = []
  if (qtyOf(next) !== qtyOf(old)) changes.push('amount')
  if (next.expiry !== old.expiry) changes.push('expiry')
  return changes
}

/**
 * Rebase the user's origin -> draft edits onto a fresh server base. The user's explicit field edits win on batches they
 * touched, partner-only changes are adopted, user-added batches are kept, and edits to vanished batches are dropped
 * and reported instead of resurrecting the batch.
 */
export function rebaseDraft(
  origin: EditLine[],
  draft: EditLine[],
  fresh: { lines: EditLine[]; shown: string[] },
): RebaseResult {
  const draftByBatch = new Map(draft.filter((l) => l.batchId).map((l) => [l.batchId!, l]))
  const freshIds = new Set(fresh.lines.filter((l) => l.batchId).map((l) => l.batchId!))
  const dropped: DroppedEdit[] = []

  for (const old of origin) {
    if (!old.batchId || freshIds.has(old.batchId)) continue
    const next = draftByBatch.get(old.batchId)
    if (!next) continue
    const changes = changedFields(old, next)
    if (changes.length > 0) dropped.push({ batchId: old.batchId, ingredientId: old.ingredientId, changes })
  }

  const lines: EditLine[] = []
  for (const base of fresh.lines) {
    const old = base.batchId ? origin.find((l) => l.batchId === base.batchId) : undefined
    const next = base.batchId ? draftByBatch.get(base.batchId) : undefined
    if (!old || !next) {
      lines.push(base)
      continue
    }
    const changes = changedFields(old, next)
    if (changes.length === 0) {
      lines.push(base)
      continue
    }
    // Removal wins; otherwise apply only the fields the user changed and keep the partner's fresh values elsewhere.
    lines.push({
      ...base,
      qty: changes.includes('removal') ? base.qty : changes.includes('amount') ? next.qty : base.qty,
      expiry: changes.includes('removal') ? base.expiry : changes.includes('expiry') ? next.expiry : base.expiry,
      removed: next.removed,
    })
  }

  // A line the user added is a new purchase: it has no server batch to collide with.
  for (const line of draft) {
    if (line.batchId === null && !line.removed) lines.push(line)
  }

  const shown = [...fresh.shown]
  for (const line of lines) {
    if (!shown.includes(line.ingredientId)) shown.push(line.ingredientId)
  }

  return { lines, origin: fresh.lines, shown, dropped }
}

/** The to-taste switches to write: only values that differ from the current server row (and still exist). */
export function onHandChanges(
  onHand: Record<string, boolean>,
  current: readonly { id: string; on_hand: boolean }[],
): { id: string; onHand: boolean }[] {
  const now = new Map(current.map((i) => [i.id, i.on_hand]))
  return Object.entries(onHand).flatMap(([id, value]) =>
    now.has(id) && now.get(id) !== value ? [{ id, onHand: value }] : [],
  )
}

export const droppedEditCount = (dropped: readonly DroppedEdit[]): number =>
  dropped.reduce((count, edit) => count + edit.changes.length, 0)
