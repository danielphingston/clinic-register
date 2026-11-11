import { db } from '../../db/db'
import type { ComplaintStatusValue, Patient, Visit } from '../../db/types'
import { bucketKeys, type DateRange } from '../../lib/dateRange'
import { addDays, daysBetween, parseISODate, toISODate } from '../../lib/format'
import type { TrendWindow, TrendWindows } from '../../lib/period'
import { round2 } from '../billing/billingRepo'
import { livePatients, topRemedies, visitsInRange, type TopRemedyRow, type TrendTotals } from './reportQueries'

// The Trends report's extra sections: collection health, follow-ups, busy
// days and no-shows, and clinical trends. Like the report queries, these
// skip deleted records and records of deleted patients.

// ---- collection health ----

// Outstanding at the end of `date`: live bills dated up to then, less the
// live payments on them dated up to then. Reversed payments and voided bills
// are deleted records, so they never count.
export async function duesAsOf(date: string): Promise<number> {
  const bills = await db.bills.where('date').belowOrEqual(date).filter((b) => b.deleted === 0).toArray()
  const patients = await livePatients(bills.map((b) => b.patientId))
  const live = bills.filter((b) => patients.has(b.patientId))
  if (!live.length) return 0
  const pays = await db.payments
    .where('billId')
    .anyOf(live.map((b) => b.id))
    .filter((p) => p.deleted === 0 && p.date <= date)
    .toArray()
  const paid = new Map<string, number>()
  for (const p of pays) paid.set(p.billId, (paid.get(p.billId) ?? 0) + p.amount)
  return round2(live.reduce((s, b) => s + Math.max(0, b.total - (paid.get(b.id) ?? 0)), 0))
}

// ---- follow-ups ----

// A patient came back on time when their next visit is within this many days
// of the follow-up date, either side.
export const FOLLOW_UP_DAYS = 7

export interface FollowUpStats {
  due: number // follow-up dates inside the window
  onTime: number
  early: number // came back more than FOLLOW_UP_DAYS before the date
  late: number // came back more than FOLLOW_UP_DAYS after the date
  missed: number // not back, and the date is more than FOLLOW_UP_DAYS past
  pending: number // not back yet, but still within FOLLOW_UP_DAYS of the date
  rate: number | null // onTime ÷ (due − pending)
}

// Live visit dates per patient, ascending.
async function visitDates(patientIds: Iterable<string>): Promise<Map<string, Visit[]>> {
  const all = await db.visits.where('patientId').anyOf([...new Set(patientIds)]).filter((v) => v.deleted === 0).toArray()
  const map = new Map<string, Visit[]>()
  for (const v of all) {
    const list = map.get(v.patientId)
    if (list) list.push(v)
    else map.set(v.patientId, [v])
  }
  for (const list of map.values()) list.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
  return map
}

export async function followUpStats(range: DateRange, today: string): Promise<FollowUpStats> {
  const raw = await db.visits.where('followUpDate').between(range.from, range.to, true, true).filter((v) => v.deleted === 0).toArray()
  const patients = await livePatients(raw.map((v) => v.patientId))
  const due = raw.filter((v) => patients.has(v.patientId))
  const byPatient = await visitDates(due.map((v) => v.patientId))
  const out: FollowUpStats = { due: due.length, onTime: 0, early: 0, late: 0, missed: 0, pending: 0, rate: null }
  for (const v of due) {
    const next = byPatient.get(v.patientId)?.find((n) => n.date > v.date)
    const fu = v.followUpDate!
    if (next) {
      const off = daysBetween(fu, next.date)
      if (off < -FOLLOW_UP_DAYS) out.early++
      else if (off > FOLLOW_UP_DAYS) out.late++
      else out.onTime++
    } else if (daysBetween(fu, today) > FOLLOW_UP_DAYS) out.missed++
    else out.pending++
  }
  const decided = out.due - out.pending
  out.rate = decided ? out.onTime / decided : null
  return out
}

// New patients who never came back.
export interface NotSeenAgainRow {
  patient: Patient
  firstVisit: string
  followUpDate?: string
}

// When there is no follow-up date, a patient is expected back within this
// many days of the first visit.
export const EXPECT_BACK_DAYS = 30

