import { describe, expect, it } from 'vitest'
import { db } from '../../db/db'
import { getSettings, saveSettings } from '../../db/repo'
import { addDays, todayISO } from '../../lib/format'
import { createPatient, deletePatient } from '../patients/patientRepo'
import {
  ageingBucket,
  billsForPatient,
  billsList,
  billStatus,
  billTotal,
  collectFromPatient,
  collectionsForDay,
  createBill,
  duesAgeing,
  duesByPatient,
  editBill,
  outstandingTotal,
  overdueBills,
  patientDues,
  paymentsForBill,
  paymentsForPatient,
  recordPayment,
  reversePayment,
  voidBill,
} from './billingRepo'

const today = todayISO()
const year = today.slice(0, 4)
const item = (amount: number, desc = 'Consultation') => ({ desc, amount })

async function patient(name = 'Asha', phone?: string) {
  return createPatient({ name, phone })
}

describe('bill totals and validation', () => {
  it('sums items minus discount, rounded to paise', () => {
    expect(billTotal([item(0.1), item(0.2)], 0)).toBe(0.3)
    expect(billTotal([item(300), item(200, 'Medicines')], 50)).toBe(450)
    expect(billTotal([item(100)], 100)).toBe(0)
  })

  it.each([
    [[], 0, /at least one item/],
    [[item(0)], 0, /above zero/],
    [[item(-5)], 0, /above zero/],
    [[{ desc: ' ', amount: 10 }], 0, /description/],
    [[item(100)], -1, /negative/],
    [[item(100)], 101, /exceed/],
  ])('rejects %j discount %d', (items, discount, msg) => {
    expect(() => billTotal(items, discount)).toThrow(msg)
  })
})

describe('createBill', () => {
  it('numbers bills and sets the default due date when unpaid', async () => {
    const p = await patient()
    const { bill } = await createBill({ patientId: p.id, date: today, items: [item(300)], discount: 0 })
    expect(bill).toMatchObject({ billNo: `BILL-${year}-00001`, total: 300, paid: 0, balance: 300, dueDate: addDays(today, 30) })
    const { bill: b2 } = await createBill({ patientId: p.id, date: today, items: [item(100)], discount: 0, dueDate: '2030-01-01' })
    expect(b2).toMatchObject({ billNo: `BILL-${year}-00002`, dueDate: '2030-01-01' })
    expect(await db.bills.get(b2.id)).toMatchObject({ dueDate: '2030-01-01' })
  })

  it('uses settings.defaultDueDays', async () => {
    await saveSettings({ ...(await getSettings()), defaultDueDays: 7 })
    const p = await patient()
    const { bill } = await createBill({ patientId: p.id, date: today, items: [item(300)], discount: 0 })
    expect(bill.dueDate).toBe(addDays(today, 7))
  })

  it('records payNow in the same transaction with a receipt number', async () => {
    const p = await patient()
    const { bill, payment } = await createBill({
      patientId: p.id,
      date: today,
      items: [item(300), item(200, 'Medicines')],
      discount: 100,
      payNow: { amount: 150, mode: 'upi' },
    })
    expect(bill).toMatchObject({ total: 400, paid: 150, balance: 250 })
    expect(payment).toMatchObject({ amount: 150, mode: 'upi', receiptNo: `RCPT-${year}-00001`, billId: bill.id, date: today })
    expect(await db.bills.get(bill.id)).toMatchObject({ paid: 150, balance: 250 })
  })

  it('fully paid bills have no due date', async () => {
    const p = await patient()
    const { bill } = await createBill({ patientId: p.id, date: today, items: [item(300)], discount: 0, payNow: { amount: 300, mode: 'cash' } })
    expect(bill.balance).toBe(0)
    expect(bill.dueDate).toBeUndefined()
    expect(billStatus(bill)).toBe('paid')
  })

  it('rolls back the bill when payNow is invalid', async () => {
    const p = await patient()
    await expect(
      createBill({ patientId: p.id, date: today, items: [item(300)], discount: 0, payNow: { amount: 301, mode: 'cash' } }),
    ).rejects.toThrow(/exceeds/)
    await expect(
      createBill({ patientId: p.id, date: today, items: [item(300)], discount: 0, payNow: { amount: -1, mode: 'cash' } }),
    ).rejects.toThrow(/above zero/)
    expect(await db.bills.count()).toBe(0)
    expect(await db.payments.count()).toBe(0)
    // The sequence was rolled back too.
    const { bill } = await createBill({ patientId: p.id, date: today, items: [item(1)], discount: 0 })
    expect(bill.billNo).toBe(`BILL-${year}-00001`)
  })

  it('rejects a deleted patient', async () => {
    const p = await patient()
    await deletePatient(p.id)
    await expect(createBill({ patientId: p.id, date: today, items: [item(1)], discount: 0 })).rejects.toThrow(/Patient not found/)
  })
})

