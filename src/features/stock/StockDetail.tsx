import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Modal } from '../../app/Modal'
import { db } from '../../db/db'
import type { StockItem, StockMoveReason } from '../../db/types'
import { formatDate, formatINR, todayISO } from '../../lib/format'
import { remedyMap } from '../remedies/remedyRepo'
import { StockItemDialog } from './StockItemDialog'
import { FORM_LABEL, formatQty, STATUS_QTY, stockStatus } from './stockLogic'
import { adjust, deleteStockItem, movesFor, purchase, type MoveRow } from './stockRepo'

const REASON_LABEL: Record<StockMoveReason, string> = { purchase: 'Purchase', dispense: 'Dispensed', adjust: 'Adjustment' }

const toNum = (s: string) => Number(s.trim().replace(/,/g, ''))

function PurchaseDialog({ item, onClose }: { item: StockItem; onClose: () => void }) {
  const [qty, setQty] = useState('')
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    try {
      await purchase(item.id, qty.trim() ? toNum(qty) : NaN, note, date)
      onClose()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Modal title="Add stock" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="pu-qty">
              Quantity ({item.unit})
            </label>
            <input id="pu-qty" className="input text-right" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="pu-date">
              Date
            </label>
            <input id="pu-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="pu-note">
            Note
          </label>
          <input id="pu-note" className="input" placeholder="Supplier, invoice no…" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button type="submit" className="btn-primary">
            Add stock
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  )
}

