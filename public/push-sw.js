// Web push handlers, pulled into the generated service worker by vite-plugin-pwa (workbox.importScripts in
// vite.config.ts). The caching code stays generated; this file only adds `push` and `notificationclick`.
// Payload (supabase/functions/_shared, src/lib/notify.ts): { title, body, kind: 'list' | 'expiry' | 'test', url }.

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { body: event.data ? event.data.text() : '' } }
  const kind = data.kind || 'list'
  event.waitUntil(
    self.registration.showNotification(data.title || 'Spensa', {
      body: data.body || '',
      icon: '/icon-192.png',
      // one slot per kind: a newer list-change push replaces the old one instead of stacking
      tag: kind,
      renotify: true,
      data: { url: data.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
      const open = windows.find((w) => w.url.startsWith(self.location.origin))
      if (open) {
        await open.focus()
        // an installed app may refuse to navigate; then it stays where it is
        if ('navigate' in open) return open.navigate(target).catch(() => undefined)
        return undefined
      }
      return self.clients.openWindow(target)
    }),
  )
})
