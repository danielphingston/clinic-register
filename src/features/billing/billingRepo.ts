import { db } from '../../db/db'
import { getSettings, newRecord, nextSequence } from '../../db/repo'
import type { Bill, BillItem, Patient, Payment, PaymentMode } from '../../db/types'
import { addDays, daysBetween, formatINR, todayISO } from '../../lib/format'
import { syncBillSale } from '../stock/stockRepo'

export class BillingError extends Error {}

export const PAYMENT_MODES: { value: PaymentMode; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'other', label: 'Other' },
]

export const MODE_LABEL: Record<PaymentMode, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', other: 'Other' }

export type BillStatus = 'paid' | 'partial' | 'unpaid'
export type BillWithPatient = Bill & { patient: Patient }

// Money is kept in rupees rounded to paise; this avoids 0.1 + 0.2 drift.
export const round2 = (n: number) => Math.round(n * 100) / 100

export function billStatus(b: Pick<Bill, 'balance' | 'paid'>): BillStatus {
  if (b.balance <= 0) return 'paid'
  return b.paid > 0 ? 'partial' : 'unpaid'
}

export function isOverdue(b: Pick<Bill, 'balance' | 'dueDate' | 'date'>, today: string): boolean {
  return b.balance > 0 && (b.dueDate ?? b.date) < today
}

function cleanItems(items: BillItem[]): BillItem[] {
  return items.map((i) => {
    const out: BillItem = { desc: i.desc.trim(), amount: round2(i.amount) }
    if (i.stockItemId) out.stockItemId = i.stockItemId
    if (i.qty != null) out.qty = i.qty
    if (i.sale && i.stockItemId) {
      if (!(i.qty != null && i.qty > 0)) throw new BillingError(`Enter a quantity for "${i.desc.trim()}"`)
      out.sale = true
    }
    return out
  })
}

// Quantity per stock item that a bill sells over the counter.
function saleTargets(items: BillItem[]): Map<string, number> {
  const want = new Map<string, number>()
  for (const i of items) if (i.sale && i.stockItemId && i.qty) want.set(i.stockItemId, (want.get(i.stockItemId) ?? 0) + i.qty)
  return want
}

// Validates items/discount and returns the bill total.
export function billTotal(items: BillItem[], discount: number): number {
  if (items.length === 0) throw new BillingError('Add at least one item')
  for (const i of items) {
    if (!i.desc.trim()) throw new BillingError('Every item needs a description')
    // Medicine lines may be ₹0 (unpriced stock, free samples); they still
    // record what was handed over. Other lines must charge something.
    const min0 = !!i.stockItemId
    if (!Number.isFinite(i.amount) || i.amount < 0 || (!min0 && i.amount === 0)) {
      throw new BillingError(`Enter an amount above zero for "${i.desc.trim()}"`)
    }
  }
  if (!items.some((i) => i.amount > 0)) throw new BillingError('Enter an amount above zero for at least one item')
  if (!Number.isFinite(discount) || discount < 0) throw new BillingError('Discount cannot be negative')
  const total = round2(items.reduce((s, i) => s + round2(i.amount), 0) - round2(discount))
  if (total < 0) throw new BillingError('Discount cannot exceed the bill amount')
  return total
}

function checkAmount(amount: number) {
  if (!Number.isFinite(amount) || round2(amount) <= 0) throw new BillingError('Enter an amount above zero')
}

async function livePatient(id: string): Promise<Patient> {
  const p = await db.patients.get(id)
  if (!p || p.deleted) throw new BillingError('Patient not found')
  return p
}

async function liveBill(id: string): Promise<Bill> {
  const b = await db.bills.get(id)
  if (!b || b.deleted) throw new BillingError('Bill not found')
  return b
}

const seqNo = (prefix: string, iso: string, n: number) => `${prefix}-${iso.slice(0, 4)}-${String(n).padStart(5, '0')}`

async function defaultDueDate(): Promise<string> {
  const s = await getSettings()
  return addDays(todayISO(), s.defaultDueDays > 0 ? s.defaultDueDays : 30)
}

// Must run inside a transaction covering bills, payments and kv.
async function addPayment(bill: Bill, amount: number, mode: PaymentMode, date: string): Promise<Payment> {
  checkAmount(amount)
  const amt = round2(amount)
  if (amt > bill.balance) throw new BillingError(`Amount exceeds the balance of ${formatINR(bill.balance)}`)
  const n = await nextSequence(`rcpt:${date.slice(0, 4)}`)
  const payment = newRecord<Payment>({
    billId: bill.id,
    patientId: bill.patientId,
    amount: amt,
    mode,
    date,
    receiptNo: seqNo('RCPT', date, n),
  })
  await db.payments.add(payment)
  const paid = round2(bill.paid + amt)
  const balance = round2(bill.total - paid)
  await db.bills.update(bill.id, { paid, balance, updatedAt: Date.now() })
  Object.assign(bill, { paid, balance })
  return payment
}

