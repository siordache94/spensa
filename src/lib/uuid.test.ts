import { expect, test } from 'vitest'
import { uuid } from './uuid.ts'

test('falls back to a valid v4 uuid without crypto.randomUUID (insecure context)', () => {
  const original = crypto.randomUUID
  Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true })
  try {
    expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  } finally {
    Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true })
  }
})
