import type { Table } from 'dexie'
import type { ClinicDB } from '../db/db'
import type { BaseRecord, Bill, Certificate, KV, Patient, Payment, StockItem, StockMove } from '../db/types'
import { roundQty } from '../features/stock/stockLogic'
import { toISODate, todayISO } from '../lib/format'
import { diffMerge, type SyncRecord } from './merge'
import { SYNC_APPLY, SYNCED_KV_KEYS } from './tracking'
import type { RenumberNotice, SyncTableName } from './types'

// Applying a set of remote records (from Drive or a backup file) to a local
// database: merge, keep unique numbers unique, then fix derived values.

export const NOTICES_KEY = 'sync:notices'

export interface Touched {
  stockItems: Set<string>
  bills: Set<string>
}

export function newTouched(): Touched {
  return { stockItems: new Set(), bills: new Set() }
}

export interface ApplyOptions {
  // Tag the transaction so change tracking ignores it (true for Drive pulls;
  // false for backup imports, which are new local data that must be pushed).
  tag: boolean
  now: number
  touched: Touched
  notices: RenumberNotice[]
}

export interface ApplyResult {
  written: number
  localNewer: boolean
}

const round2 = (n: number) => Math.round(n * 100) / 100

type UniqueField = 'opNo' | 'billNo' | 'certNo'

const UNIQUE: Partial<Record<SyncTableName, { field: UniqueField; counter: string }>> = {
  patients: { field: 'opNo', counter: 'op' },
  bills: { field: 'billNo', counter: 'bill' },
  certificates: { field: 'certNo', counter: 'cert' },
}

// <prefix>-<YYYY>-<n>, as made by nextOpNo / billing.
const NUMBER_RE = /^(.*)-(\d{4})-(\d+)$/

function validRecord(r: unknown, table: SyncTableName): r is SyncRecord {
  if (!r || typeof r !== 'object') return false
  const o = r as Record<string, unknown>
  if (typeof o.updatedAt !== 'number') return false
  return table === 'kv' ? typeof o.key === 'string' : typeof o.id === 'string'
}

function tagTx(tx: unknown, tag: boolean) {
  if (tag) (tx as Record<string, unknown>)[SYNC_APPLY] = true
}

export async function applyRecords(db: ClinicDB, table: SyncTableName, incoming: unknown[], opts: ApplyOptions): Promise<ApplyResult> {
  const remote = incoming.filter((r) => validRecord(r, table))
  if (table === 'kv') return applyKV(db, remote as unknown as KV[], opts)

  const tbl = db.table(table) as Table<BaseRecord & SyncRecord, string>
  return db.transaction('rw', [tbl, db.kv], async (tx) => {
    tagTx(tx, opts.tag)
    const local = await tbl.toArray()
    const { toWrite, localNewer: newer } = diffMerge(local, remote as (BaseRecord & SyncRecord)[])
    let localNewer = newer
    let writes = toWrite

    const uniq = UNIQUE[table]
    if (uniq && writes.length) {
      const res = await dedupeNumbers(db, table as RenumberNotice['table'], uniq, local, writes, opts)
      writes = res.writes as typeof writes
      if (res.renumbered) localNewer = true
    }

    if (writes.length) {
      // A unique index can't hold two rows with the same number even for a
      // moment, so rows whose number changes are removed before the put.
      if (uniq) {
        const before = new Map(local.map((r) => [r.id, r[uniq.field]]))
        const moved = writes.filter((w) => before.has(w.id) && before.get(w.id) !== w[uniq.field]).map((w) => w.id)
        if (moved.length) await tbl.bulkDelete(moved)
      }
      await tbl.bulkPut(writes)
    }
    noteTouched(table, writes, local, opts.touched)
    return { written: writes.length, localNewer }
  })
}

