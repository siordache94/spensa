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

describe('push-sw.js check-ins', () => {
  const payload = { title: 'Spensa', body: 'Dinner: Pasta. Cooked as planned?', kind: 'checkin', url: '/?meal=m1', silent: true, tag: 'checkin-m1', mealId: 'm1', unread: 3,
    actions: [{ action: 'planned', title: 'Cooked as planned' }, { action: 'changed', title: 'Changed it' }], answer: { url: 'https://fn.test/checkin-answer', token: 'tok' } }
  function loadWith(extra: object, windows: Parameters<typeof load>[0] = []) {
    const l = load(windows)
    Object.assign(l.self, extra)
    return l
  }

  it('shows a silent notification with actions and sets the badge, without vibrate or renotify', async () => {
    const setAppBadge = vi.fn(() => Promise.resolve())
    const { handlers, shown } = loadWith({ navigator: { setAppBadge, clearAppBadge: vi.fn() } })
    const e = waitable({ data: { json: () => payload } })
    handlers.push(e)
    await e.done()
    expect(shown[0].options).toMatchObject({ silent: true, renotify: false, tag: 'checkin-m1', actions: payload.actions, data: { url: '/?meal=m1', mealId: 'm1' } })
    expect(shown[0].options).not.toHaveProperty('vibrate')
    expect(setAppBadge).toHaveBeenCalledWith(3)
  })
  it('works where the badge API does not exist', async () => {
    const { handlers, shown } = loadWith({ navigator: {} })
    const e = waitable({ data: { json: () => payload } })
    handlers.push(e)
    await e.done()
    expect(shown).toHaveLength(1)
  })
  it('"Cooked as planned" posts the token without opening the app, then updates the badge', async () => {
    const setAppBadge = vi.fn(() => Promise.resolve())
    const clearAppBadge = vi.fn(() => Promise.resolve())
    const fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ unread: 0 }) }))
    const { handlers, self } = loadWith({ fetch, navigator: { setAppBadge, clearAppBadge } })
    const e = waitable({ action: 'planned', notification: { close: vi.fn(), data: { url: '/?meal=m1', mealId: 'm1', answer: payload.answer } } })
    handlers.notificationclick(e)
    await e.done()
    expect(fetch).toHaveBeenCalledWith('https://fn.test/checkin-answer', expect.objectContaining({ method: 'POST', body: JSON.stringify({ meal_id: 'm1', token: 'tok' }) }))
    expect(self.clients.openWindow).not.toHaveBeenCalled()
    expect(clearAppBadge).toHaveBeenCalled()
  })
  it('falls back to opening the meal with ?checkin=planned when the call fails', async () => {
    const fetch = vi.fn(() => Promise.resolve({ ok: false, status: 401 }))
    const { handlers, self } = loadWith({ fetch, navigator: {} })
    const e = waitable({ action: 'planned', notification: { close: vi.fn(), data: { url: '/?meal=m1', mealId: 'm1', answer: payload.answer } } })
    handlers.notificationclick(e)
    await e.done()
    expect(self.clients.openWindow).toHaveBeenCalledWith('https://spensa.test/?meal=m1&checkin=planned')
  })
  it('falls back too when offline (fetch throws) or when there is no token', async () => {
    const a = loadWith({ fetch: vi.fn(() => Promise.reject(new Error('offline'))), navigator: {} })
    const e1 = waitable({ action: 'planned', notification: { close: vi.fn(), data: { url: '/?meal=m1', mealId: 'm1', answer: payload.answer } } })
    a.handlers.notificationclick(e1)
    await e1.done()
    expect(a.self.clients.openWindow).toHaveBeenCalledWith('https://spensa.test/?meal=m1&checkin=planned')
    const b = loadWith({ navigator: {} })
    const e2 = waitable({ action: 'planned', notification: { close: vi.fn(), data: { url: '/?meal=m1', mealId: 'm1' } } })
    b.handlers.notificationclick(e2)
    await e2.done()
    expect(b.self.clients.openWindow).toHaveBeenCalledWith('https://spensa.test/?meal=m1&checkin=planned')
  })
  it('"Changed it" opens the meal with ?checkin=changed; a plain tap opens the meal', async () => {
    const a = loadWith({ navigator: {} })
    const e1 = waitable({ action: 'changed', notification: { close: vi.fn(), data: { url: '/?meal=m1', mealId: 'm1' } } })
    a.handlers.notificationclick(e1)
    await e1.done()
    expect(a.self.clients.openWindow).toHaveBeenCalledWith('https://spensa.test/?meal=m1&checkin=changed')
    const b = loadWith({ navigator: {} })
    const e2 = waitable({ action: '', notification: { close: vi.fn(), data: { url: '/?meal=m1', mealId: 'm1' } } })
    b.handlers.notificationclick(e2)
    await e2.done()
    expect(b.self.clients.openWindow).toHaveBeenCalledWith('https://spensa.test/?meal=m1')
  })
})
