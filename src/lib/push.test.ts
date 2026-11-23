import { describe, expect, it, vi } from 'vitest'
import { askNotificationPermission, permissionRefusal } from './push.ts'

describe('askNotificationPermission', () => {
  it('calls the permission request synchronously, before any await', () => {
    const request = vi.fn(() => Promise.resolve<NotificationPermission>('granted'))
    const pending = askNotificationPermission(request)
    // Checked with no await in between: the tap handler must reach the request in the same turn.
    expect(request).toHaveBeenCalledTimes(1)
    return expect(pending).resolves.toBe('granted')
  })

  it('does not call the request again when it is awaited', async () => {
    const request = vi.fn(() => Promise.resolve<NotificationPermission>('denied'))
    await expect(askNotificationPermission(request)).resolves.toBe('denied')
    expect(request).toHaveBeenCalledTimes(1)
  })
})

describe('permissionRefusal', () => {
  it('is null when granted', () => {
    expect(permissionRefusal('granted')).toBeNull()
  })

  it('explains a block and a dismissed prompt differently', () => {
    expect(permissionRefusal('denied')?.message).toMatch(/blocked/)
    expect(permissionRefusal('default')?.message).toBe('Permission was not given.')
  })
})
