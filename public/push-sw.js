// Web push handlers, pulled into the generated service worker by vite-plugin-pwa (workbox.importScripts in
// vite.config.ts). The caching code stays generated; this file only adds `push` and `notificationclick`.
// Payload (supabase/functions/_shared, src/lib/notify.ts):
//   { title, body, kind: 'list' | 'expiry' | 'test' | 'checkin', url, silent?, actions?, tag?, mealId?, unread?, answer?: { url, token } }
// Check-in pushes (ADR 0005): silent, two buttons (Android; iOS ignores both), badge = unread check-ins.

function setBadge(count) {
  const nav = self.navigator
  if (!nav || typeof count !== 'number') return Promise.resolve()
  try {
    if (count > 0 && nav.setAppBadge) return Promise.resolve(nav.setAppBadge(count)).catch(() => undefined)
    if (count <= 0 && nav.clearAppBadge) return Promise.resolve(nav.clearAppBadge()).catch(() => undefined)
  } catch { /* the badge is a nicety */ }
  return Promise.resolve()
}

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { body: event.data ? event.data.text() : '' } }
  const kind = data.kind || 'list'
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    // one slot per kind: a newer list-change push replaces the old one instead of stacking
    tag: data.tag || kind,
    renotify: !data.silent,
    data: { url: data.url || '/', mealId: data.mealId || null, answer: data.answer || null },
  }
  // silent + vibrate is a TypeError, so a silent notification sets neither
  if (data.silent) options.silent = true
  if (Array.isArray(data.actions) && data.actions.length) options.actions = data.actions.slice(0, 2)
  event.waitUntil(Promise.all([self.registration.showNotification(data.title || 'Spensa', options), setBadge(data.unread)]))
})

function open(target) {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
    const win = windows.find((w) => w.url.startsWith(self.location.origin))
    if (win) {
      await win.focus()
      // an installed app may refuse to navigate; then it stays where it is
      if ('navigate' in win) return win.navigate(target).catch(() => undefined)
      return undefined
    }
    return self.clients.openWindow(target)
  })
}

const withAnswer = (url, answer) => {
  const u = new URL(url, self.location.origin)
  u.searchParams.set('checkin', answer)
  return u.href
}

// "Cooked as planned": answered here with the signed token from the payload, no session and no window needed.
// If that fails (offline, token expired, already gone) the app opens on the meal with ?checkin=planned and answers there.
function answerPlanned(data, target) {
  const a = data.answer
  if (!a || !a.url || !a.token || !data.mealId) return open(withAnswer(target, 'planned'))
  return self.fetch(a.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meal_id: data.mealId, token: a.token }),
  })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
    .then((body) => setBadge(typeof body.unread === 'number' ? body.unread : undefined))
    .catch(() => open(withAnswer(target, 'planned')))
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  const target = new URL(data.url || '/', self.location.origin).href
  if (event.action === 'planned') return event.waitUntil(answerPlanned(data, target))
  if (event.action === 'changed') return event.waitUntil(open(withAnswer(target, 'changed')))
  event.waitUntil(open(target))
})
