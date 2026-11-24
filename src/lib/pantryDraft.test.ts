import { describe, expect, it } from 'vitest'
import { diffEdits, type EditLine } from '../domain/pantryEdits.ts'
import {
  clearPantryDraft,
  clearPantryDrafts,
  DRAFT_TTL_MS,
  draftNeedsRebase,
  droppedEditCount,
  loadPantryDraft,
  onHandChanges,
  pantryDraftKey,
  rebaseDraft,
  savePantryDraft,
  type PantryDraft,
} from './pantryDraft.ts'

function fakeStorage() {
  const m = new Map<string, string>()
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v) },
    removeItem: (k: string) => { m.delete(k) },
    get length() { return m.size },
    key: (i: number) => [...m.keys()][i] ?? null,
  }
}

const line = (p: Partial<EditLine> & { key: string }): EditLine => ({
  batchId: p.key,
  ingredientId: 'i1',
  qty: 100,
  expiry: null,
  ...p,
})

const draft = (lines: EditLine[], extra: Partial<PantryDraft> = {}): PantryDraft => ({
  lines,
  shown: ['i1'],
  origin: lines,
  version: 'v1',
  onHand: {},
  ...extra,
})

describe('pantry draft persistence', () => {
  it('restores a draft for the same household only', () => {
    const storage = fakeStorage()
    const saved = draft([line({ key: 'b1', qty: 80 })], { onHand: { i2: true } })

    savePantryDraft('household-1', saved, 1_000, storage)

    expect(loadPantryDraft('household-1', 2_000, storage)).toEqual(saved)
    expect(loadPantryDraft('household-2', 2_000, storage)).toBeNull()
  })

  it('drops an expired draft instead of restoring stale work', () => {
    const storage = fakeStorage()
    savePantryDraft('h1', draft([line({ key: 'b1' })]), 1_000, storage)

    expect(loadPantryDraft('h1', 1_000 + DRAFT_TTL_MS, storage)).not.toBeNull()
    expect(loadPantryDraft('h1', 1_000 + DRAFT_TTL_MS + 1, storage)).toBeNull()
    expect(storage.m.has(pantryDraftKey('h1'))).toBe(false)
  })

  it('ignores malformed or older-shaped data', () => {
    const storage = fakeStorage()
    storage.setItem(pantryDraftKey('h1'), '{"lines":"nope"}')
    expect(loadPantryDraft('h1', 2_000, storage)).toBeNull()

    storage.setItem(pantryDraftKey('h1'), 'not json')
    expect(loadPantryDraft('h1', 2_000, storage)).toBeNull()
  })

  it('clears one household draft or all of them on sign-out', () => {
    const storage = fakeStorage()
    savePantryDraft('h1', draft([line({ key: 'b1' })]), 1_000, storage)
    savePantryDraft('h2', draft([line({ key: 'b2' })]), 1_000, storage)

    clearPantryDraft('h1', storage)
    expect(loadPantryDraft('h1', 2_000, storage)).toBeNull()
    expect(loadPantryDraft('h2', 2_000, storage)).not.toBeNull()

    clearPantryDrafts(storage)
    expect(loadPantryDraft('h2', 2_000, storage)).toBeNull()
  })
})

describe('version mismatch', () => {
  it('rebases only when both event clocks are known and differ', () => {
    expect(draftNeedsRebase('at-1', 'at-2')).toBe(true)
    expect(draftNeedsRebase('at-1', 'at-1')).toBe(false)
    expect(draftNeedsRebase(undefined, 'at-1')).toBe(false)
    expect(draftNeedsRebase('at-1', undefined)).toBe(false)
  })
})

