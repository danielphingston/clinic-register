import { db } from '../../db/db'
import type { BaseRecord } from '../../db/types'
import { toISODate, todayISO } from '../../lib/format'
import { remedyMap } from '../remedies/remedyRepo'
import { checklistSummary, statusSummary } from '../visits/caseNotes'
import { buildSheetsWorkbook } from './excel'

type Row = Record<string, string | number | undefined>

const live = <T extends BaseRecord>(rows: T[]) => rows.filter((r) => r.deleted === 0)

// Every live record, one sheet per table, for the clinic's own records.
// Dates stay ISO (YYYY-MM-DD) so the sheets sort and filter correctly.
export async function allDataSheets(): Promise<{ name: string; rows: Row[] }[]> {
  const [patients, visits, rx, bills, payments, stockItems, stockMoves] = await Promise.all([
    db.patients.toArray(),
    db.visits.toArray(),
    db.prescriptionItems.toArray(),
    db.bills.toArray(),
    db.payments.toArray(),
    db.stockItems.toArray(),
    db.stockMoves.toArray(),
  ])
  const remedies = await remedyMap()
  const opNo = new Map(patients.map((p) => [p.id, p.opNo]))
  const name = new Map(patients.map((p) => [p.id, p.name]))
  const billNo = new Map(bills.map((b) => [b.id, b.billNo]))
  const remedy = (id: string) => remedies.get(id)?.name ?? ''
  const stockLabel = new Map(stockItems.map((s) => [s.id, `${remedy(s.remedyId)} ${s.potency} ${s.form}`]))
  const byDate = <T extends { date: string; createdAt: number }>(a: T, b: T) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt

  return [
    {
      name: 'Patients',
      rows: live(patients)
        .sort((a, b) => a.opNo.localeCompare(b.opNo))
        .map((p) => ({ 'OP No': p.opNo, Name: p.name, DOB: p.dob, Age: p.age, 'Age as of': p.ageAsOf, Sex: p.sex, Phone: p.phone, Address: p.address, Notes: p.notes, Registered: toISODate(new Date(p.createdAt)) })),
    },
    {
      name: 'Visits',
      rows: live(visits)
        .sort(byDate)
        .map((v) => ({
          Date: v.date,
          'OP No': opNo.get(v.patientId),
          Name: name.get(v.patientId),
          Complaint: v.caseNotes?.complaint,
          History: v.caseNotes?.history,
          Mentals: v.caseNotes?.mentals,
          Generals: v.caseNotes?.generals,
          'Generals checklist': checklistSummary(v.caseNotes?.generalsChecklist),
          'Complaint status': statusSummary(v.caseNotes?.complaintStatus).join('; '),
          Modalities: v.caseNotes?.modalities,
          Constitution: v.caseNotes?.constitution,
          Advice: v.advice,
          'Follow-up': v.followUpDate,
          'Visit id': v.id,
        })),
    },
    {
      name: 'Prescriptions',
      rows: live(rx).map((i) => ({
        'Visit id': i.visitId,
        'OP No': opNo.get(i.patientId),
        Remedy: remedy(i.remedyId),
        Potency: i.potency,
        Dose: i.dose,
        Repetition: i.repetition,
        'Duration (days)': i.durationDays,
        'Qty dispensed': i.qtyDispensed,
        'Stock item': i.stockItemId ? stockLabel.get(i.stockItemId) : undefined,
      })),
    },
    {
      name: 'Bills',
      rows: live(bills)
        .sort(byDate)
        .map((b) => ({
          'Bill No': b.billNo,
          Date: b.date,
          'OP No': opNo.get(b.patientId),
          Name: name.get(b.patientId),
          Items: b.items.map((i) => `${i.desc}: ${i.amount}`).join('; '),
          Discount: b.discount,
          Total: b.total,
          Paid: b.paid,
          Balance: b.balance,
          'Due date': b.dueDate,
        })),
    },
    {
      name: 'Payments',
      rows: live(payments)
        .sort(byDate)
        .map((p) => ({ 'Receipt No': p.receiptNo, Date: p.date, 'Bill No': billNo.get(p.billId), 'OP No': opNo.get(p.patientId), Name: name.get(p.patientId), Mode: p.mode, Amount: p.amount })),
    },
    {
      name: 'Stock',
      rows: live(stockItems).map((s) => ({ Remedy: remedy(s.remedyId), Potency: s.potency, Form: s.form, Unit: s.unit, Qty: s.qty, 'Low stock at': s.lowStockAt, Price: s.price })),
    },
    {
      name: 'Stock moves',
      rows: live(stockMoves)
        .sort(byDate)
        .map((m) => ({ Date: m.date, Item: stockLabel.get(m.stockItemId), Reason: m.reason, Change: m.delta, Note: m.note })),
    },
  ]
}

export function allDataFileName(today = todayISO()): string {
  return `clinic-data-${today}.xlsx`
}

export async function exportAllData(): Promise<void> {
  const [X, sheets] = await Promise.all([import('xlsx'), allDataSheets()])
  X.writeFile(buildSheetsWorkbook(X, sheets), allDataFileName(), { compression: true })
}
