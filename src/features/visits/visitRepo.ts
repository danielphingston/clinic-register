import { db } from '../../db/db'
import { insert, softDelete, update } from '../../db/repo'
import type { CaseNotes, ComplaintDetail, Patient, PrescriptionItem, Visit } from '../../db/types'
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

function byDateThenCreated(a: Visit, b: Visit) {
  return a.date.localeCompare(b.date) || a.createdAt - b.createdAt
}

export async function visitsForPatient(patientId: string): Promise<Visit[]> {
  const rows = await db.visits.where('patientId').equals(patientId).filter((v) => v.deleted === 0).toArray()
  return rows.sort(byDateThenCreated).reverse()
}

// Terms used before in each free-text complaint field, for suggestions.
export type TermField = 'location' | 'sensation' | 'duration' | 'concomitants'

export async function knownComplaintTerms(): Promise<Record<TermField, string[]>> {
  const rows = await db.visits.where('deleted').equals(0).toArray()
  const details = rows.flatMap((v) => v.caseNotes?.complaintDetails ?? [])
  const collect = (f: keyof ComplaintDetail) => {
    const seen = new Map<string, string>()
    for (const d of details) {
      const t = d[f]?.trim()
      if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t)
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b))
  }
  return { location: collect('location'), sensation: collect('sensation'), duration: collect('duration'), concomitants: collect('concomitants') }
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
