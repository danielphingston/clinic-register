import { db } from '../../db/db'
import { insert, nextSequence, update } from '../../db/repo'
import type { Appointment, AppointmentStatus, Patient } from '../../db/types'
import { addDays, parseISODate, toISODate, todayISO } from '../../lib/format'

export type AppointmentWithPatient = Appointment & { patient: Patient }

export const ACTIVE_STATUSES: AppointmentStatus[] = ['booked', 'arrived']

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  booked: 'Booked',
  arrived: 'Arrived',
  done: 'Done',
  'no-show': 'No-show',
  cancelled: 'Cancelled',
}

// no-show → arrived covers a patient who turns up late.
const TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  booked: ['arrived', 'no-show', 'cancelled'],
  arrived: ['done', 'cancelled'],
  'no-show': ['arrived', 'cancelled'],
  done: [],
  cancelled: [],
}

export function allowedTransitions(status: AppointmentStatus): AppointmentStatus[] {
  return TRANSITIONS[status]
}

const MINUTE = 60_000
// Upper bound on an appointment's length, so overlap checks can use the start index.
const MAX_SPAN = 24 * 60 * MINUTE

export class AppointmentError extends Error {}

function dayStart(iso: string): number {
  return parseISODate(iso).getTime()
}

function isActive(a: Appointment) {
  return a.deleted === 0 && ACTIVE_STATUSES.includes(a.status)
}

async function livePatient(id: string): Promise<Patient | undefined> {
  const p = await db.patients.get(id)
  return p && p.deleted === 0 ? p : undefined
}

// Active appointments of live patients that overlap [start, end).
export async function findOverlap(start: number, end: number, excludeId?: string): Promise<Appointment | undefined> {
  const candidates = await db.appointments
    .where('start')
    .between(start - MAX_SPAN, end, true, false)
    .filter((a) => isActive(a) && a.id !== excludeId && a.end > start)
    .toArray()
  for (const a of candidates) if (await livePatient(a.patientId)) return a
  return undefined
}

function checkTimes(start: number, end: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new AppointmentError('End must be after start')
  if (end - start > MAX_SPAN) throw new AppointmentError('Appointment is too long')
  if (start < dayStart(todayISO())) throw new AppointmentError('Cannot book a date in the past')
}

async function checkFree(start: number, end: number, excludeId?: string) {
  const clash = await findOverlap(start, end, excludeId)
  if (clash) {
    const who = (await db.patients.get(clash.patientId))?.name ?? 'another patient'
    throw new AppointmentError(`Overlaps with ${who}'s appointment`)
  }
}

export async function bookAppointment(
  patientId: string,
  start: number | Date,
  durationMin = 15,
  notes?: string,
): Promise<Appointment> {
  const s = +start
  const e = s + durationMin * MINUTE
  checkTimes(s, e)
  return db.transaction('rw', db.appointments, db.patients, async () => {
    if (!(await livePatient(patientId))) throw new AppointmentError('Patient not found')
    await checkFree(s, e)
    return insert<Appointment>(db.appointments, {
      patientId,
      start: s,
      end: e,
      status: 'booked',
      notes: notes?.trim() || undefined,
    })
  })
}

async function getLive(id: string): Promise<Appointment> {
  const a = await db.appointments.get(id)
  if (!a || a.deleted) throw new AppointmentError('Appointment not found')
  return a
}

export async function reschedule(id: string, start: number | Date, end: number | Date): Promise<void> {
  const s = +start
  const e = +end
  checkTimes(s, e)
  await db.transaction('rw', db.appointments, db.patients, async () => {
    const a = await getLive(id)
    if (a.status !== 'booked') throw new AppointmentError(`Cannot reschedule a ${STATUS_LABEL[a.status].toLowerCase()} appointment`)
    await checkFree(s, e, id)
    await update<Appointment>(db.appointments, id, { start: s, end: e })
  })
}

