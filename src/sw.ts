/// <reference lib="webworker" />
import Dexie from 'dexie'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { runReminderCheck } from './features/reminders/reminderCheck'
import { PERIODIC_TAG } from './features/reminders/reminderLogic'

declare const self: ServiceWorkerGlobalScope

// Same behaviour as the old generateSW build: precache the app shell and
// lazy chunks (incl. the pdf.js worker/wasm) and serve index.html for
// navigations. No skipWaiting/clientsClaim: the app's update prompt decides.
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)
registerRoute(new NavigationRoute(createHandlerBoundToURL(`${import.meta.env.BASE_URL}index.html`)))

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

// ---- reminders ----

// Opens the app's database schema-less (Dexie reads the existing schema), so
// the worker never declares or upgrades versions.
async function backgroundCheck() {
  if (Notification.permission !== 'granted') return
  if (!(await Dexie.exists('clinic-register'))) return
  const d = new Dexie('clinic-register')
  await d.open()
  try {
    await runReminderCheck(d, (n) =>
      self.registration.showNotification(n.title, { body: n.body, tag: n.tag, icon: `${import.meta.env.BASE_URL}icon-192.png`, badge: `${import.meta.env.BASE_URL}icon-192.png`, data: { url: n.url } }),
    )
  } finally {
    d.close()
  }
}

interface PeriodicSyncEvent extends ExtendableEvent {
  tag: string
}

self.addEventListener('periodicsync' as keyof ServiceWorkerGlobalScopeEventMap, (event) => {
  const e = event as PeriodicSyncEvent
  if (e.tag === PERIODIC_TAG) e.waitUntil(backgroundCheck().catch(() => {}))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url: string = event.notification.data?.url ?? '/'
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const client = windows.find((c) => c.focused) ?? windows[0]
      if (client) {
        await client.focus()
        client.postMessage({ type: 'navigate', url })
        return
      }
      // url is a router path ('/billing'); a new window needs the deploy base.
      await self.clients.openWindow(new URL(url.replace(/^\//, ''), self.registration.scope).href)
    })(),
  )
})