export interface BillInput {
  patientId: string
  visitId?: string
  date: string
  items: BillItem[]
  discount: number
  dueDate?: string
  payNow?: { amount: number; mode: PaymentMode }
}

export async function createBill(input: BillInput): Promise<{ bill: Bill; payment?: Payment }> {
  const items = cleanItems(input.items)
  const discount = round2(input.discount || 0)
  const total = billTotal(items, discount)
  if (!input.date) throw new BillingError('Enter the bill date')
  if (input.payNow && input.payNow.amount > total) throw new BillingError('Paid amount exceeds the bill total')
  const fallbackDue = await defaultDueDate()

  return db.transaction('rw', [db.bills, db.payments, db.kv, db.patients, db.stockItems, db.stockMoves], async () => {
    await livePatient(input.patientId)
    const n = await nextSequence(`bill:${input.date.slice(0, 4)}`)
    const bill = newRecord<Bill>({
      billNo: seqNo('BILL', input.date, n),
      patientId: input.patientId,
      date: input.date,
      items,
      discount,
      total,
      paid: 0,
      balance: total,
    })
    if (input.visitId) bill.visitId = input.visitId
    await db.bills.add(bill)
    await syncBillSale(bill.id, saleTargets(items), input.date, 'Counter sale')
    let payment: Payment | undefined
    if (input.payNow && input.payNow.amount) payment = await addPayment(bill, input.payNow.amount, input.payNow.mode, input.date)
    if (bill.balance > 0) {
      bill.dueDate = input.dueDate || fallbackDue
      await db.bills.update(bill.id, { dueDate: bill.dueDate })
    }
    return { bill: { ...bill }, payment }
  })
}

export async function recordPayment(billId: string, amount: number, mode: PaymentMode, date = todayISO()): Promise<Payment> {
  checkAmount(amount)
  return db.transaction('rw', [db.bills, db.payments, db.kv], async () => {
    const bill = await liveBill(billId)
    if (bill.balance <= 0) throw new BillingError('This bill is already paid')
    return addPayment(bill, amount, mode, date)
  })
}

// Unpaid bills of one patient, oldest first: the order FIFO collection settles them.
async function unpaidBills(patientId: string): Promise<Bill[]> {
  const bills = await db.bills
    .where('patientId')
    .equals(patientId)
    .filter((b) => b.deleted === 0 && b.balance > 0)
    .toArray()
  return bills.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
}

// Spreads one payment across the patient's oldest unpaid bills.
export async function collectFromPatient(
  patientId: string,
  amount: number,
  mode: PaymentMode,
  date = todayISO(),
): Promise<Payment[]> {
  checkAmount(amount)
  return db.transaction('rw', [db.bills, db.payments, db.kv, db.patients], async () => {
    await livePatient(patientId)
    const bills = await unpaidBills(patientId)
    const due = round2(bills.reduce((s, b) => s + b.balance, 0))
    if (due <= 0) throw new BillingError('No dues for this patient')
    let left = round2(amount)
    if (left > due) throw new BillingError(`Amount exceeds the total dues of ${formatINR(due)}`)
    const payments: Payment[] = []
    for (const b of bills) {
      if (left <= 0) break
      const part = Math.min(left, b.balance)
      payments.push(await addPayment(b, part, mode, date))
      left = round2(left - part)
    }
    return payments
  })
}

export async function paymentsForBill(billId: string): Promise<Payment[]> {
  const ps = await db.payments
    .where('billId')
    .equals(billId)
    .filter((p) => p.deleted === 0)
    .toArray()
  return ps.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
}

export interface BillEdit {
  items: BillItem[]
  discount: number
  date?: string
  dueDate?: string
}

