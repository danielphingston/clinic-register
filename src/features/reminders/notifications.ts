import { db } from '../../db/db'
import { setKV } from '../../db/repo'
import { todayISO } from '../../lib/format'
import { pruneNotifiedKeys, readPrefs, runReminderCheck, type ReminderNotification } from './reminderCheck'
import { PERIODIC_TAG, PREFS_KEY, type NotifyPrefs, type ReminderType } from './reminderLogic'

export type NotifySupport = 'unsupported' | NotificationPermission

export function notificationSupport(): NotifySupport {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission
}

export const NAVIGATE_EVENT = 'reminder-navigate'

async function swRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  if (!('serviceWorker' in navigator)) return undefined
  try {
    return await navigator.serviceWorker.getRegistration()
  } catch {
    return undefined
  }
}

// Through the service worker when there is one (required on Android, and its
// notificationclick handler focuses the app); a page Notification otherwise.
export async function showReminder(n: ReminderNotification): Promise<void> {
  const options = { body: n.body, tag: n.tag, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: n.url } }
  const reg = await swRegistration()
  if (reg?.active) {
    await reg.showNotification(n.title, options)
    return
  }
  const note = new Notification(n.title, options)
  note.onclick = () => {
    window.focus()
    window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: n.url }))
    note.close()
  }
}

export async function checkReminders(now = new Date()): Promise<ReminderType[]> {
  if (notificationSupport() !== 'granted') return []
  await pruneNotifiedKeys(db, todayISO())
  return runReminderCheck(db, showReminder, now)
}

export function getNotifyPrefs(): Promise<NotifyPrefs> {
  return readPrefs(db)
}

export async function saveNotifyPrefs(p: NotifyPrefs): Promise<void> {
  await setKV(PREFS_KEY, p)
}

// ---- periodic background sync (installed PWA on Chrome/Android) ----

interface PeriodicSyncManager {
  register(tag: string, opts: { minInterval: number }): Promise<void>
  unregister(tag: string): Promise<void>
  getTags(): Promise<string[]>
}

type PeriodicState = 'unsupported' | 'denied' | 'registered' | 'off'

export async function setPeriodicSync(on: boolean): Promise<PeriodicState> {
  const reg = await swRegistration()
  const ps = (reg as (ServiceWorkerRegistration & { periodicSync?: PeriodicSyncManager }) | undefined)?.periodicSync
  if (!reg || !ps) return 'unsupported'
  try {
    if (!on) {
      await ps.unregister(PERIODIC_TAG)
      return 'off'
    }
    const perm = await navigator.permissions?.query({ name: 'periodic-background-sync' as PermissionName })
    if (perm && perm.state !== 'granted') return 'denied'
    await ps.register(PERIODIC_TAG, { minInterval: 12 * 60 * 60 * 1000 })
    return 'registered'
  } catch {
    return 'denied'
  }
}