describe('payments', () => {
  it('records partial payments and rejects overpayment / non-positive amounts', async () => {
    const p = await patient()
    const { bill } = await createBill({ patientId: p.id, date: today, items: [item(500)], discount: 0 })
    const pay = await recordPayment(bill.id, 200, 'cash', today)
    expect(pay.receiptNo).toBe(`RCPT-${year}-00001`)
    expect(await db.bills.get(bill.id)).toMatchObject({ paid: 200, balance: 300 })
    expect(billStatus((await db.bills.get(bill.id))!)).toBe('partial')
    await expect(recordPayment(bill.id, 300.01, 'cash')).rejects.toThrow(/exceeds/)
    await expect(recordPayment(bill.id, 0, 'cash')).rejects.toThrow(/above zero/)
    await expect(recordPayment(bill.id, -10, 'cash')).rejects.toThrow(/above zero/)
    await recordPayment(bill.id, 300, 'card')
    await expect(recordPayment(bill.id, 1, 'cash')).rejects.toThrow(/already paid/)
    expect((await paymentsForBill(bill.id)).map((x) => x.receiptNo)).toEqual([`RCPT-${year}-00001`, `RCPT-${year}-00002`])
  })

  it('collectFromPatient settles the oldest bills first', async () => {
    const p = await patient()
    const other = await patient('Other')
    const { bill: newer } = await createBill({ patientId: p.id, date: today, items: [item(300)], discount: 0 })
    const { bill: older } = await createBill({ patientId: p.id, date: addDays(today, -10), items: [item(200)], discount: 0 })
    const { bill: oldest } = await createBill({ patientId: p.id, date: addDays(today, -20), items: [item(100)], discount: 0 })
    await createBill({ patientId: other.id, date: addDays(today, -30), items: [item(999)], discount: 0 })
    await recordPayment(oldest.id, 50, 'cash')

    const pays = await collectFromPatient(p.id, 150, 'upi')
    expect(pays.map((x) => [x.billId, x.amount, x.mode])).toEqual([
      [oldest.id, 50, 'upi'],
      [older.id, 100, 'upi'],
    ])
    expect(new Set(pays.map((x) => x.receiptNo)).size).toBe(2)
    expect((await db.bills.get(oldest.id))!.balance).toBe(0)
    expect((await db.bills.get(older.id))!.balance).toBe(100)
    expect((await db.bills.get(newer.id))!.balance).toBe(300)
    expect((await patientDues(p.id)).balance).toBe(400)

    await expect(collectFromPatient(p.id, 400.5, 'cash')).rejects.toThrow(/exceeds the total dues/)
    await expect(collectFromPatient(p.id, 0, 'cash')).rejects.toThrow(/above zero/)
    const all = await collectFromPatient(p.id, 400, 'cash')
    expect(all).toHaveLength(2)
    expect((await patientDues(p.id)).balance).toBe(0)
    await expect(collectFromPatient(p.id, 1, 'cash')).rejects.toThrow(/No dues/)
  })
})