async function applyKV(db: ClinicDB, remote: KV[], opts: ApplyOptions): Promise<ApplyResult> {
  const wanted = remote.filter((r) => SYNCED_KV_KEYS.includes(r.key))
  return db.transaction('rw', db.kv, async (tx) => {
    tagTx(tx, opts.tag)
    const local = (await db.kv.bulkGet(SYNCED_KV_KEYS)).filter((r): r is KV => !!r)
    const idOf = (r: KV) => r.key
    const { toWrite, localNewer } = diffMerge(local as unknown as SyncRecord[], wanted as unknown as SyncRecord[], idOf as never)
    if (toWrite.length) await db.kv.bulkPut(toWrite as unknown as KV[])
    return { written: toWrite.length, localNewer }
  })
}

function noteTouched(table: SyncTableName, writes: SyncRecord[], local: SyncRecord[], t: Touched) {
  const prev = new Map(local.map((r) => [r.id as string, r]))
  for (const w of writes) {
    const old = prev.get(w.id as string)
    if (table === 'stockItems') t.stockItems.add(w.id as string)
    if (table === 'stockMoves') {
      t.stockItems.add((w as unknown as StockMove).stockItemId)
      if (old) t.stockItems.add((old as unknown as StockMove).stockItemId)
    }
    if (table === 'bills') t.bills.add(w.id as string)
    if (table === 'payments') {
      t.bills.add((w as unknown as Payment).billId)
      if (old) t.bills.add((old as unknown as Payment).billId)
    }
  }
}

// After a merge, two different records may carry the same OP, bill or certificate number
// (two devices numbered offline). The older record keeps it; each newer one
// gets the next free number and a visible notice. Nothing is dropped.
async function dedupeNumbers(
  db: ClinicDB,
  table: RenumberNotice['table'],
  uniq: { field: UniqueField; counter: string },
  local: SyncRecord[],
  writes: SyncRecord[],
  opts: ApplyOptions,
): Promise<{ writes: SyncRecord[]; renumbered: boolean }> {
  const final = new Map(local.map((r) => [r.id as string, r]))
  const writeMap = new Map(writes.map((w) => [w.id as string, w]))
  for (const w of writes) final.set(w.id as string, w)

  const groups = new Map<string, SyncRecord[]>()
  for (const r of final.values()) {
    const no = r[uniq.field] as string
    groups.set(no, [...(groups.get(no) ?? []), r])
  }
  const used = new Set(groups.keys())
  let renumbered = false
  for (const [no, recs] of groups) {
    if (recs.length < 2) continue
    recs.sort((a, b) => (a.createdAt as number) - (b.createdAt as number) || ((a.id as string) < (b.id as string) ? -1 : 1))
    for (const r of recs.slice(1)) {
      const next = await freeNumber(db, uniq, no, used)
      used.add(next)
      const nr = { ...r, [uniq.field]: next, updatedAt: Math.max(opts.now, (r.updatedAt as number) + 1) }
      final.set(r.id as string, nr)
      writeMap.set(r.id as string, nr)
      opts.notices.push({ at: opts.now, table, id: r.id as string, from: no, to: next })
      renumbered = true
    }
  }
  return { writes: [...writeMap.values()], renumbered }
}

async function freeNumber(db: ClinicDB, uniq: { counter: string }, no: string, used: Set<string>): Promise<string> {
  const m = NUMBER_RE.exec(no)
  if (!m) {
    for (let i = 2; ; i++) if (!used.has(`${no}-${i}`)) return `${no}-${i}`
  }
  const [, prefix, year] = m
  const key = `seq:${uniq.counter}:${year}`
  let n = ((await db.kv.get(key))?.value as number | undefined) ?? 0
  for (const u of used) {
    const um = NUMBER_RE.exec(u)
    if (um && um[2] === year) n = Math.max(n, Number(um[3]))
  }
  let candidate: string
  do {
    n++
    candidate = `${prefix}-${year}-${String(n).padStart(5, '0')}`
  } while (used.has(candidate))
  await db.kv.put({ key, value: n, updatedAt: Date.now() })
  return candidate
}

