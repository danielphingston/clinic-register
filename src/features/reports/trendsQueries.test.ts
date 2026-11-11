import { describe, expect, it } from 'vitest'
import { db } from '../../db/db'
import { insert } from '../../db/repo'
import type { Appointment, ComplaintStatus } from '../../db/types'
import { parseISODate } from '../../lib/format'
import { periodOf } from '../../lib/period'
import { createBill, outstandingTotal, recordPayment, reversePayment, voidBill } from '../billing/billingRepo'
import { createPatient, deletePatient } from '../patients/patientRepo'
import { saveVisit } from '../visits/visitRepo'
import { buildReport } from './reportDefs'
import { busyDays, complaintOutcomes, duesAsOf, followUpStats, noShows, notSeenAgain, topDiagnoses } from './trendsQueries'

const OCT = { from: '2026-10-01', to: '2026-10-31' }
const NOV = { from: '2026-11-01', to: '2026-11-11' }
const TODAY = '2026-11-11'
const at = (iso: string, hh: number, mm = 0) => parseISODate(iso).getTime() + (hh * 60 + mm) * 60_000

async function visit(patientId: string, date: string, followUpDate?: string, complaintStatus?: ComplaintStatus[]) {
  return saveVisit({ patientId, date, followUpDate, caseNotes: complaintStatus ? { complaintStatus } : {}, items: [] })
}

async function appt(patientId: string, start: number, status: Appointment['status']) {
  return insert<Appointment>(db.appointments, { patientId, start, end: start + 15 * 60_000, status })
}

// Follow-ups due in October, one of each outcome, plus patients that must
// not count. Returns the patients by name.
async function followUpFixture() {
  const p = async (name: string) => createPatient({ name, phone: `9${name.length}` })
  const onTime = await p('Onti')
  await visit(onTime.id, '2026-10-01', '2026-10-10')
  await visit(onTime.id, '2026-10-12') // 2 days after the date
  const early = await p('Earl')
  await visit(early.id, '2026-10-01', '2026-10-20')
  await visit(early.id, '2026-10-05') // 15 days before
  const late = await p('Lata')
  await visit(late.id, '2026-09-20', '2026-10-05')
  await visit(late.id, '2026-10-25') // 20 days after
  const missed = await p('Miss')
  await visit(missed.id, '2026-10-02', '2026-10-15')
  const pending = await p('Penn')
  await visit(pending.id, '2026-10-28', '2026-11-08') // due in November, 3 days ago
  const noDate = await p('Nodt')
  await visit(noDate.id, '2026-10-03') // expected back 2 Nov
  const recent = await p('Rece')
  await visit(recent.id, '2026-10-20') // expected back 19 Nov
  const gone = await p('Gone')
  await visit(gone.id, '2026-10-01', '2026-10-05')
  await deletePatient(gone.id)
  return { onTime, early, late, missed, pending, noDate, recent }
}

describe('collection health', () => {
  it('works out dues on any past day from bills and payments dated up to then', async () => {
    const a = await createPatient({ name: 'Asha' })
    const b = await createPatient({ name: 'Bala' })
    const sep = await createBill({ patientId: a.id, date: '2026-09-30', items: [{ desc: 'Consultation', amount: 300 }], discount: 0, payNow: { amount: 100, mode: 'cash' } })
    await recordPayment(sep.bill.id, 200, 'upi', '2026-10-10')
    await createBill({ patientId: a.id, date: '2026-10-05', items: [{ desc: 'Consultation', amount: 500 }], discount: 0 })
    const reversed = await createBill({ patientId: a.id, date: '2026-10-06', items: [{ desc: 'Medicines', amount: 300 }], discount: 0, payNow: { amount: 300, mode: 'card' } })
    await reversePayment(reversed.payment!.id)
    const voided = await createBill({ patientId: a.id, date: '2026-10-07', items: [{ desc: 'Dressing', amount: 400 }], discount: 0 })
    await voidBill(voided.bill.id)
    await createBill({ patientId: b.id, date: '2026-10-01', items: [{ desc: 'Consultation', amount: 200 }], discount: 0 })
    await deletePatient(b.id)

    expect(await duesAsOf('2026-09-29')).toBe(0)
    expect(await duesAsOf('2026-09-30')).toBe(200)
    expect(await duesAsOf('2026-10-05')).toBe(700)
    expect(await duesAsOf('2026-10-06')).toBe(1000) // the reversed payment never counts
    expect(await duesAsOf('2026-10-10')).toBe(800)
    expect(await duesAsOf(TODAY)).toBe(await outstandingTotal())
  })
})

