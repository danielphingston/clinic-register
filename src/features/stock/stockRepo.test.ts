import { describe, expect, it } from 'vitest'
import { db } from '../../db/db'
import type { StockItem, StockMove } from '../../db/types'
import { createBill, voidBill } from '../billing/billingRepo'
import { createPatient } from '../patients/patientRepo'
import { addCustomRemedy } from '../remedies/remedyRepo'
import { blankRow, repeatRows, rowsFromItems, rowsToInput } from '../visits/rxRows'
import { itemsForVisit, saveVisit, type RxInput } from '../visits/visitRepo'
import { dispenseWarning, medicineLineDesc, stockStatus } from './stockLogic'
import {
  adjust,
  billLinesForVisit,
  createStockItem,
  deleteStockItem,
  editStockItem,
  findStock,
  lowStockItems,
  movesFor,
  purchase,
  recomputeStock,
  stockList,
  stockUsage,
} from './stockRepo'

const base = { form: 'dilution' as const, unit: 'ml', lowStockAt: 5, price: 2 }

async function setup() {
  const ars = await addCustomRemedy('Arsenicum album')
  const nux = await addCustomRemedy('Nux vomica')
  const patient = await createPatient({ name: 'Asha' })
  return { ars, nux, patient }
}

const sum = (moves: StockMove[]) => Math.round(moves.reduce((s, m) => s + m.delta, 0) * 1000) / 1000

let added: StockMove[] = []

// The cached qty must always equal the ledger, and old moves never change.
async function expectLedgerConsistent(snapshot: StockMove[] = []): Promise<StockMove[]> {
  const items = await db.stockItems.toArray()
  const moves = await db.stockMoves.toArray()
  for (const it of items) {
    expect(it.qty, `qty of ${it.potency} ${it.form}`).toBe(sum(moves.filter((m) => m.stockItemId === it.id)))
    expect(await recomputeStock(it.id)).toBe(it.qty)
  }
  for (const old of snapshot) expect(moves.find((m) => m.id === old.id)).toEqual(old)
  added = moves.filter((m) => !snapshot.some((o) => o.id === m.id))
  return moves
}

const qtyOf = async (id: string) => (await db.stockItems.get(id))!.qty