export function tokenKey(start: number): string {
  return `token:${toISODate(new Date(start))}`
}

// Tokens are per day of the appointment and are kept once assigned, so a
// patient marked no-show then arrived late keeps any earlier number.
export async function setStatus(id: string, status: AppointmentStatus): Promise<Appointment> {
  return db.transaction('rw', db.appointments, db.kv, async () => {
    const a = await getLive(id)
    if (a.status === status) return a
    if (!TRANSITIONS[a.status].includes(status)) {
      throw new AppointmentError(`Cannot change ${STATUS_LABEL[a.status]} to ${STATUS_LABEL[status]}`)
    }
    const changes: Partial<Appointment> = { status }
    if (status === 'arrived' && a.token == null) changes.token = await nextSequence(tokenKey(a.start))
    await update<Appointment>(db.appointments, id, changes)
    return { ...a, ...changes }
  })
}

export function cancel(id: string): Promise<Appointment> {
  return setStatus(id, 'cancelled')
}

// A walk-in joins the queue now. It skips the overlap check: the queue is
// served by token order, not by slot.
export async function walkIn(patientId: string, durationMin = 15, now = Date.now()): Promise<Appointment> {
  return db.transaction('rw', db.appointments, db.patients, db.kv, async () => {
    if (!(await livePatient(patientId))) throw new AppointmentError('Patient not found')
    const start = Math.floor(now / MINUTE) * MINUTE
    const token = await nextSequence(tokenKey(start))
    return insert<Appointment>(db.appointments, {
      patientId,
      start,
      end: start + durationMin * MINUTE,
      status: 'arrived',
      token,
      notes: 'Walk-in',
    })
  })
}

async function withPatients(rows: Appointment[]): Promise<AppointmentWithPatient[]> {
  const ids = [...new Set(rows.map((a) => a.patientId))]
  const patients = await db.patients.bulkGet(ids)
  const byId = new Map<string, Patient>()
  for (const p of patients) if (p && p.deleted === 0) byId.set(p.id, p)
  return rows.filter((a) => byId.has(a.patientId)).map((a) => ({ ...a, patient: byId.get(a.patientId)! }))
}

// Appointments starting in [start, end), all statuses, by start time.
export async function appointmentsInRange(start: number | Date, end: number | Date): Promise<AppointmentWithPatient[]> {
  const rows = await db.appointments
    .where('start')
    .between(+start, +end, true, false)
    .filter((a) => a.deleted === 0)
    .sortBy('start')
  return withPatients(rows)
}

export function appointmentsForDay(date: string): Promise<AppointmentWithPatient[]> {
  return appointmentsInRange(dayStart(date), dayStart(addDays(date, 1)))
}

// Active appointments from the start of today onwards.
export async function upcomingForPatient(patientId: string): Promise<Appointment[]> {
  if (!(await livePatient(patientId))) return []
  const from = dayStart(todayISO())
  const rows = await db.appointments
    .where('patientId')
    .equals(patientId)
    .filter((a) => isActive(a) && a.start >= from)
    .toArray()
  return rows.sort((a, b) => a.start - b.start)
}

// The patient's token for today, if they have arrived.
export async function todaysToken(patientId: string): Promise<number | undefined> {
  const today = todayISO()
  const rows = await db.appointments
    .where('patientId')
    .equals(patientId)
    .filter((a) => a.deleted === 0 && a.token != null && a.status !== 'cancelled' && toISODate(new Date(a.start)) === today)
    .toArray()
  return rows.sort((a, b) => b.start - a.start)[0]?.token
}

// Called after a visit is saved: closes the patient's open appointment that day.
export async function completeAppointmentForVisit(patientId: string, date: string): Promise<void> {
  const rows = await db.appointments
    .where('patientId')
    .equals(patientId)
    .filter((a) => a.deleted === 0 && a.status === 'arrived' && toISODate(new Date(a.start)) === date)
    .toArray()
  for (const a of rows) await setStatus(a.id, 'done')
}
