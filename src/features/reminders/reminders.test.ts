import { describe, expect, it, vi } from 'vitest'
import { db } from '../../db/db'
import { getKV, insert, setKV } from '../../db/repo'
import type { Appointment } from '../../db/types'
import { addDays, parseISODate, todayISO } from '../../lib/format'
import { createPatient, deletePatient } from '../patients/patientRepo'
import { saveVisit, followUpsDue } from '../visits/visitRepo'
import { createBill, duesByPatient } from '../billing/billingRepo'
import { createStockItem, lowStockItems } from '../stock/stockRepo'
import { seedRemedies, seedRemedyId } from '../remedies/remedyRepo'
import { pruneNotifiedKeys, reminderCounts, runReminderCheck, type ReminderNotification } from './reminderCheck'
import { DEFAULT_PREFS, inQuietHours, notifiedKey, PREFS_KEY, reminderText, withDefaults, type NotifyPrefs } from './reminderLogic'

const today = todayISO()
const now = new Date(parseISODate(today).getTime() + 10 * 3600_000) // 10:00 today

async function fixture() {
  await seedRemedies()
  const a = await createPatient({ name: 'Asha' })
  const b = await createPatient({ name: 'Bala' })
  const gone = await createPatient({ name: 'Gone' })
  const start = parseISODate(today).getTime()
  const appt = (patientId: string, h: number, status: Appointment['status']) =>
    insert<Appointment>(db.appointments, { patientId, start: start + h * 3600_000, end: start + h * 3600_000 + 900_000, status })
  await appt(a.id, 11, 'booked')
  await appt(b.id, 12, 'booked')
  await appt(b.id, 9, 'arrived') // already here
  await appt(gone.id, 13, 'booked')
  await insert<Appointment>(db.appointments, { patientId: a.id, start: start + 86_400_000 + 3600_000, end: start + 86_400_000 + 4500_000, status: 'booked' }) // tomorrow
  // Follow-ups: A due today; B came back since.
  await saveVisit({ patientId: a.id, date: addDays(today, -7), caseNotes: {}, followUpDate: today, items: [] })
  await saveVisit({ patientId: b.id, date: addDays(today, -14), caseNotes: {}, followUpDate: addDays(today, -7), items: [] })
  await saveVisit({ patientId: b.id, date: addDays(today, -6), caseNotes: {}, items: [] })
  await saveVisit({ patientId: gone.id, date: addDays(today, -6), caseNotes: {}, followUpDate: today, items: [] })
  // Dues: A overdue (two bills, one patient), B due today (not overdue).
  for (const d of [-40, -10]) await createBill({ patientId: a.id, date: addDays(today, d - 5), items: [{ desc: 'Consultation', amount: 100 }], discount: 0, dueDate: addDays(today, d) })
  await createBill({ patientId: b.id, date: addDays(today, -5), items: [{ desc: 'Consultation', amount: 100 }], discount: 0, dueDate: today })
  await createBill({ patientId: gone.id, date: addDays(today, -50), items: [{ desc: 'Consultation', amount: 100 }], discount: 0, dueDate: addDays(today, -40) })
  // Stock: one low, one fine.
  await createStockItem({ remedyId: seedRemedyId('Sulphur'), potency: '30C', form: 'dilution', unit: 'ml', lowStockAt: 10, price: 1, openingQty: 5 })
  await createStockItem({ remedyId: seedRemedyId('Sulphur'), potency: '200C', form: 'dilution', unit: 'ml', lowStockAt: 10, price: 1, openingQty: 50 })
  await deletePatient(gone.id)
}

const enable = (p: Partial<NotifyPrefs> = {}) => setKV(PREFS_KEY, { ...DEFAULT_PREFS, enabled: true, ...p })

describe('reminder counts', () => {
  it('matches the app queries for each kind', async () => {
    await fixture()
    const c = await reminderCounts(db, now)
    expect(c).toEqual({ appointments: 2, followups: 1, dues: 1, lowStock: 1 })
    expect(c.followups).toBe((await followUpsDue(today)).length)
    expect(c.dues).toBe((await duesByPatient(today)).filter((r) => r.daysOverdue > 0).length)
    expect(c.lowStock).toBe((await lowStockItems()).length)
  })

  it('texts', () => {
    expect(reminderText('appointments', 1)).toBe('1 appointment today not yet arrived')
    expect(reminderText('dues', 3)).toBe('3 patients with overdue dues')
  })
})

