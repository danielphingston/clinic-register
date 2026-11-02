import { db } from '../../db/db'
import { insert, softDelete, update } from '../../db/repo'
import { formatDate, todayISO } from '../../lib/format'
import type { CaseNotes, Patient, PrescriptionItem, Visit } from '../../db/types'
import { roundQty } from '../stock/stockLogic'
import { syncDispense } from '../stock/stockRepo'

export interface RxInput {
  id?: string // existing PrescriptionItem id
  remedyId: string
  potency: string
  dose?: string
  repetition?: string
  durationDays?: number
  stockItemId?: string // dispensed from this stock item
  qtyDispensed?: number
}

export interface VisitInput {
  id?: string
  patientId: string
  date: string
  caseNotes: CaseNotes
  advice?: string
  followUpDate?: string
  items: RxInput[]
}

function rxFields(r: RxInput, order: number) {
  return {
    order,
    remedyId: r.remedyId,
    potency: r.potency.trim(),
    dose: r.dose?.trim() || undefined,
    repetition: r.repetition?.trim() || undefined,
    durationDays: r.durationDays && r.durationDays > 0 ? r.durationDays : undefined,
    ...dispenseFields(r),
  }
}

function dispenseFields(r: RxInput): { stockItemId?: string; qtyDispensed?: number } {
  if (r.qtyDispensed != null && (!Number.isFinite(r.qtyDispensed) || r.qtyDispensed < 0)) throw new Error('Dispensed quantity cannot be negative')
  if (!r.stockItemId || !r.qtyDispensed) return { stockItemId: r.stockItemId || undefined, qtyDispensed: undefined }
  return { stockItemId: r.stockItemId, qtyDispensed: roundQty(r.qtyDispensed) }
}

// Creates or updates a visit and its prescription in one transaction. Items
// that were saved before but are missing from `items` are soft-deleted.
// Dispensed stock follows the prescription: each row's stock moves are
// corrected to match its current stock item and qty (removed rows reverse).
export async function saveVisit(input: VisitInput): Promise<string> {
  return db.transaction('rw', [db.visits, db.prescriptionItems, db.stockItems, db.stockMoves], async () => {
    const fields = {
      patientId: input.patientId,
      date: input.date,
      caseNotes: input.caseNotes,
      advice: input.advice?.trim() || undefined,
      followUpDate: input.followUpDate || undefined,
    }
    let visitId = input.id
    if (visitId) await update<Visit>(db.visits, visitId, fields)
    else visitId = (await insert<Visit>(db.visits, fields)).id

    const existing = await db.prescriptionItems.where('visitId').equals(visitId).filter((i) => i.deleted === 0).toArray()
    const keep = new Set(input.items.map((i) => i.id).filter(Boolean))
    for (const old of existing) {
      if (keep.has(old.id)) continue
      await softDelete(db.prescriptionItems, old.id)
      await syncDispense(old, null, input.date)
    }

    for (const [n, item] of input.items.entries()) {
      const fields = rxFields(item, n)
      let rxId = item.id
      if (rxId && existing.some((e) => e.id === rxId)) {
        await update<PrescriptionItem>(db.prescriptionItems, rxId, fields)
      } else {
        rxId = (await insert<PrescriptionItem>(db.prescriptionItems, { visitId, patientId: input.patientId, ...fields })).id
      }
      await syncDispense({ id: rxId, remedyId: fields.remedyId, potency: fields.potency }, { stockItemId: fields.stockItemId, qty: fields.qtyDispensed }, input.date)
    }
    return visitId
  })
}

export interface VisitDeleteBlocker {
  reason: string
  to?: string // where the user can resolve it
}

export class VisitDeleteError extends Error {
  blockers: VisitDeleteBlocker[]
  constructor(blockers: VisitDeleteBlocker[]) {
    super(blockers.map((b) => b.reason).join(' '))
    this.blockers = blockers
  }
}

// Why a visit can't be deleted yet. Voided bills and cancelled certificates
// are tombstones, so they don't block. Appointments don't reference visits.
export async function visitDeleteBlockers(visitId: string): Promise<VisitDeleteBlocker[]> {
  const visit = await db.visits.get(visitId)
  if (!visit || visit.deleted) return []
  const out: VisitDeleteBlocker[] = []
  const profile = `/patients/${visit.patientId}`

  // The latest later visit is the one to delete first.
  const later = (await visitsForPatient(visit.patientId)).find((v) => v.id !== visit.id && byDateThenCreated(v, visit) > 0)
  if (later) out.push({ reason: `Has a follow-up visit on ${formatDate(later.date)}. Delete that visit first.`, to: `${profile}/visits/${later.id}` })

  const bills = await db.bills.where('visitId').equals(visitId).filter((b) => b.deleted === 0).toArray()
  for (const b of bills) out.push({ reason: `Linked to bill ${b.billNo} — void it first.`, to: profile })

  const certs = await db.certificates.where('visitId').equals(visitId).filter((c) => c.deleted === 0).toArray()
  for (const c of certs) out.push({ reason: `Certificate ${c.certNo} — cancel it first.`, to: profile })

  const files = await db.attachments.where('visitId').equals(visitId).filter((a) => a.deleted === 0).count()
  if (files > 0) out.push({ reason: `${files} attachment(s) — delete them first.`, to: `${profile}/visits/${visitId}` })
  return out
}