describe('stock ledger', () => {
  it('keeps qty equal to the sum of moves through purchase, dispense, visit edits and adjust', async () => {
    const { ars, patient } = await setup()
    const a = await createStockItem({ ...base, remedyId: ars.id, potency: '30C', openingQty: 100 })
    const b = await createStockItem({ ...base, remedyId: ars.id, potency: '30C', form: 'globules', unit: 'g', openingQty: 50 })
    let snap = await expectLedgerConsistent()
    expect(a.qty).toBe(100)

    await purchase(a.id, 20.5, 'Supplier X', '2026-10-01')
    snap = await expectLedgerConsistent(snap)
    expect(await qtyOf(a.id)).toBe(120.5)

    const row = (extra: Partial<RxInput> = {}): RxInput => ({ remedyId: ars.id, potency: '30C', ...extra })
    const visit = { patientId: patient.id, date: '2026-10-02', caseNotes: {} }
    const id = await saveVisit({ ...visit, items: [row({ stockItemId: a.id, qtyDispensed: 10 }), row({ potency: '200C' })] })
    let items = await itemsForVisit(id)
    expect(items[0]).toMatchObject({ stockItemId: a.id, qtyDispensed: 10 })
    expect(await qtyOf(a.id)).toBe(110.5)
    snap = await expectLedgerConsistent(snap)
    const [dispense] = snap.filter((m) => m.reason === 'dispense')
    expect(dispense).toMatchObject({ delta: -10, refId: items[0].id, date: '2026-10-02' })

    // Re-saving unchanged writes nothing.
    await saveVisit({ ...visit, id, items: [row({ id: items[0].id, stockItemId: a.id, qtyDispensed: 10 })] .concat(row({ id: items[1].id, potency: '200C' })) })
    expect(await db.stockMoves.count()).toBe(snap.length)

    // Quantity change: a move for the difference.
    await saveVisit({ ...visit, id, items: [row({ id: items[0].id, stockItemId: a.id, qtyDispensed: 15 }), row({ id: items[1].id, potency: '200C' })] })
    expect(await qtyOf(a.id)).toBe(105.5)
    snap = await expectLedgerConsistent(snap)
    expect(added[added.length - 1]).toMatchObject({ delta: -5, reason: 'dispense', refId: items[0].id, note: 'Visit edited' })

    // Item swap: reverse the old item, dispense from the new one.
    await saveVisit({ ...visit, id, items: [row({ id: items[0].id, stockItemId: b.id, qtyDispensed: 3 }), row({ id: items[1].id, potency: '200C' })] })
    expect(await qtyOf(a.id)).toBe(120.5)
    expect(await qtyOf(b.id)).toBe(47)
    snap = await expectLedgerConsistent(snap)

    // A second row from the same item, then remove it: reversed.
    await saveVisit({ ...visit, id, items: [row({ id: items[0].id, stockItemId: b.id, qtyDispensed: 3 }), row({ stockItemId: b.id, qtyDispensed: 2 })] })
    expect(await qtyOf(b.id)).toBe(45)
    items = await itemsForVisit(id)
    snap = await expectLedgerConsistent(snap)
    await saveVisit({ ...visit, id, items: [row({ id: items[0].id, stockItemId: b.id, qtyDispensed: 3 })] })
    expect(await qtyOf(b.id)).toBe(47)
    snap = await expectLedgerConsistent(snap)
    expect(added[added.length - 1]).toMatchObject({ delta: 2, reason: 'dispense', refId: items[1].id, note: 'Removed from visit' })

    // Clearing the qty (prescription only) returns the stock.
    await saveVisit({ ...visit, id, items: [row({ id: items[0].id, stockItemId: b.id })] })
    expect(await qtyOf(b.id)).toBe(50)
    snap = await expectLedgerConsistent(snap)

    await adjust(a.id, { newQty: 118 }, 'Stock count')
    snap = await expectLedgerConsistent(snap)
    expect(added).toHaveLength(1)
    expect(added[added.length - 1]).toMatchObject({ delta: -2.5, reason: 'adjust', note: 'Stock count' })
    await adjust(a.id, { delta: 0.25 }, 'Found a vial')
    expect(await qtyOf(a.id)).toBe(118.25)
    await expectLedgerConsistent(snap)

    // A drifted cache is repaired from the ledger.
    await db.stockItems.update(a.id, { qty: 999 })
    expect(await recomputeStock(a.id)).toBe(118.25)
    expect(await qtyOf(a.id)).toBe(118.25)
  })

  it('validates moves', async () => {
    const { ars } = await setup()
    const a = await createStockItem({ ...base, remedyId: ars.id, potency: '30C', openingQty: 10 })
    await expect(purchase(a.id, 0)).rejects.toThrow(/above zero/)
    await expect(purchase(a.id, -3)).rejects.toThrow(/above zero/)
    await expect(adjust(a.id, { newQty: 4 }, ' ')).rejects.toThrow(/reason/)
    await expect(adjust(a.id, { newQty: 10 }, 'count')).rejects.toThrow(/does not change/)
    await expect(createStockItem({ ...base, remedyId: ars.id, potency: '6C', openingQty: -1 })).rejects.toThrow(/negative/)
    await expect(createStockItem({ ...base, remedyId: '', potency: '6C' })).rejects.toThrow(/remedy/)
    expect(await movesFor(a.id)).toHaveLength(1)
  })

  it('allows negative stock from dispensing and rolls back the visit on a mismatched item', async () => {
    const { ars, nux, patient } = await setup()
    const a = await createStockItem({ ...base, remedyId: ars.id, potency: '30C', openingQty: 4 })
    await saveVisit({ patientId: patient.id, date: '2026-10-05', caseNotes: {}, items: [{ remedyId: ars.id, potency: '30c', stockItemId: a.id, qtyDispensed: 10 }] })
    expect(await qtyOf(a.id)).toBe(-6)
    expect(stockStatus(await db.stockItems.get(a.id) as StockItem)).toBe('out')

    const before = await db.visits.count()
    await expect(
      saveVisit({ patientId: patient.id, date: '2026-10-05', caseNotes: {}, items: [{ remedyId: nux.id, potency: '30C', stockItemId: a.id, qtyDispensed: 1 }] }),
    ).rejects.toThrow(/does not match/)
    expect(await db.visits.count()).toBe(before)
    expect(await qtyOf(a.id)).toBe(-6)
  })

  it('computes dispense warnings', () => {
    const item = { lowStockAt: 5, unit: 'ml' }
    expect(dispenseWarning(item, 20, 0)).toBeNull()
    expect(dispenseWarning(item, 20, 10)).toBeNull()
    expect(dispenseWarning(item, 20, 15)).toEqual({ level: 'low', message: 'Low stock: 5 ml will be left' })
    expect(dispenseWarning(item, 8, 10)).toEqual({ level: 'negative', message: 'Only 8 ml left; stock will go to -2' })
    expect(dispenseWarning(item, -3, 1)?.message).toBe('Only 0 ml left; stock will go to -4')
  })
})