describe('quiet hours', () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 20, h, m)
  it('handles same-day and overnight windows', () => {
    expect(inQuietHours({ quietStart: '', quietEnd: '' }, at(3))).toBe(false)
    expect(inQuietHours({ quietStart: '13:00', quietEnd: '14:00' }, at(13, 30))).toBe(true)
    expect(inQuietHours({ quietStart: '13:00', quietEnd: '14:00' }, at(14))).toBe(false)
    expect(inQuietHours({ quietStart: '21:00', quietEnd: '08:00' }, at(23))).toBe(true)
    expect(inQuietHours({ quietStart: '21:00', quietEnd: '08:00' }, at(7, 59))).toBe(true)
    expect(inQuietHours({ quietStart: '21:00', quietEnd: '08:00' }, at(8))).toBe(false)
  })
  it('fills missing prefs with defaults', () => {
    expect(withDefaults({ enabled: true, types: { dues: false } as NotifyPrefs['types'] }).types).toEqual({ appointments: true, followups: true, dues: false, lowStock: true })
  })
})

describe('runReminderCheck', () => {
  it('does nothing while disabled', async () => {
    await fixture()
    const show = vi.fn()
    expect(await runReminderCheck(db, show, now)).toEqual([])
    expect(show).not.toHaveBeenCalled()
  })

  it('shows one summary per enabled type per day, deduped in kv', async () => {
    await fixture()
    await enable({ types: { ...DEFAULT_PREFS.types, lowStock: false } })
    const shown: ReminderNotification[] = []
    const show = async (n: ReminderNotification) => {
      shown.push(n)
    }
    expect(await runReminderCheck(db, show, now)).toEqual(['appointments', 'followups', 'dues'])
    expect(shown.map((n) => [n.title, n.url, n.tag])).toEqual([
      ['Appointments today', '/calendar', 'reminder-appointments'],
      ['Follow-ups due', '/#followups', 'reminder-followups'],
      ['Overdue dues', '/billing/dues', 'reminder-dues'],
    ])
    expect(shown[0].body).toBe('2 appointments today not yet arrived')
    expect(await getKV(notifiedKey('dues', today))).toBe(now.getTime())

    // Same day: nothing again, even an hour later.
    expect(await runReminderCheck(db, show, new Date(now.getTime() + 3600_000))).toEqual([])
    expect(shown).toHaveLength(3)

    // Next day: fires again.
    expect(await runReminderCheck(db, show, new Date(now.getTime() + 86_400_000))).toContain('dues')
  })

  it('skips quiet hours without using up the day', async () => {
    await fixture()
    await enable({ quietStart: '09:00', quietEnd: '11:00' })
    const show = vi.fn(async () => {})
    expect(await runReminderCheck(db, show, now)).toEqual([])
    expect(await runReminderCheck(db, show, new Date(now.getTime() + 2 * 3600_000))).toHaveLength(4)
  })

  it('releases the dedupe key when showing fails', async () => {
    await fixture()
    await enable()
    const fail = vi.fn(async () => {
      throw new Error('blocked')
    })
    expect(await runReminderCheck(db, fail, now)).toEqual([])
    expect(await getKV(notifiedKey('dues', today))).toBeUndefined()
  })

  it('prunes old dedupe keys, which never sync', async () => {
    await setKV(notifiedKey('dues', '2026-01-01'), 1)
    await setKV(notifiedKey('dues', today), 1)
    await pruneNotifiedKeys(db, today)
    expect(await getKV(notifiedKey('dues', '2026-01-01'))).toBeUndefined()
    expect(await getKV(notifiedKey('dues', today))).toBe(1)
    const { SYNCED_KV_KEYS } = await import('../../sync/tracking')
    expect(SYNCED_KV_KEYS).not.toContain(PREFS_KEY)
  })
})