// Once a payment exists only items, discount and due date may change, and the
// new total must still cover what was paid.
export async function editBill(id: string, edit: BillEdit): Promise<Bill> {
  const items = cleanItems(edit.items)
  const discount = round2(edit.discount || 0)
  const total = billTotal(items, discount)
  const fallbackDue = await defaultDueDate()
  return db.transaction('rw', [db.bills, db.payments, db.stockItems, db.stockMoves], async () => {
    const bill = await liveBill(id)
    const hasPayments = (await paymentsForBill(id)).length > 0
    if (hasPayments && edit.date && edit.date !== bill.date) throw new BillingError('The date of a bill with payments cannot change')
    if (total < bill.paid) throw new BillingError(`Total cannot be less than the ${formatINR(bill.paid)} already paid`)
    const balance = round2(total - bill.paid)
    const changes: Partial<Bill> = {
      items,
      discount,
      total,
      balance,
      date: hasPayments ? bill.date : edit.date || bill.date,
      dueDate: balance > 0 ? edit.dueDate || bill.dueDate || fallbackDue : bill.dueDate,
      updatedAt: Date.now(),
    }
    await db.bills.update(id, changes)
    await syncBillSale(id, saleTargets(items), changes.date!, 'Bill edited')
    return { ...bill, ...changes }
  })
}

export async function voidBill(id: string): Promise<void> {
  await db.transaction('rw', [db.bills, db.payments, db.stockItems, db.stockMoves], async () => {
    const bill = await liveBill(id)
    if ((await paymentsForBill(id)).length > 0) throw new BillingError('Reverse the payments on this bill before voiding it')
    await db.bills.update(id, { deleted: 1, updatedAt: Date.now() })
    // Counter-sale stock goes back, dated the day of the void.
    await syncBillSale(id, new Map(), bill.date > todayISO() ? bill.date : todayISO(), 'Bill voided')
  })
}

export async function reversePayment(paymentId: string): Promise<void> {
  const fallbackDue = await defaultDueDate()
  await db.transaction('rw', [db.bills, db.payments], async () => {
    const p = await db.payments.get(paymentId)
    if (!p || p.deleted) throw new BillingError('Payment not found')
    const bill = await liveBill(p.billId)
    const paid = round2(bill.paid - p.amount)
    const balance = round2(bill.total - paid)
    await db.payments.update(paymentId, { deleted: 1, updatedAt: Date.now() })
    await db.bills.update(bill.id, { paid, balance, dueDate: bill.dueDate ?? fallbackDue, updatedAt: Date.now() })
  })
}

// ---- queries ----

async function livePatientMap(ids: Iterable<string>): Promise<Map<string, Patient>> {
  const unique = [...new Set(ids)]
  const ps = await db.patients.bulkGet(unique)
  const map = new Map<string, Patient>()
  for (const p of ps) if (p && p.deleted === 0) map.set(p.id, p)
  return map
}

async function withPatients(bills: Bill[]): Promise<BillWithPatient[]> {
  const map = await livePatientMap(bills.map((b) => b.patientId))
  return bills.flatMap((b) => {
    const patient = map.get(b.patientId)
    return patient ? [{ ...b, patient }] : []
  })
}

const newestFirst = (a: Bill, b: Bill) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt

export async function billsForPatient(patientId: string): Promise<Bill[]> {
  const bills = await db.bills
    .where('patientId')
    .equals(patientId)
    .filter((b) => b.deleted === 0)
    .toArray()
  return bills.sort(newestFirst)
}

