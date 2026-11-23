import { describe, expect, it, vi } from 'vitest'
import source from '../../public/push-sw.js?raw'

// public/push-sw.js runs in the service worker; here it gets a stand-in `self`.
function load(windows: { url: string; focus: () => Promise<void>; navigate?: (u: string) => Promise<unknown> }[]) {
  const handlers: Record<string, (e: unknown) => void> = {}
  const shown: { title: string; options: Record<string, unknown> }[] = []
  const self = {
    location: { origin: 'https://spensa.test' },
    addEventListener: (type: string, fn: (e: unknown) => void) => { handlers[type] = fn },
    registration: { showNotification: (title: string, options: Record<string, unknown>) => { shown.push({ title, options }); return Promise.resolve() } },
    clients: { matchAll: () => Promise.resolve(windows), openWindow: vi.fn(() => Promise.resolve()) },
  }
  new Function('self', source)(self)
  return { handlers, shown, self }
}
const waitable = (extra: object) => { const p: Promise<unknown>[] = []; return { ...extra, waitUntil: (x: Promise<unknown>) => p.push(x), done: () => Promise.all(p) } }

describe('push-sw.js', () => {
  it('shows the notification with the app icon and one tag per kind', async () => {
    const { handlers, shown } = load([])
    const e = waitable({ data: { json: () => ({ title: 'Spensa', body: 'Anna changed the list: 2 added', kind: 'list', url: '/shop' }) } })
    handlers.push(e)
    await e.done()
    expect(shown).toHaveLength(1)
    expect(shown[0].title).toBe('Spensa')
    expect(shown[0].options).toMatchObject({ body: 'Anna changed the list: 2 added', icon: '/icon-192.png', tag: 'list', renotify: true, data: { url: '/shop' } })
  })
  it('still shows something for an empty or broken payload (iOS requires a visible notification)', async () => {
    const { handlers, shown } = load([])
    const e = waitable({ data: { json: () => { throw new Error('bad') }, text: () => 'hello' } })
    handlers.push(e)
    await e.done()
    expect(shown[0].title).toBe('Spensa')
    expect(shown[0].options.body).toBe('hello')
  })
  it('click focuses an open app window and sends it to the right tab', async () => {
    const win = { url: 'https://spensa.test/', focus: vi.fn(() => Promise.resolve()), navigate: vi.fn(() => Promise.resolve()) }
    const { handlers } = load([win])
    const e = waitable({ notification: { close: vi.fn(), data: { url: '/pantry' } } })
    handlers.notificationclick(e)
    await e.done()
    expect(win.focus).toHaveBeenCalled()
    expect(win.navigate).toHaveBeenCalledWith('https://spensa.test/pantry')
  })
  it('click opens the app when it is closed', async () => {
    const { handlers, self } = load([])
    const e = waitable({ notification: { close: vi.fn(), data: { url: '/shop' } } })
    handlers.notificationclick(e)
    await e.done()
    expect(self.clients.openWindow).toHaveBeenCalledWith('https://spensa.test/shop')
  })
})