describe('follow-ups', () => {
  it('sorts follow-ups due in the window into on time, early, late, missed and not yet counted', async () => {
    await followUpFixture()
    expect(await followUpStats(OCT, TODAY)).toEqual({ due: 4, onTime: 1, early: 1, late: 1, missed: 1, pending: 0, rate: 0.25 })
    // November: one follow-up, 3 days past, so not counted yet.
    expect(await followUpStats(NOV, TODAY)).toEqual({ due: 1, onTime: 0, early: 0, late: 0, missed: 0, pending: 1, rate: null })
  })

  it('counts a return exactly 7 days either side as on time', async () => {
    const p = await createPatient({ name: 'Edge' })
    await visit(p.id, '2026-10-01', '2026-10-10')
    await visit(p.id, '2026-10-17')
    const q = await createPatient({ name: 'Edgy' })
    await visit(q.id, '2026-10-01', '2026-10-10')
    await visit(q.id, '2026-10-03')
    expect(await followUpStats(OCT, TODAY)).toMatchObject({ due: 2, onTime: 2, rate: 1 })
  })

  it('lists new patients not seen again once they are over 7 days past due back', async () => {
    const f = await followUpFixture()
    const rows = await notSeenAgain(OCT, TODAY)
    expect(rows.map((r) => [r.patient.name, r.firstVisit, r.followUpDate])).toEqual([
      ['Miss', '2026-10-02', '2026-10-15'],
      ['Nodt', '2026-10-03', undefined], // no date: due back 30 days on, 2 Nov
    ])
    expect(rows[0].patient.id).toBe(f.missed.id)
    // On 26 Nov Penn is 18 days past 8 Nov and joins; Rece, due back 19 Nov, is exactly 7 days past and not yet.
    expect((await notSeenAgain(OCT, '2026-11-26')).map((r) => r.patient.name)).toEqual(['Miss', 'Nodt', 'Penn'])
  })
})

describe('busy days and no-shows', () => {
  it('averages visits per weekday and maps attended arrivals by hour', async () => {
    const a = await createPatient({ name: 'Asha' })
    const b = await createPatient({ name: 'Bala' })
    await visit(a.id, '2026-10-01') // Thursday
    await visit(b.id, '2026-10-01')
    await visit(a.id, '2026-10-08') // Thursday
    await visit(b.id, '2026-10-05') // Monday
    await appt(a.id, at('2026-10-01', 9, 30), 'done')
    await appt(b.id, at('2026-10-01', 9, 45), 'arrived')
    await appt(b.id, at('2026-10-05', 17), 'done')
    await appt(a.id, at('2026-10-06', 10), 'no-show')

    const busy = await busyDays(OCT)
    expect(busy.byWeekday.find((d) => d.day === 'Thu')).toEqual({ day: 'Thu', visits: 3, days: 5, average: 0.6 })
    expect(busy.byWeekday.find((d) => d.day === 'Mon')).toEqual({ day: 'Mon', visits: 1, days: 4, average: 0.3 })
    expect(busy.byWeekday.find((d) => d.day === 'Sun')).toEqual({ day: 'Sun', visits: 0, days: 4, average: 0 })
    // 9 am to 5 pm with the quiet hours in between; the no-show's 10 am adds nothing.
    expect(busy.hours).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17])
    expect(busy.heat[3]).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0]) // Thursday
    expect(busy.heat[0]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1]) // Monday
  })

  it('gives the no-show rate of decided appointments, or none without any', async () => {
    const a = await createPatient({ name: 'Asha' })
    await appt(a.id, at('2026-10-01', 9), 'done')
    await appt(a.id, at('2026-10-02', 9), 'arrived')
    await appt(a.id, at('2026-10-03', 9), 'no-show')
    await appt(a.id, at('2026-10-04', 9), 'cancelled')
    await appt(a.id, at('2026-10-05', 9), 'booked')
    await appt(a.id, at('2026-11-01', 9), 'no-show')
    expect(await noShows(OCT)).toEqual({ appointments: 5, attended: 2, noShows: 1, rate: 1 / 3 })
    expect((await noShows({ from: '2026-09-01', to: '2026-09-30' })).rate).toBeNull()
  })
})

