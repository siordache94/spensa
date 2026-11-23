import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readJson, readRaw, removeKey, writeJson, writeRaw } from './storage.ts'

const isNumber = (v: unknown): v is number => typeof v === 'number'

/** A Map-backed stand-in for localStorage. `broken` makes every call throw, as blocked site data does. */
function fakeStorage(broken = false) {
  const m = new Map<string, string>()
  const guard = () => { if (broken) throw new Error('blocked') }
  return {
    m,
    getItem: (k: string) => { guard(); return m.get(k) ?? null },
    setItem: (k: string, v: string) => { guard(); m.set(k, String(v)) },
    removeItem: (k: string) => { guard(); m.delete(k) },
  }
}

describe('storage', () => {
  let store: ReturnType<typeof fakeStorage>
  beforeEach(() => {
    store = fakeStorage()
    vi.stubGlobal('localStorage', store)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('readJson returns the fallback when nothing is stored', () => {
    expect(readJson('k', isNumber, 7)).toBe(7)
  })

  it('readJson returns the parsed value when it passes the validator', () => {
    store.m.set('k', '42')
    expect(readJson('k', isNumber, 7)).toBe(42)
  })

  it('readJson falls back on text that is not JSON', () => {
    store.m.set('k', 'not json')
    expect(readJson('k', isNumber, 7)).toBe(7)
  })

  it('readJson falls back on a value of the wrong shape', () => {
    store.m.set('k', '"forty-two"')
    expect(readJson('k', isNumber, 7)).toBe(7)
  })

  it('readJson falls back when storage itself throws', () => {
    vi.stubGlobal('localStorage', fakeStorage(true))
    expect(readJson('k', isNumber, 7)).toBe(7)
  })

  it('writeJson stores the value as JSON text, so readJson gets it back', () => {
    writeJson('k', { a: [1, 'two'] })
    expect(store.m.get('k')).toBe('{"a":[1,"two"]}')
    expect(readJson('k', (v): v is { a: unknown[] } => typeof v === 'object' && v !== null, { a: [] })).toEqual({ a: [1, 'two'] })
  })

  it('writeJson does not throw when storage refuses the write', () => {
    vi.stubGlobal('localStorage', fakeStorage(true))
    expect(() => writeJson('k', 1)).not.toThrow()
  })

  it('removeKey removes the key, and does not throw when storage is blocked', () => {
    store.m.set('k', '1')
    removeKey('k')
    expect(store.m.has('k')).toBe(false)
    vi.stubGlobal('localStorage', fakeStorage(true))
    expect(() => removeKey('k')).not.toThrow()
  })

  it('readRaw and writeRaw pass strings through unchanged', () => {
    writeRaw('k', '{"not":"parsed"}')
    expect(readRaw('k')).toBe('{"not":"parsed"}')
    vi.stubGlobal('localStorage', fakeStorage(true))
    expect(readRaw('k')).toBeNull()
  })
})
