import { describe, expect, it } from 'vitest'
import { db } from '../../db/db'
import { softDelete } from '../../db/repo'
import { addDays, todayISO } from '../../lib/format'
import { createPatient, deletePatient } from '../patients/patientRepo'
import {
  appointmentsForDay,
  appointmentsInRange,
  bookAppointment,
  cancel,
  completeAppointmentForVisit,
  reschedule,
  setStatus,
  todaysToken,
  upcomingForPatient,
  walkIn,
} from './appointmentRepo'
import { calendarHours, suggestedStart, validateSessions, widenForEvents } from './clinicHours'
import { combineDateTime } from './time'

const at = (dayOffset: number, time: string) => combineDateTime(addDays(todayISO(), dayOffset), time)
const MIN = 60_000

describe('bookAppointment', () => {
  it('books, and rejects overlaps with active appointments only', async () => {
    const a = await createPatient({ name: 'Asha' })
    const b = await createPatient({ name: 'Ravi' })
    const first = await bookAppointment(a.id, at(1, '10:00'), 15, ' fever ')
    expect(first).toMatchObject({ status: 'booked', end: +at(1, '10:15'), notes: 'fever' })

    await expect(bookAppointment(b.id, at(1, '10:10'))).rejects.toThrow("Overlaps with Asha's appointment")
    await expect(bookAppointment(b.id, at(1, '09:50'), 15)).rejects.toThrow(/Overlaps/)
    // Touching edges are fine.
    await bookAppointment(b.id, at(1, '10:15'))
    await bookAppointment(b.id, at(1, '09:45'))

    // Cancelled / no-show / done free the slot.
    await cancel(first.id)
    const again = await bookAppointment(b.id, at(1, '10:00'))
    await setStatus(again.id, 'no-show')
    await bookAppointment(a.id, at(1, '10:00'))
  })

  it('ignores appointments of deleted patients and deleted appointments', async () => {
    const a = await createPatient({ name: 'Asha' })
    const b = await createPatient({ name: 'Ravi' })
    const x = await bookAppointment(a.id, at(1, '11:00'))
    await deletePatient(a.id)
    await bookAppointment(b.id, at(1, '11:00'))
    await softDelete(db.appointments, x.id)
    await expect(bookAppointment(a.id, at(2, '11:00'))).rejects.toThrow('Patient not found')
  })

  it('rejects past dates but allows earlier today', async () => {
    const a = await createPatient({ name: 'Asha' })
    await expect(bookAppointment(a.id, at(-1, '23:30'))).rejects.toThrow('Cannot book a date in the past')
    await expect(bookAppointment(a.id, at(0, '00:00'))).resolves.toMatchObject({ status: 'booked' })
  })
})

describe('reschedule', () => {
  it('moves a booked appointment and rejects overlaps and the past', async () => {
    const a = await createPatient({ name: 'Asha' })
    const b = await createPatient({ name: 'Ravi' })
    const x = await bookAppointment(a.id, at(1, '10:00'))
    const y = await bookAppointment(b.id, at(1, '11:00'))
    await reschedule(x.id, at(1, '10:30'), at(1, '11:00'))
    expect(await db.appointments.get(x.id)).toMatchObject({ start: +at(1, '10:30'), end: +at(1, '11:00') })
    // Resizing within its own slot is not an overlap with itself.
    await reschedule(x.id, at(1, '10:30'), at(1, '10:45'))
    await expect(reschedule(x.id, at(1, '10:50'), at(1, '11:05'))).rejects.toThrow(/Overlaps with Ravi/)
    await expect(reschedule(x.id, at(-2, '10:00'), at(-2, '10:15'))).rejects.toThrow(/past/)
    await setStatus(y.id, 'arrived')
    await expect(reschedule(y.id, at(2, '10:00'), at(2, '10:15'))).rejects.toThrow(/Cannot reschedule/)
  })
})

