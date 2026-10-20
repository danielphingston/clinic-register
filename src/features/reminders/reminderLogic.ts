// Pure reminder rules shared by the app and the service worker (no DOM, no db).

export type ReminderType = 'appointments' | 'followups' | 'dues' | 'lowStock'

export const REMINDER_TYPES: ReminderType[] = ['appointments', 'followups', 'dues', 'lowStock']

export const REMINDER_LABEL: Record<ReminderType, string> = {
  appointments: 'Appointments today',
  followups: 'Follow-ups due',
  dues: 'Overdue dues',
  lowStock: 'Low stock',
}

export const REMINDER_URL: Record<ReminderType, string> = {
  appointments: '/calendar',
  followups: '/#followups',
  dues: '/billing/dues',
  lowStock: '/stock?filter=low',
}

export type ReminderCounts = Record<ReminderType, number>

interface Live {
  id: string
  deleted: 0 | 1
}

export interface ReminderData {
  patients: Live[]
  appointments: (Live & { patientId: string; start: number; status: string })[]
  visits: (Live & { patientId: string; date: string; createdAt: number; followUpDate?: string })[]
  bills: (Live & { patientId: string; balance: number; date: string; dueDate?: string })[]
  stockItems: (Live & { qty: number; lowStockAt: number })[]
}

// - appointments: booked (not yet arrived) and starting today
// - followups: the patient's latest visit asks for a follow-up on or before today
// - dues: patients with a bill past its due date (same rule as billing's isOverdue)
// - lowStock: items at or below their low-stock level
export function countReminders(data: ReminderData, today: string, dayStart: number, dayEnd: number): ReminderCounts {
  const live = new Set(data.patients.filter((p) => p.deleted === 0).map((p) => p.id))
  const appointments = data.appointments.filter(
    (a) => a.deleted === 0 && a.status === 'booked' && a.start >= dayStart && a.start < dayEnd && live.has(a.patientId),
  ).length

  const latest = new Map<string, ReminderData['visits'][number]>()
  for (const v of data.visits) {
    if (v.deleted || !live.has(v.patientId)) continue
    const cur = latest.get(v.patientId)
    if (!cur || v.date > cur.date || (v.date === cur.date && v.createdAt > cur.createdAt)) latest.set(v.patientId, v)
  }
  const followups = [...latest.values()].filter((v) => v.followUpDate && v.followUpDate <= today).length

  const overdue = new Set(
    data.bills.filter((b) => b.deleted === 0 && b.balance > 0 && (b.dueDate ?? b.date) < today && live.has(b.patientId)).map((b) => b.patientId),
  )
  const lowStock = data.stockItems.filter((s) => s.deleted === 0 && s.qty <= s.lowStockAt).length
  return { appointments, followups, dues: overdue.size, lowStock }
}

export function totalReminders(c: ReminderCounts): number {
  return REMINDER_TYPES.reduce((s, t) => s + c[t], 0)
}

export function reminderText(type: ReminderType, n: number): string {
  const s = n === 1 ? '' : 's'
  switch (type) {
    case 'appointments':
      return `${n} appointment${s} today not yet arrived`
    case 'followups':
      return `${n} patient${s} due for follow-up`
    case 'dues':
      return `${n} patient${s} with overdue dues`
    case 'lowStock':
      return `${n} stock item${s} low or out`
  }
}

// ---- notification preferences (per device, kv; never synced) ----

export const PREFS_KEY = 'notify:prefs'

export interface NotifyPrefs {
  enabled: boolean
  types: Record<ReminderType, boolean>
  quietStart: string // "HH:MM", or '' for no quiet hours
  quietEnd: string
}

export const DEFAULT_PREFS: NotifyPrefs = {
  enabled: false,
  types: { appointments: true, followups: true, dues: true, lowStock: true },
  quietStart: '',
  quietEnd: '',
}

export function withDefaults(p: Partial<NotifyPrefs> | undefined): NotifyPrefs {
  return { ...DEFAULT_PREFS, ...p, types: { ...DEFAULT_PREFS.types, ...p?.types } }
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

// Quiet hours may wrap past midnight (e.g. 21:00–08:00).
export function inQuietHours(p: Pick<NotifyPrefs, 'quietStart' | 'quietEnd'>, now: Date): boolean {
  if (!p.quietStart || !p.quietEnd || p.quietStart === p.quietEnd) return false
  const t = now.getHours() * 60 + now.getMinutes()
  const s = minutes(p.quietStart)
  const e = minutes(p.quietEnd)
  return s < e ? t >= s && t < e : t >= s || t < e
}

// One summary notification per type per local day.
export const notifiedKey = (type: ReminderType, date: string) => `notified:${type}:${date}`

export const PERIODIC_TAG = 'daily-reminders'
