// Push notifications from Margin's server on your PC. Loaded into the app's service worker.
self.addEventListener('push', event => {
  let d = {}
  try { d = event.data ? event.data.json() : {} } catch { d = { body: event.data && event.data.text() } }
  event.waitUntil(self.registration.showNotification(d.title || 'YHWH', {
    body: d.body || '', tag: d.tag || 'margin', icon: '/icon-192.png', badge: '/icon-192.png',
    data: { url: d.url || '/#/today' },
  }))
})
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = new URL(event.notification.data && event.notification.data.url || '/#/today', self.location.origin).href
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) {
        await w.focus()
        try { await w.navigate(url) } catch { w.postMessage({ type: 'open', url }) }
        return
      }
    }
    await self.clients.openWindow(url)
  })())
})