// Soft-deletes a visit with its prescription and returns any dispensed stock.
// Refuses (VisitDeleteError) while follow-ups, bills, certificates or
// attachments still depend on it.
export async function deleteVisit(visitId: string): Promise<void> {
  await db.transaction('rw', [db.visits, db.prescriptionItems, db.stockItems, db.stockMoves, db.bills, db.certificates, db.attachments], async () => {
    const visit = await db.visits.get(visitId)
    if (!visit || visit.deleted) throw new Error('Visit not found')
    const blockers = await visitDeleteBlockers(visitId)
    if (blockers.length) throw new VisitDeleteError(blockers)
    for (const item of await itemsForVisit(visitId)) {
      await softDelete(db.prescriptionItems, item.id)
      await syncDispense(item, null, todayISO())
    }
    await softDelete(db.visits, visitId)
  })
}

function byDateThenCreated(a: Visit, b: Visit) {
  return a.date.localeCompare(b.date) || a.createdAt - b.createdAt
}

export async function visitsForPatient(patientId: string): Promise<Visit[]> {
  const rows = await db.visits.where('patientId').equals(patientId).filter((v) => v.deleted === 0).toArray()
  return rows.sort(byDateThenCreated).reverse()
}

// Terms used before in the complaint cards, for suggestions.
export type TermField = 'complaint' | 'duration' | 'aggravation' | 'amelioration'

export async function knownComplaintTerms(): Promise<Record<TermField, string[]>> {
  const rows = await db.visits.where('deleted').equals(0).toArray()
  const details = rows.flatMap((v) => v.caseNotes?.complaintDetails ?? [])
  const collect = (f: TermField) => {
    const seen = new Map<string, string>()
    for (const d of details) {
      for (const raw of [d[f]].flat()) {
        const t = raw?.trim()
        if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t)
      }
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b))
  }
  return { complaint: collect('complaint'), duration: collect('duration'), aggravation: collect('aggravation'), amelioration: collect('amelioration') }
}

// Items saved in one transaction can share a createdAt, so `order` decides.
export function byRxOrder(a: PrescriptionItem, b: PrescriptionItem): number {
  return (a.order ?? 0) - (b.order ?? 0) || a.createdAt - b.createdAt
}

export async function itemsForVisit(visitId: string): Promise<PrescriptionItem[]> {
  const rows = await db.prescriptionItems.where('visitId').equals(visitId).filter((i) => i.deleted === 0).toArray()
  return rows.sort(byRxOrder)
}

// The visit before `current` (or the latest one when creating a new visit).
export async function previousVisit(patientId: string, current?: Visit): Promise<Visit | undefined> {
  const visits = await visitsForPatient(patientId)
  if (!current) return visits[0]
  return visits.find((v) => v.id !== current.id && byDateThenCreated(v, current) < 0)
}

export interface FollowUpDue {
  patient: Patient
  visit: Visit
  followUpDate: string
  overdue: boolean
}

// A follow-up is due when the patient's latest visit asks for one on or
// before today; any later visit means the patient already came back.
export async function followUpsDue(today: string): Promise<FollowUpDue[]> {
  const candidates = await db.visits.where('followUpDate').belowOrEqual(today).filter((v) => v.deleted === 0).toArray()
  const patientIds = [...new Set(candidates.map((v) => v.patientId))]
  const out: FollowUpDue[] = []
  for (const pid of patientIds) {
    const patient = await db.patients.get(pid)
    if (!patient || patient.deleted) continue
    const latest = (await visitsForPatient(pid))[0]
    if (latest?.followUpDate && latest.followUpDate <= today) {
      out.push({ patient, visit: latest, followUpDate: latest.followUpDate, overdue: latest.followUpDate < today })
    }
  }
  return out.sort((a, b) => a.followUpDate.localeCompare(b.followUpDate))
}

export interface RecentPatient {
  patient: Patient
  lastVisit: Visit
}

export async function recentPatients(limit = 5): Promise<RecentPatient[]> {
  const out: RecentPatient[] = []
  const seen = new Set<string>()
  // Only the newest visits matter; the cap keeps this cheap as history grows.
  const recent = await db.visits.orderBy('date').reverse().filter((v) => v.deleted === 0).limit(limit * 20).toArray()
  recent.sort(byDateThenCreated).reverse()
  for (const v of recent) {
    if (out.length >= limit) break
    if (seen.has(v.patientId)) continue
    seen.add(v.patientId)
    const patient = await db.patients.get(v.patientId)
    if (patient && !patient.deleted) out.push({ patient, lastVisit: v })
  }
  return out
}
