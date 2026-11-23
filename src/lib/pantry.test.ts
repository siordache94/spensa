import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {} }))
const { localDay } = await import('./pantry')

describe('localDay', () => {
  it('uses the household time zone, not UTC', () => {
    expect(localDay('2026-11-23T23:30:00Z', 'Europe/Rome')).toBe('2026-11-24')
    expect(localDay(new Date('2026-11-23T23:30:00Z'), 'UTC')).toBe('2026-11-23')
  })
})
