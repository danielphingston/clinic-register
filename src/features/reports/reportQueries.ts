import { db } from '../../db/db'
import type { AppointmentStatus, Bill, BillItem, Patient, PaymentMode, PrescriptionItem, Remedy, Sex, StockItem, Visit } from '../../db/types'
import { ageSex, currentAge } from '../../lib/age'
import { bucketKey, bucketKeys, granularityFor, type DateRange, type Granularity } from '../../lib/dateRange'
import { addDays, parseISODate, toISODate } from '../../lib/format'
import { remedyMap } from '../remedies/remedyRepo'
import { duesAgeing, duesByPatient, round2, type Ageing, type PatientDueRow } from '../billing/billingRepo'
import { stockUsage } from '../stock/stockRepo'
import { roundQty, stockStatus, type StockStatus } from '../stock/stockLogic'

// All report queries take an inclusive range of local ISO dates and skip
// deleted records and records of deleted patients.

const byDateThenCreated = (a: { date: string; createdAt: number }, b: { date: string; createdAt: number }) =>
  a.date.localeCompare(b.date) || a.createdAt - b.createdAt

async function livePatients(ids: Iterable<string>): Promise<Map<string, Patient>> {
  const unique = [...new Set(ids)]
  const map = new Map<string, Patient>()
  for (const p of await db.patients.bulkGet(unique)) if (p && p.deleted === 0) map.set(p.id, p)
  return map
}

async function visitsInRange({ from, to }: DateRange): Promise<{ visits: Visit[]; patients: Map<string, Patient> }> {
  const raw = await db.visits.where('date').between(from, to, true, true).filter((v) => v.deleted === 0).toArray()
  const patients = await livePatients(raw.map((v) => v.patientId))
  return { visits: raw.filter((v) => patients.has(v.patientId)).sort(byDateThenCreated), patients }
}

// Id of each patient's first-ever (non-deleted) visit, by date then entry time.
async function firstVisitIds(patientIds: Iterable<string>): Promise<Set<string>> {
  const all = await db.visits.where('patientId').anyOf([...new Set(patientIds)]).filter((v) => v.deleted === 0).toArray()
  const first = new Map<string, Visit>()
  for (const v of all) {
    const cur = first.get(v.patientId)
    if (!cur || byDateThenCreated(v, cur) < 0) first.set(v.patientId, v)
  }
  return new Set([...first.values()].map((v) => v.id))
}

async function liveBillsInRange({ from, to }: DateRange): Promise<Bill[]> {
  const bills = await db.bills.where('date').between(from, to, true, true).filter((b) => b.deleted === 0).toArray()
  const patients = await livePatients(bills.map((b) => b.patientId))
  return bills.filter((b) => patients.has(b.patientId))
}

// ---- medicine vs consultation ----

