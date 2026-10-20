import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/db'
import { insert, softDelete } from '../../db/repo'
import type { Appointment } from '../../db/types'
import { parseISODate } from '../../lib/format'
import { createPatient, deletePatient } from '../patients/patientRepo'
import { saveVisit } from '../visits/visitRepo'
import { createBill, recordPayment, reversePayment, voidBill } from '../billing/billingRepo'
import { createStockItem, deleteStockItem, purchase } from '../stock/stockRepo'
import { seedRemedies, seedRemedyId } from '../remedies/remedyRepo'
import {
  ageBand,
  appointmentsReport,
  collectionsInRange,
  dailyTrend,
  duesReport,
  medicineMatcher,
  opRegister,
  patientsSummary,
  revenueReport,
  stockReport,
  topRemedies,
} from './reportQueries'

const OCT = { from: '2026-10-01', to: '2026-10-31' }
const ARS = seedRemedyId('Arsenicum album')
const PULS = seedRemedyId('Pulsatilla nigricans')
const at = (iso: string, hh: number, mm = 0) => parseISODate(iso).getTime() + (hh * 60 + mm) * 60_000

async function appt(patientId: string, start: number, status: Appointment['status'], notes?: string) {
  return insert<Appointment>(db.appointments, { patientId, start, end: start + 15 * 60_000, status, notes })
}

// A: first visit 30 Sep (outside the range), revisits 1 and 15 Oct.
// B: first visit on 31 Oct (the range's last day).
// C: deleted patient with an October visit, bill and payment.
// D: an older deleted visit (so 20 Oct counts as new), plus a 1 Nov visit.
beforeEach(async () => {
  await seedRemedies()
  const a = await createPatient({ name: 'Asha', sex: 'F', age: 30, ageAsOf: '2026-10-01' })
  const b = await createPatient({ name: 'Bala', sex: 'M', age: 10, ageAsOf: '2026-10-01' })
  const c = await createPatient({ name: 'Chitra', sex: 'F', age: 40, ageAsOf: '2026-10-01' })
  const d = await createPatient({ name: 'Devan', age: 70, ageAsOf: '2026-10-01' })
  const stock = await createStockItem({ remedyId: ARS, potency: '30C', form: 'dilution', unit: 'ml', lowStockAt: 150, price: 2, openingQty: 100, date: '2026-09-01' })
  const gone = await createStockItem({ remedyId: PULS, potency: '200C', form: 'dilution', unit: 'ml', lowStockAt: 5, price: 2 })
  await deleteStockItem(gone.id)
  await purchase(stock.id, 50, 'Invoice', '2026-10-31')

  const aSep = await saveVisit({ patientId: a.id, date: '2026-09-30', caseNotes: { complaint: 'Cold' }, items: [] })
  const a1 = await saveVisit({
    patientId: a.id,
    date: '2026-10-01',
    caseNotes: { complaint: 'Headache' },
    items: [
      { remedyId: ARS, potency: '30C' },
      { remedyId: PULS, potency: '200C' },
    ],
  })
  await saveVisit({ patientId: a.id, date: '2026-10-15', caseNotes: {}, items: [{ remedyId: ARS, potency: '30c', stockItemId: stock.id, qtyDispensed: 10 }] })
  const bVisit = await saveVisit({ patientId: b.id, date: '2026-10-31', caseNotes: { complaint: 'Fever' }, items: [] })
  await saveVisit({ patientId: c.id, date: '2026-10-10', caseNotes: {}, items: [{ remedyId: ARS, potency: '30C' }] })
  const dOld = await saveVisit({ patientId: d.id, date: '2026-09-01', caseNotes: {}, items: [] })
  await softDelete(db.visits, dOld)
  await saveVisit({ patientId: d.id, date: '2026-10-20', caseNotes: {}, items: [{ remedyId: ARS, potency: '30C' }] })
  await saveVisit({ patientId: d.id, date: '2026-11-01', caseNotes: {}, items: [{ remedyId: ARS, potency: '30C' }] })

  // Bills and payments.
  const sepBill = await createBill({ patientId: a.id, visitId: aSep, date: '2026-09-30', items: [{ desc: 'Consultation', amount: 300 }], discount: 0, dueDate: '2026-10-15' })
  await recordPayment(sepBill.bill.id, 300, 'cash', '2026-10-01')
  const octBill = await createBill({
    patientId: a.id,
    visitId: a1,
    date: '2026-10-01',
    items: [
      { desc: 'Consultation', amount: 300 },
      { desc: 'Arsenicum album 30C × 10 ml', amount: 20 },
    ],
    discount: 20,
    dueDate: '2026-10-16',
    payNow: { amount: 150, mode: 'cash' },
  })
  await recordPayment(octBill.bill.id, 50, 'upi', '2026-11-02')
  await createBill({ patientId: b.id, visitId: bVisit, date: '2026-10-31', items: [{ desc: 'Consultation', amount: 200 }], discount: 0, payNow: { amount: 200, mode: 'upi' } })
  const reversed = await createBill({ patientId: b.id, date: '2026-10-20', items: [{ desc: 'Dressing', amount: 80 }], discount: 0, payNow: { amount: 80, mode: 'card' } })
  await reversePayment(reversed.payment!.id)
  await voidBill(reversed.bill.id)
  await createBill({ patientId: c.id, date: '2026-10-10', items: [{ desc: 'Consultation', amount: 100 }], discount: 0, payNow: { amount: 100, mode: 'cash' } })

  // Appointments, including both range edges.
  await appt(a.id, at('2026-10-01', 0, 0), 'done')
  await appt(b.id, at('2026-10-01', 10), 'done', 'Walk-in')
  await appt(d.id, at('2026-10-02', 11), 'no-show')
  await appt(b.id, at('2026-10-31', 23, 59), 'cancelled')
  await appt(a.id, at('2026-11-01', 0, 0), 'booked')
  await appt(a.id, at('2026-09-30', 23, 59), 'done')
  const del = await appt(a.id, at('2026-10-05', 9), 'done')
  await softDelete(db.appointments, del.id)
  await appt(c.id, at('2026-10-05', 9), 'done')

  await deletePatient(c.id)
})