function AdjustDialog({ item, onClose }: { item: StockItem; onClose: () => void }) {
  const [mode, setMode] = useState<'count' | 'delta'>('count')
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const n = value.trim() ? toNum(value) : NaN

  async function submit(e: FormEvent) {
    e.preventDefault()
    try {
      await adjust(item.id, mode === 'count' ? { newQty: n } : { delta: n }, note)
      onClose()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Modal title="Adjust stock" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <p className="text-sm text-slate-600">
          Current stock: <span className="font-medium">{formatQty(item.qty)} {item.unit}</span>
        </p>
        <div className="flex gap-4 text-sm" role="radiogroup" aria-label="Adjustment type">
          <label className="flex items-center gap-1">
            <input type="radio" name="adj-mode" checked={mode === 'count'} onChange={() => setMode('count')} /> Counted quantity
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" name="adj-mode" checked={mode === 'delta'} onChange={() => setMode('delta')} /> Change by (±)
          </label>
        </div>
        <div>
          <label className="label" htmlFor="adj-value">
            {mode === 'count' ? `Counted quantity (${item.unit})` : `Change (${item.unit}, negative to remove)`}
          </label>
          <input id="adj-value" className="input text-right" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          {mode === 'count' && Number.isFinite(n) && (
            <p className="mt-1 text-xs text-slate-500">
              Change: {n - item.qty > 0 ? '+' : ''}
              {formatQty(n - item.qty)} {item.unit}
            </p>
          )}
        </div>
        <div>
          <label className="label" htmlFor="adj-note">
            Reason
          </label>
          <input id="adj-note" className="input" placeholder="Stock count, spillage, expired…" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button type="submit" className="btn-primary">
            Save adjustment
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  )
}

export function StockDetail() {
  const { stockId = '' } = useParams()
  const navigate = useNavigate()
  const item = useLiveQuery(async () => (await db.stockItems.get(stockId)) ?? null, [stockId])
  const remedies = useLiveQuery(remedyMap)
  const moves = useLiveQuery(async () => movesFor(stockId), [stockId])
  const [dialog, setDialog] = useState<'purchase' | 'adjust' | 'edit' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')

  if (item === undefined) return null
  if (!item || item.deleted) {
    return (
      <div className="card text-sm">
        Stock item not found.{' '}
        <Link to="/stock" className="text-brand-700 underline">
          Back to stock
        </Link>
      </div>
    )
  }

  const st = stockStatus(item)
  const name = remedies?.get(item.remedyId)?.name ?? ''

  async function remove() {
    try {
      await deleteStockItem(item!.id, { writeOff: item!.qty !== 0 })
      navigate('/stock', { replace: true })
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="space-y-4">
      <Link to="/stock" className="text-sm text-brand-700 hover:underline">
        ← Stock
      </Link>
      <div className="card space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">
              {name} <span className="text-brand-700">{item.potency}</span>
            </h1>
            <p className="text-sm text-slate-600">
              {FORM_LABEL[item.form]} · low at {formatQty(item.lowStockAt)} {item.unit} ·{' '}
              {item.price > 0 ? `${formatINR(item.price)} per ${item.unit}` : 'no price set'}
            </p>
          </div>
          <div className="sm:text-right">
            <div className="text-xs text-slate-500">In stock</div>
            <div className={`text-2xl font-semibold ${STATUS_QTY[st]}`} data-testid="stock-qty" data-status={st}>
              {formatQty(item.qty)} {item.unit}
            </div>
            {st !== 'ok' && <div className={`text-xs font-medium ${STATUS_QTY[st]}`}>{st === 'low' ? 'Low stock' : item.qty < 0 ? 'Negative stock: recount and adjust' : 'Out of stock'}</div>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={() => setDialog('purchase')}>
            Purchase
          </button>
          <button type="button" className="btn-ghost border border-slate-300" onClick={() => setDialog('adjust')}>
            Adjust
          </button>
          <button type="button" className="btn-ghost border border-slate-300" onClick={() => setDialog('edit')}>
            Edit
          </button>
          {!confirmDelete && (
            <button type="button" className="btn-ghost text-red-700" onClick={() => setConfirmDelete(true)}>
              {item.qty === 0 ? 'Delete' : 'Write off'}
            </button>
          )}
        </div>
        {confirmDelete && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm" data-testid="delete-confirm">
            <span className="flex-1">
              {item.qty === 0
                ? `Delete ${name} ${item.potency}? Its history is kept.`
                : `Write off ${formatQty(item.qty)} ${item.unit} and delete ${name} ${item.potency}? An adjustment to 0 is recorded first.`}
            </span>
            <button type="button" className="btn bg-red-600 px-3 py-1 text-white hover:bg-red-700" onClick={remove}>
              {item.qty === 0 ? 'Confirm delete' : 'Write off & delete'}
            </button>
            <button type="button" className="btn-ghost px-3 py-1" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
      </div>

      <section className="card" aria-labelledby="moves-heading">
        <h2 id="moves-heading" className="font-semibold">
          History
        </h2>
        {moves && moves.length === 0 && <p className="mt-2 text-sm text-slate-500">No stock movements yet.</p>}
        {moves && moves.length > 0 && (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm" data-testid="moves-table">
              <thead className="text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">Date</th>
                  <th className="py-1 pr-3 font-medium">Reason</th>
                  <th className="py-1 pr-3 text-right font-medium">Change</th>
                  <th className="py-1 pr-3 text-right font-medium">Balance</th>
                  <th className="hidden py-1 font-medium sm:table-cell">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[...moves].reverse().map((m) => (
                  <tr key={m.id} data-testid="move-row">
                    <td className="whitespace-nowrap py-1.5 pr-3">{formatDate(m.date)}</td>
                    <td className="py-1.5 pr-3">
                      {m.reason === 'dispense' && m.delta > 0 ? 'Returned' : REASON_LABEL[m.reason]}
                      {(m.visit || m.bill || m.note) && (
                        <div className="text-xs text-slate-500 sm:hidden">
                          <MoveDetails m={m} />
                        </div>
                      )}
                    </td>
                    <td className={`whitespace-nowrap py-1.5 pr-3 text-right font-medium ${m.delta < 0 ? 'text-slate-700' : 'text-brand-700'}`}>
                      {m.delta > 0 ? '+' : ''}
                      {formatQty(m.delta)}
                    </td>
                    <td className={`whitespace-nowrap py-1.5 pr-3 text-right ${m.balance < 0 ? 'text-red-700' : ''}`}>{formatQty(m.balance)}</td>
                    <td className="hidden py-1.5 text-slate-600 sm:table-cell">
                      <MoveDetails m={m} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {dialog === 'purchase' && <PurchaseDialog item={item} onClose={() => setDialog(null)} />}
      {dialog === 'adjust' && <AdjustDialog item={item} onClose={() => setDialog(null)} />}
      {dialog === 'edit' && <StockItemDialog item={item} onClose={() => setDialog(null)} />}
    </div>
  )
}

// Where a move came from: the visit or the counter-sale bill, plus its note.
function MoveDetails({ m }: { m: MoveRow }) {
  const parts = []
  if (m.visit) {
    parts.push(
      <Link key="v" to={`/patients/${m.visit.patientId}/visits/${m.visit.visitId}`} className="text-brand-700 hover:underline">
        {m.visit.patientName ?? 'Visit'}
      </Link>,
    )
  }
  if (m.bill) {
    parts.push(
      <Link key="b" to={`/print/bill/${m.bill.billId}`} className="text-brand-700 hover:underline">
        {m.bill.billNo}
        {m.bill.patientName && ` · ${m.bill.patientName}`}
      </Link>,
    )
  }
  if (m.note) parts.push(<span key="n">{m.note}</span>)
  return <>{parts.flatMap((p, i) => (i ? [' · ', p] : [p]))}</>
}
