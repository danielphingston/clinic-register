import type Dexie from 'dexie'
import { addDays, parseISODate, toISODate } from '../../lib/format'
import {
  countReminders,
  inQuietHours,
  notifiedKey,
  PREFS_KEY,
  REMINDER_LABEL,
  REMINDER_TYPES,
  REMINDER_URL,
  reminderText,
  withDefaults,
  type NotifyPrefs,
  type ReminderCounts,
  type ReminderData,
  type ReminderType,
} from './reminderLogic'

// Works on any Dexie handle to the clinic database: the app's typed db, or the
// service worker's schema-less one (tables are looked up by name).

export async function loadReminderData(d: Dexie, today: string): Promise<ReminderData> {
  const start = parseISODate(today).getTime()
  const end = parseISODate(addDays(today, 1)).getTime()
  const candidates = await d.table('visits').where('followUpDate').belowOrEqual(today).toArray()
  const pids = [...new Set(candidates.map((v: { patientId: string }) => v.patientId))]
  const [appointments, visits, bills, stockItems] = await Promise.all([
    d.table('appointments').where('start').between(start, end, true, false).toArray(),
    pids.length ? d.table('visits').where('patientId').anyOf(pids).toArray() : Promise.resolve([]),
    d.table('bills').where('balance').above(0).toArray(),
    d.table('stockItems').where('deleted').equals(0).toArray(),
  ])
  const patientIds = new Set<string>([...pids, ...appointments.map((a) => a.patientId), ...bills.map((b) => b.patientId)])
  const patients = (await d.table('patients').bulkGet([...patientIds])).filter(Boolean)
  return { patients, appointments, visits, bills, stockItems }
}

export async function reminderCounts(d: Dexie, now = new Date()): Promise<ReminderCounts> {
  const today = toISODate(now)
  const start = parseISODate(today).getTime()
  return countReminders(await loadReminderData(d, today), today, start, parseISODate(addDays(today, 1)).getTime())
}

export async function readPrefs(d: Dexie): Promise<NotifyPrefs> {
  return withDefaults((await d.table('kv').get(PREFS_KEY))?.value)
}

export interface ReminderNotification {
  type: ReminderType
  title: string
  body: string
  tag: string
  url: string
}

export type ShowFn = (n: ReminderNotification) => Promise<void>

// Shows at most one summary per enabled type per day. The dedupe key is
// claimed before showing, so the app and the service worker can't both fire.
export async function runReminderCheck(d: Dexie, show: ShowFn, now = new Date()): Promise<ReminderType[]> {
  const prefs = await readPrefs(d)
  if (!prefs.enabled || inQuietHours(prefs, now)) return []
  const counts = await reminderCounts(d, now)
  const today = toISODate(now)
  const kv = d.table('kv')
  const shown: ReminderType[] = []
  for (const type of REMINDER_TYPES) {
    if (!prefs.types[type] || counts[type] === 0) continue
    const key = notifiedKey(type, today)
    const claimed = await d.transaction('rw', kv, async () => {
      if (await kv.get(key)) return false
      await kv.put({ key, value: now.getTime(), updatedAt: Date.now() })
      return true
    })
    if (!claimed) continue
    try {
      await show({ type, title: REMINDER_LABEL[type], body: reminderText(type, counts[type]), tag: `reminder-${type}`, url: REMINDER_URL[type] })
      shown.push(type)
    } catch {
      await kv.delete(key)
    }
  }
  return shown
}

// Old dedupe keys are useless after their day.
export async function pruneNotifiedKeys(d: Dexie, today: string): Promise<void> {
  const keys = (await d.table('kv').where('key').startsWith('notified:').primaryKeys()) as string[]
  const stale = keys.filter((k) => k.slice(-10) < today)
  if (stale.length) await d.table('kv').bulkDelete(stale)
}