describe('stock items', () => {
  it('rejects duplicates per remedy + potency + form among live items', async () => {
    const { ars } = await setup()
    const a = await createStockItem({ ...base, remedyId: ars.id, potency: '30C' })
    await expect(createStockItem({ ...base, remedyId: ars.id, potency: ' 30c ' })).rejects.toThrow(/already stocked/)
    const g = await createStockItem({ ...base, remedyId: ars.id, potency: '30C', form: 'globules' })
    await expect(editStockItem(g.id, { ...base, remedyId: ars.id, potency: '30C' })).rejects.toThrow(/already stocked/)
    await editStockItem(g.id, { ...base, remedyId: ars.id, potency: '30C', form: 'globules', unit: 'dram', price: 12.345, lowStockAt: 2 })
    expect(await db.stockItems.get(g.id)).toMatchObject({ unit: 'dram', price: 12.35, lowStockAt: 2, qty: 0 })
    await deleteStockItem(a.id)
    await createStockItem({ ...base, remedyId: ars.id, potency: '30C' })
  })

  it('deletes only empty items unless written off', async () => {
    const { ars } = await setup()
    const a = await createStockItem({ ...base, remedyId: ars.id, potency: '30C', openingQty: 7.5 })
    await expect(deleteStockItem(a.id)).rejects.toThrow(/zero stock/)
    expect((await db.stockItems.get(a.id))?.deleted).toBe(0)
    await deleteStockItem(a.id, { writeOff: true })
    const after = await db.stockItems.get(a.id)
    expect(after).toMatchObject({ deleted: 1, qty: 0 })
    const moves = await movesFor(a.id)
    expect(moves[moves.length - 1]).toMatchObject({ reason: 'adjust', delta: -7.5, balance: 0, note: 'Written off' })
    await expect(purchase(a.id, 1)).rejects.toThrow(/not found/)
    expect(await stockList()).toHaveLength(0)

    const b = await createStockItem({ ...base, remedyId: ars.id, potency: '200C' })
    await deleteStockItem(b.id)
    expect(await db.stockMoves.where('stockItemId').equals(b.id).count()).toBe(0)
  })

  it('lists, filters and finds stock', async () => {
    const { ars, nux } = await setup()
    const ok = await createStockItem({ ...base, remedyId: ars.id, potency: '30C', openingQty: 50 })
    const edge = await createStockItem({ ...base, remedyId: ars.id, potency: '200C', openingQty: 5 })
    const low = await createStockItem({ ...base, remedyId: nux.id, potency: '30C', form: 'globules', unit: 'g', lowStockAt: 10, openingQty: 1 })
    const zero = await createStockItem({ ...base, remedyId: nux.id, potency: '200C' })
    const gone = await createStockItem({ ...base, remedyId: nux.id, potency: '1M' })
    await deleteStockItem(gone.id)
    const neg = await createStockItem({ ...base, remedyId: nux.id, potency: '6C', lowStockAt: 0 })
    await adjust(neg.id, { delta: -2 }, 'spilt')

    expect((await lowStockItems()).map((s) => s.id)).toEqual([neg.id, zero.id, low.id, edge.id])
    expect((await stockList({ filter: 'negative' })).map((s) => s.id).sort()).toEqual([neg.id, zero.id].sort())
    expect((await stockList({ form: 'globules' })).map((s) => s.id)).toEqual([low.id])
    expect((await stockList({ search: 'ars 200' })).map((s) => s.id)).toEqual([edge.id])
    expect((await stockList()).map((s) => `${s.remedyName} ${s.potency}`)).toEqual([
      'Arsenicum album 30C',
      'Arsenicum album 200C',
      'Nux vomica 6C',
      'Nux vomica 30C',
      'Nux vomica 200C',
    ])
    expect((await findStock(ars.id, '30c')).map((s) => s.id)).toEqual([ok.id])
    expect(await findStock(nux.id, '1M')).toEqual([])
    expect(await findStock(ars.id, '')).toEqual([])
  })
})