describe('clinical trends', () => {
  it('counts complaint progress and the share better or resolved', async () => {
    const a = await createPatient({ name: 'Asha' })
    await visit(a.id, '2026-10-02', undefined, [
      { complaint: 'Headache', status: 'better' },
      { complaint: 'Cough', status: 'resolved' },
      { complaint: 'Rash', status: 'worse' },
    ])
    await visit(a.id, '2026-10-03', undefined, [{ complaint: 'Headache', status: 'persists' }])
    await visit(a.id, '2026-11-02', undefined, [{ complaint: 'Headache', status: 'resolved' }])
    expect(await complaintOutcomes(OCT)).toEqual({ reviewed: 4, byStatus: { resolved: 1, better: 1, persists: 1, worse: 1 }, improvedRate: 0.5 })
    expect((await complaintOutcomes({ from: '2026-09-01', to: '2026-09-30' })).improvedRate).toBeNull()
  })

  it('ranks diagnoses of patients seen, ignoring case and spacing', async () => {
    const x = await createPatient({ name: 'Xavi', diagnoses: ['Migraine', 'Asthma'] })
    const y = await createPatient({ name: 'Yash', diagnoses: ['migraine ', ' Acid  reflux'] })
    const z = await createPatient({ name: 'Zara', diagnoses: ['Asthma', 'asthma'] })
    const w = await createPatient({ name: 'Wren', diagnoses: ['Migraine'] })
    await visit(x.id, '2026-10-01')
    await visit(y.id, '2026-10-02')
    await visit(z.id, '2026-10-03')
    await visit(z.id, '2026-10-04')
    await visit(w.id, '2026-09-01') // not seen in October
    expect(await topDiagnoses(OCT)).toEqual([
      { diagnosis: 'Asthma', patients: 2 },
      { diagnosis: 'Migraine', patients: 2 },
      { diagnosis: 'Acid reflux', patients: 1 },
    ])
  })
})

describe('trends report sections', () => {
  it('adds collection health, follow-ups, busy days and clinical sections with compared tiles', async () => {
    await followUpFixture()
    await appt((await createPatient({ name: 'Appu' })).id, at('2026-10-01', 11), 'done')
    const r = await buildReport('trends', OCT, TODAY, periodOf('month', '2026-10-01'))
    expect(r.sections?.map((s) => s.title)).toEqual(['Collection health', 'Follow-ups', 'Busy days & no-shows', 'Clinical trends'])
    const tiles = Object.fromEntries(r.sections!.flatMap((s) => s.tiles).map((t) => [t.label, t]))

    expect(tiles['Follow-up adherence']).toMatchObject({ type: 'percent', value: 0.25, hint: '1 of 4 on time' })
    // No follow-ups were due in September or a year back, so there is nothing to compare.
    expect(tiles['Follow-up adherence'].compare).toEqual([
      { label: 'September 2026', value: null },
      { label: 'October 2025', value: null },
    ])
    expect(tiles['Not seen again']).toMatchObject({ value: 2, lowerIsBetter: true })
    expect(tiles['Outstanding dues']).toMatchObject({ value: 0, lowerIsBetter: true, hint: '₹0 at the start' })
    expect(tiles['No-show rate']).toMatchObject({ value: 0, lowerIsBetter: true })
    expect(tiles['Collected per visit'].value).toBe(0)
    expect(tiles['Collected ÷ billed'].value).toBeNull()

    const followUps = r.sections![1]
    expect(followUps.tables[0].rows.map((row) => [row.outcome, row.count])).toEqual([
      ['On time (within 7 days)', 1],
      ['Came back early', 1],
      ['Came back late', 1],
      ['Did not come back', 1],
      ['Not counted yet', 0],
    ])
    expect(followUps.tables[1].rows.map((row) => row.name)).toEqual(['Miss', 'Nodt'])
    expect(followUps.tables[1].links?.every((l) => l?.startsWith('/patients/'))).toBe(true)

    const arrivals = r.sections![2].tables.find((t) => t.title === 'Arrivals by hour')!
    expect(arrivals.columns.map((c) => c.header)).toEqual(['Day', '11 am'])
    expect(arrivals.heat).toEqual(['h11'])
    expect(arrivals.rows[3]).toEqual({ day: 'Thu', h11: 1 })
    expect(arrivals.rows[0]).toEqual({ day: 'Mon', h11: null })
  })
})