describe('OP register', () => {
  it('lists visits in the inclusive range by date, with new vs revisit', async () => {
    const rows = await opRegister(OCT)
    expect(rows.map((r) => [r.sNo, r.date, r.name, r.isNew])).toEqual([
      [1, '2026-10-01', 'Asha', false],
      [2, '2026-10-15', 'Asha', false],
      [3, '2026-10-20', 'Devan', true],
      [4, '2026-10-31', 'Bala', true],
    ])
    const first = rows[0]
    expect(first.remedies).toBe('Arsenicum album 30C, Pulsatilla nigricans 200C')
    expect(first.complaint).toBe('Headache')
    expect(first.ageSex).toBe('30y / F')
    expect(first.consultation).toBe(300)
    expect(first.billed).toBe(300)
    expect(first.paid).toBe(200)
    expect(rows[3].consultation).toBe(200)
    expect(rows[2].billed).toBe(0)
  })

  it('a single-day range on either edge', async () => {
    expect((await opRegister({ from: '2026-10-31', to: '2026-10-31' })).map((r) => r.name)).toEqual(['Bala'])
    expect((await opRegister({ from: '2026-09-30', to: '2026-09-30' })).map((r) => [r.name, r.isNew])).toEqual([['Asha', true]])
    expect(await opRegister({ from: '2026-12-01', to: '2026-12-31' })).toEqual([])
  })
})

describe('patients summary', () => {
  it('counts new vs revisit, daily buckets, sex and age bands', async () => {
    const s = await patientsSummary(OCT)
    expect(s.granularity).toBe('day')
    expect([s.visits, s.newCount, s.revisit, s.distinctPatients]).toEqual([4, 2, 2, 3])
    expect(s.buckets).toHaveLength(31)
    expect(s.buckets[0]).toEqual({ key: '2026-10-01', newCount: 0, revisit: 1, total: 1 })
    expect(s.buckets[30]).toEqual({ key: '2026-10-31', newCount: 1, revisit: 0, total: 1 })
    expect(s.bySex).toEqual({ M: 1, F: 1, O: 0, U: 1 })
    expect(s.byAge).toMatchObject({ '0–12': 1, '19–40': 1, '60+': 1, '13–18': 0, '41–60': 0 })
  })

  it('switches to months for ranges over 62 days', async () => {
    const s = await patientsSummary({ from: '2026-09-01', to: '2026-11-30' })
    expect(s.granularity).toBe('month')
    expect(s.buckets.map((b) => [b.key, b.newCount, b.revisit])).toEqual([
      ['2026-09', 1, 0],
      ['2026-10', 2, 2],
      ['2026-11', 0, 1],
    ])
  })

  it('age bands', () => {
    expect([0, 12, 13, 18, 19, 40, 41, 60, 61, undefined].map(ageBand)).toEqual(['0–12', '0–12', '13–18', '13–18', '19–40', '19–40', '41–60', '41–60', '60+', 'Unknown'])
  })
})

