import { describe, expect, it } from 'vitest'
import { finishBlock, isOnline } from './useOnline.ts'

describe('isOnline', () => {
  it('treats a missing navigator as online (SSR and tests)', () => {
    expect(isOnline(undefined)).toBe(true)
    expect(isOnline({})).toBe(true)
  })

  it('reads navigator.onLine and only an explicit false means offline', () => {
    expect(isOnline({ onLine: true })).toBe(true)
    expect(isOnline({ onLine: false })).toBe(false)
  })
})

describe('finishBlock', () => {
  it('blocks an offline finish even when nothing is queued', () => {
    expect(finishBlock({ online: false, waiting: 0 })).toBe('offline')
  })

  it('offline wins over queued writes: the reason shown is the connection', () => {
    expect(finishBlock({ online: false, waiting: 3 })).toBe('offline')
  })

  it('waits for queued ticks before the snapshot (MR-004)', () => {
    expect(finishBlock({ online: true, waiting: 1 })).toBe('waiting')
  })

  it('allows the finish when online with nothing queued', () => {
    expect(finishBlock({ online: true, waiting: 0 })).toBeNull()
  })
})