// Patients whose first visit falls in the window and who have had no visit
// since, once they are more than FOLLOW_UP_DAYS past the day they were due
// back (their follow-up date, or EXPECT_BACK_DAYS after the visit).
export async function notSeenAgain(range: DateRange, today: string): Promise<NotSeenAgainRow[]> {
  const { patients } = await visitsInRange(range)
  const byPatient = await visitDates(patients.keys())
  const rows: NotSeenAgainRow[] = []
  for (const [id, visits] of byPatient) {
    const first = visits[0]
    if (first.date < range.from || first.date > range.to) continue
    if (visits.some((v) => v.date > first.date)) continue
    // The latest same-day entry carries the follow-up date that was set.
    const fu = visits.filter((v) => v.date === first.date && v.followUpDate).pop()?.followUpDate
    if (daysBetween(fu ?? addDays(first.date, EXPECT_BACK_DAYS), today) <= FOLLOW_UP_DAYS) continue
    rows.push({ patient: patients.get(id)!, firstVisit: first.date, followUpDate: fu })
  }
  return rows.sort((a, b) => a.firstVisit.localeCompare(b.firstVisit) || a.patient.name.localeCompare(b.patient.name))
}

// ---- busy days and no-shows ----

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

const weekdayOf = (iso: string) => (parseISODate(iso).getDay() + 6) % 7 // Monday = 0

export interface WeekdayRow {
  day: (typeof WEEKDAYS)[number]
  visits: number
  days: number // how many of this weekday the window has
  average: number // visits per such day, to one decimal
}

export interface NoShows {
  appointments: number
  attended: number // arrived or done
  noShows: number
  rate: number | null // no-shows ÷ (attended + no-shows)
}

export interface BusyDays {
  byWeekday: WeekdayRow[]
  // Attended appointments (arrived or done) by weekday and start hour.
  hours: number[] // from the first to the last hour with any, ascending
  heat: number[][] // [weekday][index into hours]
}

async function appointmentsIn(range: DateRange) {
  const start = parseISODate(range.from).getTime()
  const end = parseISODate(addDays(range.to, 1)).getTime()
  const raw = await db.appointments.where('start').between(start, end, true, false).filter((a) => a.deleted === 0).toArray()
  const patients = await livePatients(raw.map((a) => a.patientId))
  return raw.filter((a) => patients.has(a.patientId))
}

const attended = (s: string) => s === 'arrived' || s === 'done'

export async function noShows(range: DateRange): Promise<NoShows> {
  const appts = await appointmentsIn(range)
  const came = appts.filter((a) => attended(a.status)).length
  const missed = appts.filter((a) => a.status === 'no-show').length
  return { appointments: appts.length, attended: came, noShows: missed, rate: came + missed ? missed / (came + missed) : null }
}

export async function busyDays(range: DateRange): Promise<BusyDays> {
  const { visits } = await visitsInRange(range)
  const counts = WEEKDAYS.map(() => 0)
  const days = WEEKDAYS.map(() => 0)
  for (const d of bucketKeys(range, 'day')) days[weekdayOf(d)]++
  for (const v of visits) counts[weekdayOf(v.date)]++
  const byWeekday = WEEKDAYS.map((day, i) => ({ day, visits: counts[i], days: days[i], average: days[i] ? Math.round((counts[i] / days[i]) * 10) / 10 : 0 }))

  const appts = (await appointmentsIn(range)).filter((a) => attended(a.status))
  // Every hour from the first to the last, so quiet hours show as gaps.
  const seen = appts.map((a) => new Date(a.start).getHours())
  const hours = seen.length ? Array.from({ length: Math.max(...seen) - Math.min(...seen) + 1 }, (_, i) => Math.min(...seen) + i) : []
  const heat = WEEKDAYS.map(() => hours.map(() => 0))
  for (const a of appts) heat[weekdayOf(toISODate(new Date(a.start)))][hours.indexOf(new Date(a.start).getHours())]++
  return { byWeekday, hours, heat }
}

// ---- clinical trends ----

export interface Outcomes {
  reviewed: number // complaint statuses recorded at visits in the window
  byStatus: Record<ComplaintStatusValue, number>
  improvedRate: number | null // (better + resolved) ÷ reviewed
}

