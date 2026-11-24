import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readTrust, recordTrust } from './deviceTrust.ts'
import { clearLocalData, registerPersistedCopyRemover } from './localData.ts'

/** A Map-backed stand-in for localStorage. */
function fakeStorage() {
  const m = new Map<string, string>()
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
  }
}

describe('clearLocalData', () => {
  let store: ReturnType<typeof fakeStorage>
  beforeEach(() => {
    store = fakeStorage()
    vi.stubGlobal('localStorage', store)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('clears the trust record, the query cache, the saved copy and the partner-ack list', () => {
    const clear = vi.fn()
    const removeSavedCopy = vi.fn()
    registerPersistedCopyRemover(removeSavedCopy)
    recordTrust({ userId: 'u1', metadata: {} }, 1_000)
    store.m.set('spensa.shop.acked', '["batch-1"]')

    clearLocalData({ clear })

    expect(readTrust()).toBeNull()
    expect(removeSavedCopy).toHaveBeenCalledOnce()
    expect(clear).toHaveBeenCalledOnce()
    expect(store.m.get('spensa.shop.acked')).toBe('[]')
  })

  it('keeps device preferences', () => {
    store.m.set('spensa.settings', '{"theme":"light","density":"airy"}')
    store.m.set('spensa.prompt.install.dismissed', '1')

    clearLocalData({ clear: vi.fn() })

    expect(store.m.get('spensa.settings')).toBe('{"theme":"light","density":"airy"}')
    expect(store.m.get('spensa.prompt.install.dismissed')).toBe('1')
  })
})