describe('rebaseDraft', () => {
  it('applies the fields the user changed and adopts everything else from the partner', () => {
    const origin = [line({ key: 'b1', qty: 100 }), line({ key: 'b2', qty: 50 })]
    const userDraft = [{ ...origin[0], qty: 80 }, { ...origin[1], expiry: '2026-12-05' }]
    const fresh = {
      lines: [line({ key: 'b1', qty: 90 }), line({ key: 'b2', qty: 40 }), line({ key: 'b3', ingredientId: 'i2', qty: 5 })],
      shown: ['i1', 'i2'],
    }

    const result = rebaseDraft(origin, userDraft, fresh)

    expect(result.lines).toEqual([
      line({ key: 'b1', qty: 80 }),
      line({ key: 'b2', qty: 40, expiry: '2026-12-05' }),
      line({ key: 'b3', ingredientId: 'i2', qty: 5 }),
    ])
    expect(result.origin).toBe(fresh.lines)
    expect(result.shown).toEqual(['i1', 'i2'])
    expect(result.dropped).toEqual([])
  })

  it('keeps a batch the user added and shows its ingredient', () => {
    const origin = [line({ key: 'b1' })]
    const userDraft = [...origin, line({ key: 'new-0', batchId: null, ingredientId: 'i3', qty: 2 })]
    const fresh = { lines: origin, shown: ['i1'] }

    const result = rebaseDraft(origin, userDraft, fresh)

    expect(result.lines).toContainEqual(line({ key: 'new-0', batchId: null, ingredientId: 'i3', qty: 2 }))
    expect(result.shown).toEqual(['i1', 'i3'])
  })

  it('drops an edit to a vanished batch instead of resurrecting it', () => {
    const origin = [line({ key: 'b1' }), line({ key: 'b2', qty: 50 })]
    const userDraft = [{ ...origin[0], removed: 'finished' as const }, { ...origin[1], qty: 0 }]
    const fresh = { lines: [line({ key: 'b2', qty: 60 })], shown: ['i1'] }

    const result = rebaseDraft(origin, userDraft, fresh)

    expect(result.lines).toEqual([line({ key: 'b2', qty: 0 })])
    expect(result.dropped).toEqual([{ batchId: 'b1', ingredientId: 'i1', changes: ['removal'] }])
    expect(droppedEditCount(result.dropped)).toBe(1)
  })

  it('counts each dropped field and lists them for the banner', () => {
    const origin = [line({ key: 'b1' })]
    const userDraft = [{ ...origin[0], qty: 80, expiry: '2026-12-05' }]
    const fresh = { lines: [], shown: [] }

    const result = rebaseDraft(origin, userDraft, fresh)

    expect(result.dropped).toEqual([{ batchId: 'b1', ingredientId: 'i1', changes: ['amount', 'expiry'] }])
    expect(droppedEditCount(result.dropped)).toBe(2)
  })

  it('leaves diffEdits with only the user edits, not the partner-only changes', () => {
    const origin = [line({ key: 'b1', qty: 100 }), line({ key: 'b2', qty: 50 })]
    const userDraft = [{ ...origin[0], qty: 80 }, { ...origin[1], expiry: '2026-12-05' }]
    const fresh = {
      lines: [line({ key: 'b1', qty: 90 }), line({ key: 'b2', qty: 40 }), line({ key: 'b3', ingredientId: 'i2', qty: 5 })],
      shown: ['i1', 'i2'],
    }

    const result = rebaseDraft(origin, userDraft, fresh)
    const edits = diffEdits(result.origin, result.lines)

    expect(edits.adjustments).toEqual([{ batch_id: 'b1', ingredient_id: 'i1', kind: 'set', qty: 80 }])
    expect(edits.expiries).toEqual([{ batch_id: 'b2', expires_on: '2026-12-05' }])
    expect(edits.newBatches).toEqual([])
  })
})

describe('onHandChanges', () => {
  it('writes only changed switches that still exist', () => {
    const changes = onHandChanges(
      { changed: true, same: false, vanished: true },
      [
        { id: 'changed', on_hand: false },
        { id: 'same', on_hand: false },
        { id: 'other', on_hand: true },
      ],
    )

    expect(changes).toEqual([{ id: 'changed', onHand: true }])
  })
})