describe('edit, void and reverse', () => {
  it('edits freely without payments and keeps total >= paid with payments', async () => {
    const p = await patient()
    const { bill } = await createBill({ patientId: p.id, date: today, items: [item(500)], discount: 0 })
    const e1 = await editBill(bill.id, { items: [item(300), item(100, 'Medicines')], discount: 50, date: addDays(today, -1), dueDate: '2031-01-01' })
    expect(e1).toMatchObject({ total: 350, balance: 350, date: addDays(today, -1), dueDate: '2031-01-01' })

    await recordPayment(bill.id, 200, 'cash')
    await expect(editBill(bill.id, { items: [item(150)], discount: 0 })).rejects.toThrow(/less than/)
    await expect(editBill(bill.id, { items: [item(300)], discount: 0, date: today })).rejects.toThrow(/date/)
    const e2 = await editBill(bill.id, { items: [item(200)], discount: 0 })
    expect(e2).toMatchObject({ total: 200, paid: 200, balance: 0 })
    expect(billStatus(e2)).toBe('paid')
    await expect(editBill(bill.id, { items: [item(0)], discount: 0 })).rejects.toThrow(/above zero/)
  })

  it('voids only bills without payments; reversing restores the balance', async () => {
    const p = await patient()
    const { bill } = await createBill({ patientId: p.id, date: today, items: [item(500)], discount: 0, payNow: { amount: 500, mode: 'cash' } })
    expect(bill.dueDate).toBeUndefined()
    await expect(voidBill(bill.id)).rejects.toThrow(/Reverse the payments/)
    const [pay] = await paymentsForBill(bill.id)
    await reversePayment(pay.id)
    const after = (await db.bills.get(bill.id))!
    expect(after).toMatchObject({ paid: 0, balance: 500 })
    expect(after.dueDate).toBe(addDays(today, 30))
    expect((await db.payments.get(pay.id))!.deleted).toBe(1)
    await expect(reversePayment(pay.id)).rejects.toThrow(/not found/)
    expect(await paymentsForBill(bill.id)).toHaveLength(0)
    await voidBill(bill.id)
    expect((await db.bills.get(bill.id))!.deleted).toBe(1)
    expect(await billsForPatient(p.id)).toHaveLength(0)
    await expect(recordPayment(bill.id, 1, 'cash')).rejects.toThrow(/not found/)
  })
})

describe('ageing buckets', () => {
  const t = '2026-10-20'
  it.each([
    [addDays(t, 5), 'notDue'],
    [t, 'notDue'],
    [addDays(t, -1), 'd0_30'],
    [addDays(t, -30), 'd0_30'],
    [addDays(t, -31), 'd31_60'],
    [addDays(t, -60), 'd31_60'],
    [addDays(t, -61), 'd61_90'],
    [addDays(t, -90), 'd61_90'],
    [addDays(t, -91), 'd90plus'],
    [addDays(t, -400), 'd90plus'],
  ])('due %s -> %s', (due, bucket) => {
    expect(ageingBucket(due, t)).toBe(bucket)
  })

  it('aggregates outstanding bills into buckets', async () => {
    const p = await patient()
    for (const [days, amt] of [[-30, 100], [-31, 200], [-60, 300], [-61, 400], [-90, 500], [-91, 600], [0, 700], [10, 800]]) {
      await createBill({ patientId: p.id, date: addDays(t, -120), items: [item(amt)], discount: 0, dueDate: addDays(t, days) })
    }
    await createBill({ patientId: p.id, date: t, items: [item(50)], discount: 0, payNow: { amount: 50, mode: 'cash' } })
    expect(await duesAgeing(t)).toEqual({
      notDue: { count: 2, amount: 1500 },
      d0_30: { count: 1, amount: 100 },
      d31_60: { count: 2, amount: 500 },
      d61_90: { count: 2, amount: 900 },
      d90plus: { count: 1, amount: 600 },
    })
    expect((await overdueBills(t)).map((b) => b.balance)).toEqual([600, 500, 400, 300, 200, 100])
  })
})