describe('stock reports and billing', () => {
  it('sums dispensed qty per item over a date range, netting visit edits', async () => {
    const { ars, nux, patient } = await setup()
    const a = await createStockItem({ ...base, remedyId: ars.id, potency: '30C', openingQty: 100 })
    const n = await createStockItem({ ...base, remedyId: nux.id, potency: '200C', openingQty: 100 })
    const v = (date: string, items: RxInput[], id?: string) => saveVisit({ id, patientId: patient.id, date, caseNotes: {}, items })
    const id1 = await v('2026-09-30', [{ remedyId: ars.id, potency: '30C', stockItemId: a.id, qtyDispensed: 7 }])
    const id2 = await v('2026-10-01', [{ remedyId: ars.id, potency: '30C', stockItemId: a.id, qtyDispensed: 10 }, { remedyId: nux.id, potency: '200C', stockItemId: n.id, qtyDispensed: 2 }])
    const [i1] = await itemsForVisit(id2)
    await v('2026-10-01', [{ id: i1.id, remedyId: ars.id, potency: '30C', stockItemId: a.id, qtyDispensed: 4 }], id2)
    await v('2026-10-31', [{ remedyId: nux.id, potency: '200C', stockItemId: n.id, qtyDispensed: 1.5 }])
    await purchase(a.id, 50, undefined, '2026-10-10')

    const usage = await stockUsage('2026-10-01', '2026-10-31')
    expect(usage.map((u) => [u.remedyName, u.dispensed])).toEqual([
      ['Arsenicum album', 4],
      ['Nux vomica', 1.5],
    ])
    expect((await stockUsage('2026-09-01', '2026-09-30')).map((u) => u.dispensed)).toEqual([7])
    expect(id1).toBeTruthy()
  })

  it('builds medicine bill lines (priced and unpriced) and accepts ₹0 medicine lines', async () => {
    const { ars, nux, patient } = await setup()
    const a = await createStockItem({ ...base, remedyId: ars.id, potency: '30C', price: 2.5, openingQty: 100 })
    const n = await createStockItem({ ...base, remedyId: nux.id, potency: '200C', form: 'globules', unit: 'g', price: 0, openingQty: 20 })
    const id = await saveVisit({
      patientId: patient.id,
      date: '2026-10-02',
      caseNotes: {},
      items: [
        { remedyId: ars.id, potency: '30C', stockItemId: a.id, qtyDispensed: 10 },
        { remedyId: nux.id, potency: '200C', stockItemId: n.id, qtyDispensed: 1.5 },
        { remedyId: nux.id, potency: '1M' },
      ],
    })
    const lines = await billLinesForVisit(id)
    expect(lines).toEqual([
      { desc: 'Arsenicum album 30C × 10 ml', amount: 25, stockItemId: a.id, qty: 10, unpriced: false },
      { desc: 'Nux vomica 200C × 1.5 g', amount: 0, stockItemId: n.id, qty: 1.5, unpriced: true },
    ])
    expect(medicineLineDesc('X', '6C', 2, 'tablets')).toBe('X 6C × 2 tablets')

    const items = [{ desc: 'Consultation', amount: 200 }, ...lines.map(({ desc, amount, stockItemId, qty }) => ({ desc, amount, stockItemId, qty }))]
    const { bill } = await createBill({ patientId: patient.id, visitId: id, date: '2026-10-02', items, discount: 0 })
    expect(bill.total).toBe(225)
    expect(bill.items[2]).toMatchObject({ amount: 0, stockItemId: n.id, qty: 1.5 })
    await expect(createBill({ patientId: patient.id, date: '2026-10-02', items: [{ desc: 'Consultation', amount: 0 }], discount: 0 })).rejects.toThrow(/above zero/)
    await expect(createBill({ patientId: patient.id, date: '2026-10-02', items: [items[2]], discount: 0 })).rejects.toThrow(/at least one/)

    // Voiding the bill leaves stock alone: the medicine was handed over.
    const movesBefore = await db.stockMoves.count()
    await voidBill(bill.id)
    expect(await db.stockMoves.count()).toBe(movesBefore)
    expect(await qtyOf(a.id)).toBe(90)
  })

  it('carries the stock item and qty through Rx rows', () => {
    const rows = rowsFromItems(
      [{ id: 'p1', visitId: 'v', patientId: 'p', remedyId: 'r', potency: '30C', stockItemId: 's1', qtyDispensed: 2.5, createdAt: 0, updatedAt: 0, deleted: 0 }],
      false,
    )
    expect(rows[0]).toMatchObject({ stockItemId: 's1', qty: '2.5', id: undefined })
    expect(repeatRows([blankRow()], [{ id: 'p1', visitId: 'v', patientId: 'p', remedyId: 'r', potency: '30C', stockItemId: 's1', qtyDispensed: 3, createdAt: 0, updatedAt: 0, deleted: 0 }])[0]).toMatchObject({ stockItemId: 's1', qty: '3' })
    expect(rowsToInput(rows).items[0]).toMatchObject({ stockItemId: 's1', qtyDispensed: 2.5 })
    expect(rowsToInput([{ ...rows[0], qty: 'abc' }]).error).toMatch(/dispense quantity/)
    expect(rowsToInput([{ ...rows[0], stockItemId: '' }]).error).toMatch(/stock item/)
    expect(rowsToInput([{ ...rows[0], qty: '' }]).items[0]).toMatchObject({ stockItemId: 's1', qtyDispensed: undefined })
  })
})