// Stock quantities and bill totals are caches of their ledgers; rebuild the
// ones whose inputs changed. updatedAt is left alone: every device derives
// the same values, so this is not an edit to sync.
export async function recomputeDerived(db: ClinicDB, touched: Touched): Promise<void> {
  if (!touched.stockItems.size && !touched.bills.size) return
  await db.transaction('rw', [db.stockItems, db.stockMoves, db.bills, db.payments], async (tx) => {
    tagTx(tx, true)
    for (const id of touched.stockItems) {
      const item = await db.stockItems.get(id)
      if (!item) continue
      const moves = await db.stockMoves.where('stockItemId').equals(id).filter((m) => m.deleted === 0).toArray()
      const qty = roundQty(moves.reduce((s, m) => s + m.delta, 0))
      if (item.qty !== qty) await db.stockItems.put({ ...item, qty } as StockItem)
    }
    for (const id of touched.bills) {
      const bill = await db.bills.get(id)
      if (!bill || bill.deleted) continue
      const pays = await db.payments.where('billId').equals(id).filter((p) => p.deleted === 0).toArray()
      const paid = round2(pays.reduce((s, p) => s + p.amount, 0))
      const balance = round2(bill.total - paid)
      if (bill.paid !== paid || bill.balance !== balance) await db.bills.put({ ...bill, paid, balance } as Bill)
    }
  })
}

// Sequence counters are per device and not synced. After pulling another
// device's records, move each counter past the highest number in use so the
// next OP / bill / receipt / certificate / token here can't repeat one.
export async function bumpCounters(db: ClinicDB): Promise<void> {
  const max = new Map<string, number>()
  const see = (key: string, n: number) => {
    if (Number.isFinite(n) && n > (max.get(key) ?? 0)) max.set(key, n)
  }
  const today = todayISO()
  await db.transaction('rw', [db.patients, db.bills, db.payments, db.certificates, db.appointments, db.kv], async (tx) => {
    tagTx(tx, true)
    await db.patients.each((p: Patient) => {
      const m = NUMBER_RE.exec(p.opNo ?? '')
      if (m) see(`op:${m[2]}`, Number(m[3]))
    })
    await db.bills.each((b: Bill) => {
      const m = NUMBER_RE.exec(b.billNo ?? '')
      if (m) see(`bill:${m[2]}`, Number(m[3]))
    })
    await db.payments.each((p: Payment) => {
      const m = NUMBER_RE.exec(p.receiptNo ?? '')
      if (m) see(`rcpt:${m[2]}`, Number(m[3]))
    })
    await db.certificates.each((c: Certificate) => {
      const m = NUMBER_RE.exec(c.certNo ?? '')
      if (m) see(`cert:${m[2]}`, Number(m[3]))
    })
    const dayStart = new Date(`${today}T00:00:00`).getTime()
    await db.appointments
      .where('start')
      .between(dayStart, dayStart + 36 * 3600_000)
      .each((a) => {
        if (a.token != null && toISODate(new Date(a.start)) === today) see(`token:${today}`, a.token)
      })
    for (const [name, n] of max) {
      const key = `seq:${name}`
      const cur = ((await db.kv.get(key))?.value as number | undefined) ?? 0
      if (n > cur) await db.kv.put({ key, value: n, updatedAt: Date.now() })
    }
  })
}

export async function addNotices(db: ClinicDB, notices: RenumberNotice[]): Promise<void> {
  if (!notices.length) return
  await db.transaction('rw', db.kv, async () => {
    const cur = ((await db.kv.get(NOTICES_KEY))?.value as RenumberNotice[] | undefined) ?? []
    await db.kv.put({ key: NOTICES_KEY, value: [...cur, ...notices].slice(-50), updatedAt: Date.now() })
  })
}