// How the previous visit's complaints were at the visits in the window.
export async function complaintOutcomes(range: DateRange): Promise<Outcomes> {
  const { visits } = await visitsInRange(range)
  const byStatus: Record<ComplaintStatusValue, number> = { resolved: 0, better: 0, persists: 0, worse: 0 }
  for (const v of visits) for (const s of v.caseNotes?.complaintStatus ?? []) byStatus[s.status]++
  const reviewed = byStatus.resolved + byStatus.better + byStatus.persists + byStatus.worse
  return { reviewed, byStatus, improvedRate: reviewed ? (byStatus.better + byStatus.resolved) / reviewed : null }
}

export interface DiagnosisRow {
  diagnosis: string // as first written
  patients: number // distinct patients seen in the window with it
}

// Diagnoses of the patients seen in the window, ignoring case and spacing.
export async function topDiagnoses(range: DateRange): Promise<DiagnosisRow[]> {
  const { patients } = await visitsInRange(range)
  const groups = new Map<string, DiagnosisRow>()
  for (const p of patients.values()) {
    for (const key of new Set((p.diagnoses ?? []).map((d) => d.trim().replace(/\s+/g, ' ')).filter(Boolean))) {
      const k = key.toLowerCase()
      const g = groups.get(k)
      if (g) g.patients++
      else groups.set(k, { diagnosis: key, patients: 1 })
    }
  }
  return [...groups.values()].sort((a, b) => b.patients - a.patients || a.diagnosis.localeCompare(b.diagnosis))
}

// ---- per window ----

export interface InsightTotals {
  perVisit: number | null // collected ÷ visits
  collectionRate: number | null // collected ÷ billed
  duesEnd: number // outstanding at the window's last day
  followUps: FollowUpStats
  notSeenAgain: number
  noShows: NoShows
  outcomes: Outcomes
}

async function insightTotals(w: TrendWindow, t: TrendTotals, today: string): Promise<InsightTotals> {
  return {
    perVisit: t.visits ? round2(t.collected / t.visits) : null,
    collectionRate: t.billed ? t.collected / t.billed : null,
    duesEnd: await duesAsOf(w.range.to),
    followUps: await followUpStats(w.range, today),
    notSeenAgain: (await notSeenAgain(w.range, today)).length,
    noShows: await noShows(w.range),
    outcomes: await complaintOutcomes(w.range),
  }
}

export interface TrendsInsights {
  current: InsightTotals
  previous: InsightTotals
  lastYear: InsightTotals
  duesStart: number // outstanding the day before the period began
  notSeenAgain: NotSeenAgainRow[]
  busy: BusyDays
  diagnoses: { current: DiagnosisRow[]; previous: Map<string, number> } // previous keyed by lower-case diagnosis
  remedies: { current: TopRemedyRow[]; previous: Map<string, number> } // previous keyed by remedyId|potency
}

export const remedyKey = (r: Pick<TopRemedyRow, 'remedyId' | 'potency'>) => `${r.remedyId}|${r.potency}`

export async function trendsInsights(windows: TrendWindows, totals: { current: TrendTotals; previous: TrendTotals; lastYear: TrendTotals }, today: string): Promise<TrendsInsights> {
  const { current: cw, previous: pw } = windows
  const prevDiagnoses = await topDiagnoses(pw.range)
  const prevRemedies = await topRemedies(pw.range)
  return {
    current: await insightTotals(cw, totals.current, today),
    previous: await insightTotals(pw, totals.previous, today),
    lastYear: await insightTotals(windows.lastYear, totals.lastYear, today),
    duesStart: await duesAsOf(addDays(cw.range.from, -1)),
    notSeenAgain: await notSeenAgain(cw.range, today),
    busy: await busyDays(cw.range),
    diagnoses: { current: await topDiagnoses(cw.range), previous: new Map(prevDiagnoses.map((d) => [d.diagnosis.toLowerCase(), d.patients])) },
    remedies: { current: await topRemedies(cw.range), previous: new Map(prevRemedies.map((r) => [remedyKey(r), r.count])) },
  }
}