describe('status and tokens', () => {
  it('follows allowed transitions', async () => {
    const p = await createPatient({ name: 'Asha' })
    const a = await bookAppointment(p.id, at(0, '23:00'))
    await expect(setStatus(a.id, 'done')).rejects.toThrow('Cannot change Booked to Done')
    expect((await setStatus(a.id, 'arrived')).status).toBe('arrived')
    await expect(setStatus(a.id, 'no-show')).rejects.toThrow()
    await setStatus(a.id, 'done')
    await expect(setStatus(a.id, 'cancelled')).rejects.toThrow()

    const b = await bookAppointment(p.id, at(1, '10:00'))
    await setStatus(b.id, 'no-show')
    const late = await setStatus(b.id, 'arrived')
    expect(late.token).toBe(1)
    await cancel(b.id)
    await expect(setStatus(b.id, 'booked')).rejects.toThrow()
  })

  it('assigns sequential tokens per day on arrival, concurrency-safe', async () => {
    const p = await createPatient({ name: 'Asha' })
    const today = await Promise.all(['20:00', '20:15', '20:30', '20:45', '21:00'].map((t) => bookAppointment(p.id, at(0, t))))
    const tokens = await Promise.all(today.map((a) => setStatus(a.id, 'arrived')))
    expect(tokens.map((a) => a.token).sort()).toEqual([1, 2, 3, 4, 5])
    // Re-marking arrived keeps the token.
    expect((await setStatus(today[0].id, 'arrived')).token).toBe(tokens[0].token)

    const tomorrow = await bookAppointment(p.id, at(1, '10:00'))
    expect((await setStatus(tomorrow.id, 'arrived')).token).toBe(1)
    const booked = await bookAppointment(p.id, at(1, '11:00'))
    expect((await db.appointments.get(booked.id))?.token).toBeUndefined()
  })

  it('walk-in creates an arrived appointment now with the next token', async () => {
    const p = await createPatient({ name: 'Asha' })
    const q = await createPatient({ name: 'Ravi' })
    const booked = await bookAppointment(p.id, at(0, '23:30'))
    await setStatus(booked.id, 'arrived')
    const before = Date.now()
    const w = await walkIn(q.id)
    expect(w).toMatchObject({ status: 'arrived', token: 2, notes: 'Walk-in' })
    expect(w.start).toBeLessThanOrEqual(before)
    expect(w.start).toBeGreaterThan(before - MIN)
    expect(w.end - w.start).toBe(15 * MIN)
    expect(await todaysToken(q.id)).toBe(2)
    expect(await todaysToken(p.id)).toBe(1)

    await completeAppointmentForVisit(q.id, todayISO())
    expect((await db.appointments.get(w.id))?.status).toBe('done')
  })
})

describe('queries', () => {
  it('day, range and upcoming skip deleted appointments and patients', async () => {
    const a = await createPatient({ name: 'Asha' })
    const b = await createPatient({ name: 'Ravi' })
    const c = await createPatient({ name: 'Gone' })
    await bookAppointment(a.id, at(1, '11:00'))
    const early = await bookAppointment(b.id, at(1, '09:00'))
    await bookAppointment(c.id, at(1, '10:00'))
    const del = await bookAppointment(a.id, at(1, '12:00'))
    await bookAppointment(a.id, at(2, '09:00'))
    await softDelete(db.appointments, del.id)
    await deletePatient(c.id)

    const day = await appointmentsForDay(addDays(todayISO(), 1))
    expect(day.map((x) => x.patient.name)).toEqual(['Ravi', 'Asha'])
    expect(day[0].id).toBe(early.id)

    const range = await appointmentsInRange(at(1, '00:00'), at(3, '00:00'))
    expect(range.map((x) => `${x.patient.name} ${new Date(x.start).getHours()}`)).toEqual(['Ravi 9', 'Asha 11', 'Asha 9'])

    expect((await upcomingForPatient(a.id)).length).toBe(2)
    expect(await upcomingForPatient(c.id)).toEqual([])
    await setStatus(early.id, 'cancelled')
    expect(await upcomingForPatient(b.id)).toEqual([])
  })
})

describe('clinic hours', () => {
  it('maps sessions to business hours and slot range', () => {
    const h = calendarHours([
      { start: '09:30', end: '13:00' },
      { start: '17:00', end: '20:15' },
    ])
    expect(h.businessHours).toEqual([
      { daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: '09:30', endTime: '13:00' },
      { daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: '17:00', endTime: '20:15' },
    ])
    expect(h.slotMinTime).toBe('09:00:00')
    expect(h.slotMaxTime).toBe('21:00:00')
    expect(calendarHours([])).toMatchObject({ businessHours: [], slotMinTime: '08:00:00', slotMaxTime: '21:00:00' })
    expect(calendarHours([{ start: '22:00', end: '23:59' }]).slotMaxTime).toBe('24:00:00')

    const late = widenForEvents(h, [{ start: +at(0, '07:30'), end: +at(0, '07:45') }, { start: +at(0, '23:00'), end: +at(0, '23:15') }])
    expect([late.slotMinTime, late.slotMaxTime]).toEqual(['07:00:00', '24:00:00'])
    expect(widenForEvents(h, [{ start: +at(0, '10:00'), end: +at(0, '10:15') }])).toEqual(h)
  })

  it('validates sessions', () => {
    expect(validateSessions([{ start: '09:00', end: '13:00' }])).toBeNull()
    expect(validateSessions([{ start: '13:00', end: '09:00' }])).toMatch(/end after/)
    expect(validateSessions([{ start: '9', end: '13:00' }])).toMatch(/HH:MM/)
    expect(
      validateSessions([
        { start: '09:00', end: '13:00' },
        { start: '12:00', end: '14:00' },
      ]),
    ).toMatch(/overlap/)
  })

  it('suggests the next slot inside a session', () => {
    const sessions = [
      { start: '09:00', end: '13:00' },
      { start: '17:00', end: '20:00' },
    ]
    const fmt = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
    expect(fmt(suggestedStart(sessions, 15, at(0, '07:10')))).toBe('9:00')
    expect(fmt(suggestedStart(sessions, 15, at(0, '10:07')))).toBe('10:15')
    expect(fmt(suggestedStart(sessions, 15, at(0, '14:00')))).toBe('17:00')
    expect(fmt(suggestedStart(sessions, 15, at(0, '21:00')))).toBe('21:00')
  })
})