describe('revenue', () => {
  it('billed by bill date, collected by payment date, excluding deleted records', async () => {
    const r = await revenueReport(OCT)
    expect(r.billed).toBe(500)
    expect(r.collected).toBe(650)
    expect(r.byMode).toEqual({ cash: 450, upi: 200, card: 0, other: 0 })
    expect(r.discount).toBe(20)
    expect(r.consultation).toBe(500)
    expect(r.medicine).toBe(20)
    expect(r.buckets.find((b) => b.key === '2026-10-01')).toEqual({ key: '2026-10-01', billed: 300, collected: 450 })
    expect(r.buckets.find((b) => b.key === '2026-10-31')).toEqual({ key: '2026-10-31', billed: 200, collected: 200 })
    const sumPayments = (await collectionsInRange(OCT)).reduce((s, p) => s + p.amount, 0)
    expect(sumPayments).toBe(r.collected)
  })

  it('medicine rule: stock-linked lines or a description starting with a remedy name', () => {
    const isMed = medicineMatcher([{ name: 'Nux vomica', abbrev: 'Nux-v' }, { name: 'Sulphur' }])
    expect(isMed({ desc: 'Medicines', amount: 1, stockItemId: 's1' })).toBe(true)
    expect(isMed({ desc: 'nux vomica 30C', amount: 1 })).toBe(true)
    expect(isMed({ desc: 'Nux-v 200', amount: 1 })).toBe(true)
    expect(isMed({ desc: 'Sulphur', amount: 1 })).toBe(true)
    expect(isMed({ desc: 'Sulphuric acid wash', amount: 1 })).toBe(false)
    expect(isMed({ desc: 'Consultation', amount: 1 })).toBe(false)
  })
})

describe('dues', () => {
  it('ageing and patient list as of the given day', async () => {
    const d = await duesReport('2026-11-10')
    expect(d.total).toBe(100)
    expect(d.overdue).toBe(100)
    expect(d.ageing.d0_30).toEqual({ count: 1, amount: 100 })
    expect(d.patients.map((p) => [p.patient.name, p.balance])).toEqual([['Asha', 100]])
  })
})

describe('top remedies', () => {
  it('groups by remedy + potency (case-insensitive), with distinct patients', async () => {
    const rows = await topRemedies(OCT)
    expect(rows.map((r) => [r.remedyName, r.potency, r.count, r.patients])).toEqual([
      ['Arsenicum album', '30C', 3, 2],
      ['Pulsatilla nigricans', '200C', 1, 1],
    ])
    expect(await topRemedies(OCT, 1)).toHaveLength(1)
  })
})

describe('stock', () => {
  it('usage and purchases in the range with current qty and flags', async () => {
    const rows = await stockReport(OCT)
    expect(rows).toHaveLength(1) // the deleted item never moved
    expect(rows[0]).toMatchObject({ remedyName: 'Arsenicum album', used: 10, purchased: 50, qty: 140, status: 'low', negative: false })
    const sep = await stockReport({ from: '2026-09-01', to: '2026-09-30' })
    expect(sep[0]).toMatchObject({ used: 0, purchased: 100 })
  })
})

describe('appointments', () => {
  it('counts statuses, walk-ins and no-show rate inside the range only', async () => {
    const r = await appointmentsReport(OCT)
    expect(r.total).toBe(4)
    expect(r.byStatus).toEqual({ booked: 0, arrived: 0, done: 2, 'no-show': 1, cancelled: 1 })
    expect(r.attended).toBe(2)
    expect(r.noShowRate).toBeCloseTo(1 / 3)
    expect(r.walkIns).toBe(1)
    expect(r.booked).toBe(3)
    expect(r.buckets[0]).toEqual({ key: '2026-10-01', attended: 2, noShow: 0, cancelled: 0 })
    expect(r.buckets[30].cancelled).toBe(1)
  })
})

describe('dashboard trend', () => {
  it('visits and collections per day', async () => {
    const t = await dailyTrend({ from: '2026-09-30', to: '2026-10-02' })
    expect(t).toEqual([
      { date: '2026-09-30', visits: 1, collected: 0 },
      { date: '2026-10-01', visits: 1, collected: 450 },
      { date: '2026-10-02', visits: 0, collected: 0 },
    ])
  })
})
