import { afterEach, describe, expect, it } from 'vitest'
import { ClinicDB, db } from '../../db/db'
import { addDays, todayISO } from '../../lib/format'
import { SyncEngine } from '../../sync/engine'
import { FakeDrive } from '../../sync/fakeDrive'
import { createPatient } from '../patients/patientRepo'
import { addCustomRemedy } from '../remedies/remedyRepo'
import { createStockItem, deleteStockItem, movesFor, stockUsage } from '../stock/stockRepo'
import { saveVisit } from '../visits/visitRepo'
import { BillingError, createBill, editBill, recordPayment, reversePayment, voidBill } from './billingRepo'

const today = todayISO()

async function setup() {
  const ars = await addCustomRemedy('Arsenicum album')
  const patient = await createPatient({ name: 'Asha' })
  const item = await createStockItem({ remedyId: ars.id, potency: '30C', form: 'dilution', unit: 'ml', lowStockAt: 5, price: 2, openingQty: 100 })
  return { ars, patient, item }
}

const qty = async (id: string) => (await db.stockItems.get(id))!.qty
const sale = (stockItemId: string, n: number, amount = n * 2) => ({ desc: `Arsenicum album 30C × ${n} ml`, amount, stockItemId, qty: n, sale: true as const })

let others: ClinicDB[] = []
afterEach(async () => {
  for (const d of others) await d.delete()
  others = []
})

describe('counter sales (medicine lines added on a bill)', () => {
  it('takes stock out on save, adjusts on edit and returns it on void', async () => {
    const { patient, item } = await setup()
    const { bill } = await createBill({ patientId: patient.id, date: today, items: [sale(item.id, 10)], discount: 0 })
    expect(bill.items[0]).toMatchObject({ stockItemId: item.id, qty: 10, sale: true, amount: 20 })
    expect(await qty(item.id)).toBe(90)

    await editBill(bill.id, { items: [sale(item.id, 4)], discount: 0 })
    expect(await qty(item.id)).toBe(96)
    // Removing the line returns the rest.
    await editBill(bill.id, { items: [{ desc: 'Consultation', amount: 100 }], discount: 0 })
    expect(await qty(item.id)).toBe(100)
    await editBill(bill.id, { items: [sale(item.id, 7)], discount: 0 })
    expect(await qty(item.id)).toBe(93)

    await voidBill(bill.id)
    expect(await qty(item.id)).toBe(100)

    const moves = await movesFor(item.id)
    expect(moves.map((m) => [m.delta, m.note])).toEqual([
      [100, 'Opening stock'],
      [-10, 'Counter sale'],
      [6, 'Bill edited'],
      [4, 'Bill edited'],
      [-7, 'Bill edited'],
      [7, 'Bill voided'],
    ])
    // History links to the bill.
    expect(moves[1].bill).toMatchObject({ billId: bill.id, billNo: bill.billNo, patientName: 'Asha' })
    expect(moves.every((m) => m.reason === 'purchase' || m.refId === bill.id)).toBe(true)
  })

  it('counts in stock usage reports', async () => {
    const { patient, item } = await setup()
    await createBill({ patientId: patient.id, date: today, items: [sale(item.id, 3), sale(item.id, 2)], discount: 0 })
    const [u] = await stockUsage(addDays(today, -1), today)
    expect(u).toMatchObject({ stockItemId: item.id, dispensed: 5 })
  })

  it('does not move stock for lines copied from a visit (the visit already did)', async () => {
    const { ars, patient, item } = await setup()
    const visitId = await saveVisit({
      patientId: patient.id,
      date: today,
      caseNotes: {},
      items: [{ remedyId: ars.id, potency: '30C', stockItemId: item.id, qtyDispensed: 10 }],
    })
    expect(await qty(item.id)).toBe(90)
    const { bill } = await createBill({
      patientId: patient.id,
      visitId,
      date: today,
      items: [{ desc: 'Arsenicum album 30C × 10 ml', amount: 20, stockItemId: item.id, qty: 10 }],
      discount: 0,
    })
    expect(await qty(item.id)).toBe(90)
    await voidBill(bill.id)
    expect(await qty(item.id)).toBe(90)
  })

  it('validates quantity and rolls back the whole bill on a stock error', async () => {
    const { patient, item } = await setup()
    await expect(createBill({ patientId: patient.id, date: today, items: [{ ...sale(item.id, 1), qty: 0 }], discount: 0 })).rejects.toThrow(BillingError)
    await deleteStockItem(item.id, { writeOff: true })
    await expect(createBill({ patientId: patient.id, date: today, items: [sale(item.id, 1)], discount: 0 })).rejects.toThrow(/deleted/)
    expect(await db.bills.count()).toBe(0)
  })

  it('needs payments reversed before a void returns the stock', async () => {
    const { patient, item } = await setup()
    const { bill } = await createBill({ patientId: patient.id, date: today, items: [sale(item.id, 5)], discount: 0 })
    const pay = await recordPayment(bill.id, 10, 'cash')
    await expect(voidBill(bill.id)).rejects.toThrow(/Reverse the payments/)
    expect(await qty(item.id)).toBe(95)
    await reversePayment(pay.id)
    await voidBill(bill.id)
    expect(await qty(item.id)).toBe(100)
  })

  it('syncs to another device with the stock recomputed and linked to the bill', async () => {
    const { patient, item } = await setup()
    const drive = new FakeDrive()
    const B = new ClinicDB(`cs-b-${crypto.randomUUID()}`)
    others.push(B)
    const a = new SyncEngine({ db, drive, deviceId: 'A', kdfIterations: 1000 })
    const b = new SyncEngine({ db: B, drive, deviceId: 'B', kdfIterations: 1000 })
    const { bill } = await createBill({ patientId: patient.id, date: today, items: [sale(item.id, 12)], discount: 0 })
    await a.sync()
    await b.sync()
    expect((await B.stockItems.get(item.id))?.qty).toBe(88)
    expect((await B.stockMoves.where('refId').equals(bill.id).toArray()).map((m) => m.delta)).toEqual([-12])

    await voidBill(bill.id)
    await a.sync()
    await b.sync()
    expect((await B.stockItems.get(item.id))?.qty).toBe(100)
    expect((await B.bills.get(bill.id))?.deleted).toBe(1)
  })
})
