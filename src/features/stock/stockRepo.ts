import { db } from '../../db/db'
import { newRecord } from '../../db/repo'
import type { PrescriptionItem, Remedy, StockForm, StockItem, StockMove, StockMoveReason } from '../../db/types'
import { todayISO } from '../../lib/format'
import { remedyMap } from '../remedies/remedyRepo'
import { medicineLineDesc, roundQty, samePotency, stockStatus } from './stockLogic'

export class StockError extends Error {}

export interface StockItemInput {
  remedyId: string
  potency: string
  form: StockForm
  unit: string
  lowStockAt: number
  price: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

function cleanInput(i: StockItemInput): StockItemInput {
  if (!i.remedyId) throw new StockError('Choose a remedy')
  const potency = i.potency.trim()
  if (!potency) throw new StockError('Enter a potency')
  const unit = i.unit.trim()
  if (!unit) throw new StockError('Enter a unit')
  if (!Number.isFinite(i.lowStockAt) || i.lowStockAt < 0) throw new StockError('Low-stock level cannot be negative')
  if (!Number.isFinite(i.price) || i.price < 0) throw new StockError('Price cannot be negative')
  return { remedyId: i.remedyId, potency, form: i.form, unit, lowStockAt: roundQty(i.lowStockAt), price: round2(i.price) }
}

async function assertUnique(i: StockItemInput, exceptId?: string) {
  const clash = await db.stockItems
    .where('remedyId')
    .equals(i.remedyId)
    .filter((s) => s.deleted === 0 && s.id !== exceptId && s.form === i.form && samePotency(s.potency, i.potency))
    .first()
  if (clash) throw new StockError(`This remedy is already stocked as ${clash.potency} ${i.form}`)
}

async function liveItem(id: string): Promise<StockItem> {
  const s = await db.stockItems.get(id)
  if (!s || s.deleted) throw new StockError('Stock item not found')
  return s
}

// Writes a move and bumps the cached qty. Callers must hold a rw transaction
// over stockItems and stockMoves.
async function addMove(
  item: StockItem,
  delta: number,
  reason: StockMoveReason,
  date: string,
  extra: { refId?: string; note?: string } = {},
): Promise<StockMove> {
  const move = newRecord<StockMove>({ stockItemId: item.id, delta: roundQty(delta), reason, date })
  if (extra.refId) move.refId = extra.refId
  if (extra.note?.trim()) move.note = extra.note.trim()
  await db.stockMoves.add(move)
  item.qty = roundQty(item.qty + move.delta)
  await db.stockItems.update(item.id, { qty: item.qty, updatedAt: Date.now() })
  return move
}

const stockTx = <T>(fn: () => Promise<T>) => db.transaction('rw', db.stockItems, db.stockMoves, fn)

export async function createStockItem(input: StockItemInput & { openingQty?: number; date?: string }): Promise<StockItem> {
  const fields = cleanInput(input)
  const opening = input.openingQty ?? 0
  if (!Number.isFinite(opening) || opening < 0) throw new StockError('Opening quantity cannot be negative')
  return stockTx(async () => {
    await assertUnique(fields)
    const item = newRecord<StockItem>({ ...fields, qty: 0 })
    await db.stockItems.add(item)
    if (opening > 0) await addMove(item, opening, 'purchase', input.date || todayISO(), { note: 'Opening stock' })
    return { ...item }
  })
}

export async function editStockItem(id: string, input: StockItemInput): Promise<void> {
  const fields = cleanInput(input)
  await stockTx(async () => {
    await liveItem(id)
    await assertUnique(fields, id)
    await db.stockItems.update(id, { ...fields, updatedAt: Date.now() })
  })
}

// Soft delete. Items still holding stock need `writeOff`, which first adjusts
// the qty to 0 so the move history explains where the stock went.
export async function deleteStockItem(id: string, opts: { writeOff?: boolean; note?: string } = {}): Promise<void> {
  await stockTx(async () => {
    const item = await liveItem(id)
    if (item.qty !== 0) {
      if (!opts.writeOff) throw new StockError('Only items with zero stock can be deleted; write off the remaining stock first')
      await addMove(item, -item.qty, 'adjust', todayISO(), { note: opts.note || 'Written off' })
    }
    await db.stockItems.update(id, { deleted: 1, updatedAt: Date.now() })
  })
}

export async function purchase(stockItemId: string, qty: number, note?: string, date?: string): Promise<StockMove> {
  if (!Number.isFinite(qty) || roundQty(qty) <= 0) throw new StockError('Enter a quantity above zero')
  return stockTx(async () => addMove(await liveItem(stockItemId), qty, 'purchase', date || todayISO(), { note }))
}

// Stock count correction: pass either the counted quantity or a delta.
export async function adjust(
  stockItemId: string,
  change: { newQty: number } | { delta: number },
  note: string,
  date?: string,
): Promise<StockMove | null> {
  if (!note.trim()) throw new StockError('Enter a reason for the adjustment')
  const value = 'newQty' in change ? change.newQty : change.delta
  if (!Number.isFinite(value)) throw new StockError('Enter a number')
  return stockTx(async () => {
    const item = await liveItem(stockItemId)
    const delta = roundQty('newQty' in change ? change.newQty - item.qty : change.delta)
    if (delta === 0) throw new StockError('That does not change the stock')
    return addMove(item, delta, 'adjust', date || todayISO(), { note })
  })
}

// Rebuilds the cached qty from the move ledger (the source of truth).
export async function recomputeStock(stockItemId: string): Promise<number> {
  return stockTx(async () => {
    const moves = await db.stockMoves.where('stockItemId').equals(stockItemId).filter((m) => m.deleted === 0).toArray()
    const qty = roundQty(moves.reduce((s, m) => s + m.delta, 0))
    const item = await db.stockItems.get(stockItemId)
    if (item && item.qty !== qty) await db.stockItems.update(stockItemId, { qty, updatedAt: Date.now() })
    return qty
  })
}

export interface DispenseTarget {
  stockItemId?: string
  qty?: number
}

// Brings a prescription row's net dispensed stock in line with `target` by
// adding correcting moves; old moves are never rewritten. Run inside a rw
// transaction that includes stockItems and stockMoves.
export async function syncDispense(
  rx: Pick<PrescriptionItem, 'id' | 'remedyId' | 'potency'>,
  target: DispenseTarget | null,
  date: string,
): Promise<void> {
  const moves = await db.stockMoves.where('refId').equals(rx.id).filter((m) => m.deleted === 0 && m.reason === 'dispense').toArray()
  const current = new Map<string, number>()
  for (const m of moves) current.set(m.stockItemId, roundQty((current.get(m.stockItemId) ?? 0) - m.delta))
  const want = new Map<string, number>()
  if (target?.stockItemId && target.qty && target.qty > 0) want.set(target.stockItemId, roundQty(target.qty))

  for (const id of new Set([...current.keys(), ...want.keys()])) {
    const diff = roundQty((want.get(id) ?? 0) - (current.get(id) ?? 0))
    if (diff === 0) continue
    const item = await db.stockItems.get(id)
    if (!item) throw new StockError('Stock item not found')
    if (diff > 0) {
      if (item.deleted) throw new StockError('That stock item has been deleted; choose another')
      if (item.remedyId !== rx.remedyId || !samePotency(item.potency, rx.potency)) {
        throw new StockError('The stock item does not match the remedy and potency')
      }
    }
    const note = !current.has(id) ? undefined : want.has(id) ? 'Visit edited' : 'Removed from visit'
    await addMove(item, -diff, 'dispense', date, { refId: rx.id, note })
  }
}

// Counter sales: makes the net quantity a bill has taken out of each stock
// item match `want` (stockItemId -> qty; empty to return everything, e.g. on
// void). Diff-based like syncDispense; call inside a tx covering stockItems
// and stockMoves.
export async function syncBillSale(billId: string, want: Map<string, number>, date: string, note: string): Promise<void> {
  const moves = await db.stockMoves.where('refId').equals(billId).filter((m) => m.deleted === 0 && m.reason === 'dispense').toArray()
  const current = new Map<string, number>()
  for (const m of moves) current.set(m.stockItemId, roundQty((current.get(m.stockItemId) ?? 0) - m.delta))
  for (const id of new Set([...current.keys(), ...want.keys()])) {
    const diff = roundQty((want.get(id) ?? 0) - (current.get(id) ?? 0))
    if (diff === 0) continue
    const item = await db.stockItems.get(id)
    if (!item) throw new StockError('Stock item not found')
    if (diff > 0 && item.deleted) throw new StockError('That stock item has been deleted; choose another')
    await addMove(item, -diff, 'dispense', date, { refId: billId, note: current.has(id) || diff < 0 ? note : 'Counter sale' })
  }
}

// ---- queries ----

export type StockFilter = 'all' | 'low' | 'negative'

export interface StockRow extends StockItem {
  remedyName: string
}

function withNames(items: StockItem[], remedies: Map<string, Remedy>): StockRow[] {
  return items
    .map((i) => ({ ...i, remedyName: remedies.get(i.remedyId)?.name ?? 'Unknown remedy' }))
    .sort((a, b) => a.remedyName.localeCompare(b.remedyName) || a.potency.localeCompare(b.potency, undefined, { numeric: true }) || a.form.localeCompare(b.form))
}

export async function stockList(opts: { search?: string; filter?: StockFilter; form?: StockForm | '' } = {}): Promise<StockRow[]> {
  const remedies = await remedyMap()
  const q = opts.search?.trim().toLowerCase() ?? ''
  const items = await db.stockItems
    .where('deleted')
    .equals(0)
    .filter((i) => {
      if (opts.form && i.form !== opts.form) return false
      if (opts.filter === 'low' && stockStatus(i) === 'ok') return false
      if (opts.filter === 'negative' && i.qty > 0) return false
      if (!q) return true
      const r = remedies.get(i.remedyId)
      const hay = `${r?.name ?? ''} ${r?.abbrev ?? ''} ${i.potency}`.toLowerCase()
      return q.split(/\s+/).every((w) => hay.includes(w))
    })
    .toArray()
  return withNames(items, remedies)
}

// qty <= lowStockAt, worst first (out of stock, then by how far below the level).
export async function lowStockItems(): Promise<StockRow[]> {
  const rows = await stockList({ filter: 'low' })
  const ratio = (r: StockRow) => (r.lowStockAt > 0 ? r.qty / r.lowStockAt : r.qty)
  return rows.sort((a, b) => Number(b.qty <= 0) - Number(a.qty <= 0) || ratio(a) - ratio(b))
}

export const byMoveDate = (a: StockMove, b: StockMove) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt

export interface MoveRow extends StockMove {
  balance: number
  visit?: { patientId: string; visitId: string; patientName?: string }
  bill?: { billId: string; billNo: string; patientId: string; patientName?: string }
}

// Oldest first, each with the running balance after it.
export async function movesFor(stockItemId: string): Promise<MoveRow[]> {
  const moves = (await db.stockMoves.where('stockItemId').equals(stockItemId).filter((m) => m.deleted === 0).toArray()).sort(byMoveDate)
  let balance = 0
  const out: MoveRow[] = []
  for (const m of moves) {
    balance = roundQty(balance + m.delta)
    const row: MoveRow = { ...m, balance }
    if (m.refId) {
      const rx = await db.prescriptionItems.get(m.refId)
      if (rx) row.visit = { patientId: rx.patientId, visitId: rx.visitId, patientName: (await db.patients.get(rx.patientId))?.name }
      else {
        const bill = await db.bills.get(m.refId)
        if (bill) row.bill = { billId: bill.id, billNo: bill.billNo, patientId: bill.patientId, patientName: (await db.patients.get(bill.patientId))?.name }
      }
    }
    out.push(row)
  }
  return out
}

// Stock items for a prescription row's picker (non-deleted, potency matched
// case-insensitively).
export async function findStock(remedyId: string, potency: string): Promise<StockItem[]> {
  if (!remedyId || !potency.trim()) return []
  const items = await db.stockItems
    .where('remedyId')
    .equals(remedyId)
    .filter((i) => i.deleted === 0 && samePotency(i.potency, potency))
    .toArray()
  return items.sort((a, b) => a.form.localeCompare(b.form))
}

export async function activeStockCountForRemedy(remedyId: string): Promise<number> {
  return db.stockItems.where('remedyId').equals(remedyId).filter((i) => i.deleted === 0).count()
}

export interface UsageRow {
  stockItemId: string
  item?: StockItem
  remedyName: string
  dispensed: number
}

// Net quantity dispensed per item between two ISO dates (inclusive). Visit
// edits add correcting dispense moves, so they net out here.
export async function stockUsage(from: string, to: string): Promise<UsageRow[]> {
  const moves = await db.stockMoves
    .where('date')
    .between(from, to, true, true)
    .filter((m) => m.deleted === 0 && m.reason === 'dispense')
    .toArray()
  const totals = new Map<string, number>()
  for (const m of moves) totals.set(m.stockItemId, (totals.get(m.stockItemId) ?? 0) - m.delta)
  const remedies = await remedyMap()
  const out: UsageRow[] = []
  for (const [stockItemId, qty] of totals) {
    const dispensed = roundQty(qty)
    if (dispensed === 0) continue
    const item = await db.stockItems.get(stockItemId)
    out.push({ stockItemId, item, remedyName: (item && remedies.get(item.remedyId)?.name) ?? 'Unknown remedy', dispensed })
  }
  return out.sort((a, b) => b.dispensed - a.dispensed || a.remedyName.localeCompare(b.remedyName))
}

export interface MedicineLine {
  desc: string
  amount: number
  stockItemId: string
  qty: number
  unpriced: boolean
}

// One bill line per dispensed prescription row of a visit.
export async function billLinesForVisit(visitId: string): Promise<MedicineLine[]> {
  const rx = (await db.prescriptionItems.where('visitId').equals(visitId).filter((i) => i.deleted === 0).toArray()).sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt - b.createdAt,
  )
  const remedies = await remedyMap()
  const out: MedicineLine[] = []
  for (const r of rx) {
    if (!r.stockItemId || !(r.qtyDispensed && r.qtyDispensed > 0)) continue
    const item = await db.stockItems.get(r.stockItemId)
    if (!item) continue
    const name = remedies.get(r.remedyId)?.name ?? 'Medicine'
    out.push({
      desc: medicineLineDesc(name, r.potency, r.qtyDispensed, item.unit),
      amount: round2(r.qtyDispensed * item.price),
      stockItemId: item.id,
      qty: r.qtyDispensed,
      unpriced: !(item.price > 0),
    })
  }
  return out
}
