import { describe, expect, it } from 'vitest'
import { DISMISS_DAYS, isDismissed, isTime, keyToBytes, pushStatus, toInputTime, type PushEnv } from './pushState.ts'

const env = (o: Partial<PushEnv>): PushEnv => ({ ios: false, standalone: false, supported: true, permission: 'default', ...o })

describe('pushStatus', () => {
  it('asks iPhone users in Safari to install first, even though the Push API is missing there', () => {
    expect(pushStatus(env({ ios: true, supported: false }))).toBe('install-ios')
  })
  it('lets an installed iPhone app turn it on', () => {
    expect(pushStatus(env({ ios: true, standalone: true }))).toBe('available')
  })
  it('works in an Android browser tab or installed', () => {
    expect(pushStatus(env({}))).toBe('available')
    expect(pushStatus(env({ standalone: true }))).toBe('available')
  })
  it('reports blocked and unsupported', () => {
    expect(pushStatus(env({ permission: 'denied' }))).toBe('blocked')
    expect(pushStatus(env({ supported: false }))).toBe('unsupported')
  })
})

describe('isDismissed', () => {
  const day = 86_400_000
  it('hides for two weeks, then shows again', () => {
    expect(DISMISS_DAYS).toBe(14)
    expect(isDismissed(null, 1000)).toBe(false)
    expect(isDismissed(0, 13 * day)).toBe(true)
    expect(isDismissed(0, 14 * day)).toBe(false)
  })
  it('ignores a stamp from the future (clock changed)', () => {
    expect(isDismissed(10 * day, 0)).toBe(false)
  })
})

describe('keys and times', () => {
  it('decodes a base64url key', () => {
    expect([...keyToBytes('AQID')]).toEqual([1, 2, 3])
    expect([...keyToBytes('-_8')]).toEqual([251, 255])
  })
  it('formats and validates times', () => {
    expect(toInputTime('09:00:00')).toBe('09:00')
    expect(isTime('09:00')).toBe(true)
    expect(isTime('24:00')).toBe(false)
    expect(isTime('9:00')).toBe(false)
    expect(isTime('')).toBe(false)
  })
})