// A bill line counts as medicine when it is linked to a stock item, or when
// its description starts with a remedy name or abbreviation (e.g. a manually
// typed "Nux vomica 30C"). Everything else (consultation, procedures, other
// charges) counts as consultation. Discounts are reported separately and are
// not split between the two.
export function medicineMatcher(remedies: Iterable<Pick<Remedy, 'name' | 'abbrev'>>): (item: BillItem) => boolean {
  const prefixes: string[] = []
  for (const r of remedies) {
    for (const s of [r.name, r.abbrev]) {
      const t = s?.trim().toLowerCase()
      if (t && t.length >= 3) prefixes.push(t)
    }
  }
  return (item) => {
    if (item.stockItemId) return true
    const d = item.desc.trim().toLowerCase()
    return prefixes.some((p) => d.startsWith(p) && (d.length === p.length || /[\s.,×x(-]/.test(d[p.length])))
  }
}

// ---- OP register ----

export interface OpRegisterRow {
  sNo: number
  date: string
  visitId: string
  patientId: string
  opNo: string
  name: string
  ageSex: string
  isNew: boolean
  complaint: string
  remedies: string
  consultation: number // consultation lines billed against the visit
  billed: number // total of the visit's bills (after discount)
  paid: number // paid so far on those bills
}

export async function opRegister(range: DateRange): Promise<OpRegisterRow[]> {
  const { visits, patients } = await visitsInRange(range)
  if (!visits.length) return []
  const firsts = await firstVisitIds(patients.keys())
  const ids = visits.map((v) => v.id)
  const rx = await db.prescriptionItems.where('visitId').anyOf(ids).filter((i) => i.deleted === 0).toArray()
  const rxByVisit = groupBy(rx, (i) => i.visitId)
  const bills = await db.bills.where('visitId').anyOf(ids).filter((b) => b.deleted === 0).toArray()
  const billsByVisit = groupBy(bills, (b) => b.visitId!)
  const remedies = await remedyMap()
  const isMedicine = medicineMatcher(remedies.values())

  return visits.map((v, n) => {
    const p = patients.get(v.patientId)!
    const items = (rxByVisit.get(v.id) ?? []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt - b.createdAt)
    const vb = billsByVisit.get(v.id) ?? []
    return {
      sNo: n + 1,
      date: v.date,
      visitId: v.id,
      patientId: p.id,
      opNo: p.opNo,
      name: p.name,
      ageSex: ageSex(p, v.date),
      isNew: firsts.has(v.id),
      complaint: v.caseNotes?.complaint?.trim() ?? '',
      remedies: items.map((i) => `${remedies.get(i.remedyId)?.name ?? 'Unknown'} ${i.potency}`.trim()).join(', '),
      consultation: round2(sum(vb.flatMap((b) => b.items.filter((i) => !isMedicine(i))), (i) => i.amount)),
      billed: round2(sum(vb, (b) => b.total)),
      paid: round2(sum(vb, (b) => b.paid)),
    }
  })
}

// ---- patients summary ----

export const AGE_BANDS = ['0–12', '13–18', '19–40', '41–60', '60+', 'Unknown'] as const
export type AgeBand = (typeof AGE_BANDS)[number]

export function ageBand(age: number | undefined): AgeBand {
  if (age == null) return 'Unknown'
  if (age <= 12) return '0–12'
  if (age <= 18) return '13–18'
  if (age <= 40) return '19–40'
  if (age <= 60) return '41–60'
  return '60+'
}

export interface TrendBucket {
  key: string
  newCount: number
  revisit: number
  total: number
}

export interface PatientsSummary {
  granularity: Granularity
  visits: number
  newCount: number
  revisit: number
  distinctPatients: number
  buckets: TrendBucket[]
  bySex: Record<Sex | 'U', number> // distinct patients
  byAge: Record<AgeBand, number> // distinct patients, age at their first visit in the range
}

export async function patientsSummary(range: DateRange): Promise<PatientsSummary> {
  const { visits, patients } = await visitsInRange(range)
  const firsts = await firstVisitIds(patients.keys())
  const granularity = granularityFor(range)
  const buckets = new Map(bucketKeys(range, granularity).map((k) => [k, { key: k, newCount: 0, revisit: 0, total: 0 }]))
  const bySex: PatientsSummary['bySex'] = { M: 0, F: 0, O: 0, U: 0 }
  const byAge = Object.fromEntries(AGE_BANDS.map((b) => [b, 0])) as Record<AgeBand, number>
  const seen = new Set<string>()
  let newCount = 0
  for (const v of visits) {
    const isNew = firsts.has(v.id)
    if (isNew) newCount++
    const b = buckets.get(bucketKey(v.date, granularity))!
    b.total++
    if (isNew) b.newCount++
    else b.revisit++
    if (seen.has(v.patientId)) continue
    seen.add(v.patientId)
    const p = patients.get(v.patientId)!
    bySex[p.sex ?? 'U']++
    byAge[ageBand(currentAge(p, v.date))]++
  }
  return {
    granularity,
    visits: visits.length,
    newCount,
    revisit: visits.length - newCount,
    distinctPatients: seen.size,
    buckets: [...buckets.values()],
    bySex,
    byAge,
  }
}

// ---- revenue ----

export interface RevenueBucket {
  key: string
  billed: number
  collected: number
}

export interface RevenueReport {
  granularity: Granularity
  billed: number // totals of bills dated in the range (after discount)
  collected: number // payments dated in the range, whatever the bill date
  discount: number
  consultation: number // gross lines, before discount
  medicine: number
  billCount: number
  paymentCount: number
  byMode: Record<PaymentMode, number>
  buckets: RevenueBucket[]
}

export async function revenueReport(range: DateRange): Promise<RevenueReport> {
  const granularity = granularityFor(range)
  const bills = await liveBillsInRange(range)
  const payments = await collectionsInRange(range)
  const isMedicine = medicineMatcher((await remedyMap()).values())
  const buckets = new Map(bucketKeys(range, granularity).map((k) => [k, { key: k, billed: 0, collected: 0 }]))
  const out: RevenueReport = {
    granularity,
    billed: 0,
    collected: 0,
    discount: 0,
    consultation: 0,
    medicine: 0,
    billCount: bills.length,
    paymentCount: payments.length,
    byMode: { cash: 0, upi: 0, card: 0, other: 0 },
    buckets: [],
  }
  for (const b of bills) {
    out.billed += b.total
    out.discount += b.discount
    for (const i of b.items) {
      if (isMedicine(i)) out.medicine += i.amount
      else out.consultation += i.amount
    }
    buckets.get(bucketKey(b.date, granularity))!.billed += b.total
  }
  for (const p of payments) {
    out.collected += p.amount
    out.byMode[p.mode] += p.amount
    buckets.get(bucketKey(p.date, granularity))!.collected += p.amount
  }
  for (const k of ['billed', 'collected', 'discount', 'consultation', 'medicine'] as const) out[k] = round2(out[k])
  for (const m of Object.keys(out.byMode) as PaymentMode[]) out.byMode[m] = round2(out.byMode[m])
  out.buckets = [...buckets.values()].map((b) => ({ ...b, billed: round2(b.billed), collected: round2(b.collected) }))
  return out
}

// Live payments dated in the range, on live bills of live patients.
export async function collectionsInRange({ from, to }: DateRange) {
  const ps = await db.payments.where('date').between(from, to, true, true).filter((p) => p.deleted === 0).toArray()
  const bills = new Map((await db.bills.bulkGet([...new Set(ps.map((p) => p.billId))])).flatMap((b) => (b && b.deleted === 0 ? [[b.id, b]] : [])))
  const patients = await livePatients(ps.map((p) => p.patientId))
  return ps.filter((p) => bills.has(p.billId) && patients.has(p.patientId))
}

// ---- dues ----

// Dues are a snapshot as of today: bills only keep their current balance, so
// the selected range does not apply.
export interface DuesReport {
  asOf: string
  ageing: Ageing
  total: number
  overdue: number
  patients: PatientDueRow[]
}

export async function duesReport(today: string): Promise<DuesReport> {
  const ageing = await duesAgeing(today)
  const patients = await duesByPatient(today)
  const total = round2(sum(Object.values(ageing), (a) => a.amount))
  return { asOf: today, ageing, total, overdue: round2(total - ageing.notDue.amount), patients }
}

// ---- top remedies ----

export interface TopRemedyRow {
  remedyId: string
  remedyName: string
  potency: string
  count: number // prescription rows
  patients: number // distinct patients
}

export async function topRemedies(range: DateRange, limit?: number): Promise<TopRemedyRow[]> {
  const { visits } = await visitsInRange(range)
  if (!visits.length) return []
  const rx = await db.prescriptionItems.where('visitId').anyOf(visits.map((v) => v.id)).filter((i) => i.deleted === 0).toArray()
  const remedies = await remedyMap()
  const groups = new Map<string, { row: TopRemedyRow; patients: Set<string> }>()
  for (const i of rx as PrescriptionItem[]) {
    const potency = i.potency.trim().toUpperCase()
    const key = `${i.remedyId}|${potency}`
    let g = groups.get(key)
    if (!g) {
      g = { row: { remedyId: i.remedyId, remedyName: remedies.get(i.remedyId)?.name ?? 'Unknown remedy', potency, count: 0, patients: 0 }, patients: new Set() }
      groups.set(key, g)
    }
    g.row.count++
    g.patients.add(i.patientId)
  }
  const rows = [...groups.values()].map((g) => ({ ...g.row, patients: g.patients.size }))
  rows.sort((a, b) => b.count - a.count || b.patients - a.patients || a.remedyName.localeCompare(b.remedyName))
  return limit ? rows.slice(0, limit) : rows
}

// ---- stock ----

export interface StockReportRow {
  stockItemId: string
  remedyName: string
  potency: string
  form: StockItem['form']
  unit: string
  qty: number
  lowStockAt: number
  status: StockStatus
  negative: boolean
  deleted: boolean
  used: number
  purchased: number
}

export async function stockReport(range: DateRange): Promise<StockReportRow[]> {
  const usage = new Map((await stockUsage(range.from, range.to)).map((u) => [u.stockItemId, u.dispensed]))
  const purchases = await db.stockMoves
    .where('date')
    .between(range.from, range.to, true, true)
    .filter((m) => m.deleted === 0 && m.reason === 'purchase')
    .toArray()
  const bought = new Map<string, number>()
  for (const m of purchases) bought.set(m.stockItemId, (bought.get(m.stockItemId) ?? 0) + m.delta)
  const items = await db.stockItems.toArray()
  const remedies = await remedyMap()
  const rows: StockReportRow[] = []
  for (const i of items) {
    const used = usage.get(i.id) ?? 0
    const purchased = roundQty(bought.get(i.id) ?? 0)
    // Deleted items only appear when they moved in the range.
    if (i.deleted && !used && !purchased) continue
    rows.push({
      stockItemId: i.id,
      remedyName: remedies.get(i.remedyId)?.name ?? 'Unknown remedy',
      potency: i.potency,
      form: i.form,
      unit: i.unit,
      qty: i.qty,
      lowStockAt: i.lowStockAt,
      status: stockStatus(i),
      negative: i.qty < 0,
      deleted: i.deleted === 1,
      used,
      purchased,
    })
  }
  return rows.sort((a, b) => b.used - a.used || a.remedyName.localeCompare(b.remedyName) || a.potency.localeCompare(b.potency, undefined, { numeric: true }))
}

// ---- appointments ----

export interface AppointmentsReport {
  total: number
  byStatus: Record<AppointmentStatus, number>
  attended: number // arrived + done
  noShowRate: number // no-shows / (attended + no-shows), 0..1
  walkIns: number
  booked: number // scheduled in advance (everything except walk-ins)
  granularity: Granularity
  buckets: { key: string; attended: number; noShow: number; cancelled: number }[]
}

// Walk-ins are created with the note "Walk-in" (appointmentRepo.walkIn).
export const isWalkIn = (a: { notes?: string }) => a.notes === 'Walk-in'

export async function appointmentsReport(range: DateRange): Promise<AppointmentsReport> {
  const start = parseISODate(range.from).getTime()
  const end = parseISODate(addDays(range.to, 1)).getTime()
  const raw = await db.appointments.where('start').between(start, end, true, false).filter((a) => a.deleted === 0).toArray()
  const patients = await livePatients(raw.map((a) => a.patientId))
  const rows = raw.filter((a) => patients.has(a.patientId))
  const byStatus: Record<AppointmentStatus, number> = { booked: 0, arrived: 0, done: 0, 'no-show': 0, cancelled: 0 }
  const granularity = granularityFor(range)
  const buckets = new Map(bucketKeys(range, granularity).map((k) => [k, { key: k, attended: 0, noShow: 0, cancelled: 0 }]))
  let walkIns = 0
  for (const a of rows) {
    byStatus[a.status]++
    if (isWalkIn(a)) walkIns++
    const b = buckets.get(bucketKey(toISODate(new Date(a.start)), granularity))!
    if (a.status === 'arrived' || a.status === 'done') b.attended++
    else if (a.status === 'no-show') b.noShow++
    else if (a.status === 'cancelled') b.cancelled++
  }
  const attended = byStatus.arrived + byStatus.done
  const decided = attended + byStatus['no-show']
  return {
    total: rows.length,
    byStatus,
    attended,
    noShowRate: decided ? byStatus['no-show'] / decided : 0,
    walkIns,
    booked: rows.length - walkIns,
    granularity,
    buckets: [...buckets.values()],
  }
}

// ---- dashboard trend ----

export interface DailyTrend {
  date: string
  visits: number
  collected: number
}

export async function dailyTrend(range: DateRange): Promise<DailyTrend[]> {
  const { visits } = await visitsInRange(range)
  const payments = await collectionsInRange(range)
  const days = new Map(bucketKeys(range, 'day').map((d) => [d, { date: d, visits: 0, collected: 0 }]))
  for (const v of visits) days.get(v.date)!.visits++
  for (const p of payments) days.get(p.date)!.collected += p.amount
  return [...days.values()].map((d) => ({ ...d, collected: round2(d.collected) }))
}

// ---- helpers ----

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const r of rows) {
    const k = key(r)
    const list = m.get(k)
    if (list) list.push(r)
    else m.set(k, [r])
  }
  return m
}

function sum<T>(rows: T[], f: (r: T) => number): number {
  return rows.reduce((s, r) => s + f(r), 0)
}