describe('queries', () => {
  it('collectionsForDay splits by mode and skips reversed payments / deleted patients', async () => {
    const a = await patient('A')
    const b = await patient('B')
    const c = await patient('C')
    await createBill({ patientId: a.id, date: today, items: [item(1000)], discount: 0, payNow: { amount: 300, mode: 'cash' } })
    const { bill } = await createBill({ patientId: b.id, date: today, items: [item(500)], discount: 0 })
    await recordPayment(bill.id, 200, 'upi', today)
    const rev = await recordPayment(bill.id, 50, 'card', today)
    await reversePayment(rev.id)
    await recordPayment(bill.id, 100, 'card', addDays(today, -1))
    await createBill({ patientId: c.id, date: today, items: [item(70)], discount: 0, payNow: { amount: 70, mode: 'other' } })
    await deletePatient(c.id)
    expect(await collectionsForDay(today)).toEqual({ total: 500, count: 2, byMode: { cash: 300, upi: 200, card: 0, other: 0 } })
    expect((await collectionsForDay(addDays(today, -1))).byMode.card).toBe(100)
  })

  it('skips voided bills and deleted patients everywhere', async () => {
    const a = await patient('Alpha', '9876543210')
    const gone = await patient('Gone')
    const { bill: live } = await createBill({ patientId: a.id, date: addDays(today, -40), items: [item(400)], discount: 0, dueDate: addDays(today, -5) })
    const { bill: voided } = await createBill({ patientId: a.id, date: today, items: [item(999)], discount: 0 })
    await voidBill(voided.id)
    await createBill({ patientId: gone.id, date: today, items: [item(800)], discount: 0, dueDate: addDays(today, -50) })
    await deletePatient(gone.id)

    expect(await outstandingTotal()).toBe(400)
    expect((await overdueBills(today)).map((b) => b.id)).toEqual([live.id])
    expect((await duesAgeing(today)).d0_30).toEqual({ count: 1, amount: 400 })
    expect((await billsList()).map((b) => b.id)).toEqual([live.id])
    expect(await patientDues(gone.id)).toEqual({ balance: 0, bills: [] })
    expect(await duesByPatient(today)).toEqual([
      expect.objectContaining({ balance: 400, oldestDueDate: addDays(today, -5), daysOverdue: 5, billCount: 1 }),
    ])
  })

  it('billsList filters by status, date range and search', async () => {
    const a = await patient('Asha Menon', '9876543210')
    const r = await patient('Ravi Kumar')
    const { bill: paid } = await createBill({ patientId: a.id, date: addDays(today, -2), items: [item(100)], discount: 0, payNow: { amount: 100, mode: 'cash' } })
    const { bill: partial } = await createBill({ patientId: a.id, date: addDays(today, -1), items: [item(300)], discount: 0, payNow: { amount: 100, mode: 'cash' } })
    const { bill: overdue } = await createBill({ patientId: r.id, date: addDays(today, -60), items: [item(500)], discount: 0, dueDate: addDays(today, -1) })
    const { bill: unpaid } = await createBill({ patientId: r.id, date: today, items: [item(50)], discount: 0 })

    const ids = async (f: Parameters<typeof billsList>[0]) => (await billsList(f)).map((b) => b.id)
    expect(await ids({})).toEqual([unpaid.id, partial.id, paid.id, overdue.id])
    expect(await ids({ status: 'paid' })).toEqual([paid.id])
    expect(await ids({ status: 'partial' })).toEqual([partial.id])
    expect(await ids({ status: 'unpaid' })).toEqual([unpaid.id, overdue.id])
    expect(await ids({ status: 'overdue', today })).toEqual([overdue.id])
    expect(await ids({ from: addDays(today, -2), to: addDays(today, -1) })).toEqual([partial.id, paid.id])
    expect(await ids({ search: 'asha' })).toEqual([partial.id, paid.id])
    expect(await ids({ search: '98765' })).toEqual([partial.id, paid.id])
    expect(await ids({ search: overdue.billNo })).toEqual([overdue.id])
    expect(await ids({ search: r.opNo, status: 'unpaid' })).toEqual([unpaid.id, overdue.id])
  })

  it('patient dues, bills and payment history', async () => {
    const p = await patient()
    const { bill: b1 } = await createBill({ patientId: p.id, date: addDays(today, -3), items: [item(200)], discount: 0, dueDate: addDays(today, 3) })
    const { bill: b2 } = await createBill({ patientId: p.id, date: today, items: [item(100)], discount: 0, payNow: { amount: 40, mode: 'upi' } })
    const dues = await patientDues(p.id)
    expect(dues.balance).toBe(260)
    expect(dues.bills.map((b) => b.id)).toEqual([b1.id, b2.id])
    expect(dues.oldestDueDate).toBe(addDays(today, 3))
    expect((await billsForPatient(p.id)).map((b) => b.id)).toEqual([b2.id, b1.id])
    expect((await paymentsForPatient(p.id)).map((x) => x.amount)).toEqual([40])
  })
})