export async function paymentsForPatient(patientId: string): Promise<Payment[]> {
  const ps = await db.payments
    .where('patientId')
    .equals(patientId)
    .filter((p) => p.deleted === 0)
    .toArray()
  const liveBills = new Set((await billsForPatient(patientId)).map((b) => b.id))
  return ps.filter((p) => liveBills.has(p.billId)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
}

export interface PatientDues {
  balance: number
  bills: Bill[] // unpaid, oldest first
  oldestDueDate?: string
}

export async function patientDues(patientId: string): Promise<PatientDues> {
  const p = await db.patients.get(patientId)
  if (!p || p.deleted) return { balance: 0, bills: [] }
  const bills = await unpaidBills(patientId)
  const dueDates = bills.map((b) => b.dueDate ?? b.date).sort()
  return { balance: round2(bills.reduce((s, b) => s + b.balance, 0)), bills, oldestDueDate: dueDates[0] }
}

async function outstandingBills(): Promise<BillWithPatient[]> {
  const bills = await db.bills
    .where('balance')
    .above(0)
    .filter((b) => b.deleted === 0)
    .toArray()
  return withPatients(bills)
}

export async function outstandingTotal(): Promise<number> {
  return round2((await outstandingBills()).reduce((s, b) => s + b.balance, 0))
}

// Oldest due date first.
export async function overdueBills(today: string): Promise<BillWithPatient[]> {
  const bills = (await outstandingBills()).filter((b) => isOverdue(b, today))
  return bills.sort((a, b) => (a.dueDate ?? a.date).localeCompare(b.dueDate ?? b.date))
}

export type AgeingKey = 'notDue' | 'd0_30' | 'd31_60' | 'd61_90' | 'd90plus'

export const AGEING_LABEL: Record<AgeingKey, string> = {
  notDue: 'Not yet due',
  d0_30: '0–30 days',
  d31_60: '31–60 days',
  d61_90: '61–90 days',
  d90plus: '90+ days',
}

export type Ageing = Record<AgeingKey, { count: number; amount: number }>

// Days past the due date. Due today (0 days) is not overdue yet, matching
// isOverdue(), so it counts as "not yet due"; the 0–30 bucket starts at 1 day.
export function ageingBucket(dueDate: string, today: string): AgeingKey {
  const days = daysBetween(dueDate, today)
  if (days <= 0) return 'notDue'
  if (days <= 30) return 'd0_30'
  if (days <= 60) return 'd31_60'
  if (days <= 90) return 'd61_90'
  return 'd90plus'
}

export async function duesAgeing(today: string): Promise<Ageing> {
  const out = Object.fromEntries(
    (Object.keys(AGEING_LABEL) as AgeingKey[]).map((k) => [k, { count: 0, amount: 0 }]),
  ) as Ageing
  for (const b of await outstandingBills()) {
    const bucket = out[ageingBucket(b.dueDate ?? b.date, today)]
    bucket.count++
    bucket.amount = round2(bucket.amount + b.balance)
  }
  return out
}

export interface Collections {
  total: number
  count: number
  byMode: Record<PaymentMode, number>
}

export async function collectionsForDay(date: string): Promise<Collections> {
  const ps = await db.payments
    .where('date')
    .equals(date)
    .filter((p) => p.deleted === 0)
    .toArray()
  const patients = await livePatientMap(ps.map((p) => p.patientId))
  const out: Collections = { total: 0, count: 0, byMode: { cash: 0, upi: 0, card: 0, other: 0 } }
  for (const p of ps) {
    if (!patients.has(p.patientId)) continue
    out.total = round2(out.total + p.amount)
    out.byMode[p.mode] = round2(out.byMode[p.mode] + p.amount)
    out.count++
  }
  return out
}

export type BillFilterStatus = 'all' | BillStatus | 'overdue'

export interface BillFilter {
  status?: BillFilterStatus
  from?: string
  to?: string
  search?: string
  today?: string
}

export async function billsList(filter: BillFilter = {}): Promise<BillWithPatient[]> {
  const today = filter.today ?? todayISO()
  let coll = filter.from || filter.to ? db.bills.where('date').between(filter.from || '0000', filter.to || '9999', true, true) : db.bills.toCollection()
  coll = coll.filter((b) => b.deleted === 0)
  const status = filter.status ?? 'all'
  const bills = (await withPatients(await coll.toArray())).filter((b) =>
    status === 'all' ? true : status === 'overdue' ? isOverdue(b, today) : billStatus(b) === status,
  )
  const q = filter.search?.trim().toLowerCase()
  const digits = q?.replace(/\D/g, '')
  const matches = (b: BillWithPatient) =>
    !q ||
    b.patient.name.toLowerCase().includes(q) ||
    b.patient.opNo.toLowerCase().includes(q) ||
    b.billNo.toLowerCase().includes(q) ||
    (!!digits && digits.length >= 3 && !!b.patient.phone?.includes(digits))
  return bills.filter(matches).sort(newestFirst)
}

export interface PatientDueRow {
  patient: Patient
  balance: number
  oldestDueDate: string
  daysOverdue: number // <= 0 when not yet due
  billCount: number
}

// Patients with an outstanding balance, oldest due date first.
export async function duesByPatient(today: string): Promise<PatientDueRow[]> {
  const rows = new Map<string, PatientDueRow>()
  for (const b of await outstandingBills()) {
    const due = b.dueDate ?? b.date
    const row = rows.get(b.patientId)
    if (!row) {
      rows.set(b.patientId, { patient: b.patient, balance: b.balance, oldestDueDate: due, daysOverdue: 0, billCount: 1 })
    } else {
      row.balance = round2(row.balance + b.balance)
      row.billCount++
      if (due < row.oldestDueDate) row.oldestDueDate = due
    }
  }
  const out = [...rows.values()]
  for (const r of out) r.daysOverdue = daysBetween(r.oldestDueDate, today)
  return out.sort((a, b) => a.oldestDueDate.localeCompare(b.oldestDueDate) || b.balance - a.balance)
}
