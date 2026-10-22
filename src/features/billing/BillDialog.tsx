import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Modal } from '../../app/Modal'
import { getSettings } from '../../db/repo'
import type { Bill, BillItem, Patient, Payment, PaymentMode } from '../../db/types'
import { addDays, formatINR, parseAmount, todayISO } from '../../lib/format'
import { PatientPicker } from '../appointments/PatientPicker'
import { ModeSelect } from './BillBits'
import { createBill, editBill, round2 } from './billingRepo'
import { billLinesForVisit } from '../stock/stockRepo'
import { formatQty } from '../stock/stockLogic'
import { StockSalePicker } from './StockSalePicker'

interface Row {
  key: string
  desc: string
  amount: string
  stockItemId?: string
  qty?: number
  sale?: true
  unpriced?: boolean
}

let rowSeq = 0
const row = (desc = '', amount = '', extra: Partial<Row> = {}): Row => ({ key: `r${++rowSeq}`, desc, amount, ...extra })
const isBlank = (r: Row) => !r.desc.trim() && !r.amount.trim()
const fieldId = (key: string, field: 'desc' | 'amount') => `bill-${key}-${field}`

function rowsFromItems(items: BillItem[]): Row[] {
  return items.map((i) => row(i.desc, String(i.amount), { stockItemId: i.stockItemId, qty: i.qty, sale: i.sale }))
}

export function BillDialog({
  patient: initialPatient = null,
  visitId,
  bill,
  onClose,
}: {
  patient?: Patient | null
  visitId?: string
  bill?: Bill // edit mode
  onClose: () => void
}) {
  const editing = !!bill
  const [patient, setPatient] = useState<Patient | null>(initialPatient)
  const [date, setDate] = useState(bill?.date ?? todayISO())
  const [rows, setRows] = useState<Row[]>(() => (bill ? rowsFromItems(bill.items) : [visitId ? row('Consultation') : row()]))
  const [discount, setDiscount] = useState(bill?.discount ? String(bill.discount) : '')
  const [payAmount, setPayAmount] = useState('')
  const [mode, setMode] = useState<PaymentMode>('cash')
  const [dueDate, setDueDate] = useState(bill?.dueDate ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<{ bill: Bill; payment?: Payment } | null>(null)
  const [picking, setPicking] = useState(false)
  const [focusTo, setFocusTo] = useState<{ key: string; field: 'desc' | 'amount' } | null>(null)

  // Focus a row's field after it's been added (runs once the row is rendered).
  useEffect(() => {
    if (!focusTo) return
    const el = document.getElementById(fieldId(focusTo.key, focusTo.field)) as HTMLInputElement | null
    el?.focus()
    el?.select()
    setFocusTo(null)
  }, [focusTo])

  useEffect(() => {
    let cancelled = false
    Promise.all([getSettings(), !bill && visitId ? billLinesForVisit(visitId) : []]).then(([s, lines]) => {
      if (cancelled) return
      if (lines.length) {
        const meds = lines.map((l) => row(l.desc, l.unpriced ? '' : String(l.amount), { stockItemId: l.stockItemId, qty: l.qty, unpriced: l.unpriced }))
        setRows((rs) => [...rs, ...meds])
      }
      if (!bill) {
        if (visitId && s.consultationFee > 0) {
          const fee = String(s.consultationFee)
          setRows((rs) => rs.map((r) => (r.desc === 'Consultation' && !r.amount ? { ...r, amount: fee } : r)))
        }
        setDueDate(addDays(todayISO(), s.defaultDueDays > 0 ? s.defaultDueDays : 30))
      } else if (!bill.dueDate) {
        setDueDate(addDays(todayISO(), s.defaultDueDays > 0 ? s.defaultDueDays : 30))
      }
    })
    return () => {
      cancelled = true
    }
  }, [bill, visitId])

  const subtotal = round2(rows.reduce((s, r) => s + (parseAmount(r.amount) || 0), 0))
  const disc = parseAmount(discount) || 0
  const total = round2(subtotal - disc)
  const alreadyPaid = bill?.paid ?? 0
  const payNow = editing ? 0 : parseAmount(payAmount) || 0
  const balance = round2(total - alreadyPaid - payNow)

  // Fills the first blank row with the new line instead of piling blank rows up
  // above it; appends only when every row is in use. Then focuses the next field
  // to fill in (the amount when the description is already set).
  function addRow(r: Row) {
    setRows((rs) => {
      const i = rs.findIndex(isBlank)
      if (i === -1) return [...rs, r]
      // Blank rows past the first are just clutter once one has been filled.
      return rs.flatMap((x, n) => (n === i ? [r] : isBlank(x) ? [] : [x]))
    })
    setFocusTo({ key: r.key, field: r.desc && !r.amount ? 'amount' : 'desc' })
    setError('')
  }

  function addBlankRow() {
    const blank = rows.find(isBlank)
    if (blank) setFocusTo({ key: blank.key, field: 'desc' })
    else addRow(row())
  }

  function setRow(key: string, changes: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...changes } : r)))
    setError('')
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!patient) return setError('Choose a patient')
    // Fully blank rows are ignored rather than rejected.
    const used = rows.filter((r) => r.desc.trim() || r.amount.trim())
    const items: BillItem[] = used.map((r) => {
      const it: BillItem = { desc: r.desc, amount: parseAmount(r.amount) }
      if (r.stockItemId) it.stockItemId = r.stockItemId
      if (r.qty != null) it.qty = r.qty
      if (r.sale) it.sale = true
      return it
    })
    if (Number.isNaN(disc) || Number.isNaN(parseAmount(payAmount))) return setError('Enter amounts as numbers')
    if (balance > 0 && !dueDate) return setError('Enter a due date for the balance')
    setSaving(true)
    try {
      if (bill) {
        const updated = await editBill(bill.id, { items, discount: disc, date, dueDate })
        setSaved({ bill: updated })
      } else {
        setSaved(
          await createBill({
            patientId: patient.id,
            visitId,
            date,
            items,
            discount: disc,
            dueDate,
            payNow: payNow ? { amount: payNow, mode } : undefined,
          }),
        )
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (saved) {
    return (
      // Keyed so it mounts fresh and moves focus to "Print receipt".
      <Modal key="saved" title={editing ? 'Bill updated' : 'Bill saved'} onClose={onClose}>
        <div className="space-y-3 text-sm" data-testid="bill-saved">
          <p>
            <span className="font-mono font-medium">{saved.bill.billNo}</span> · total {formatINR(saved.bill.total)}
            {saved.payment && <> · paid {formatINR(saved.payment.amount)}</>}
            {saved.bill.balance > 0 ? <> · balance {formatINR(saved.bill.balance)}</> : <> · fully paid</>}
          </p>
          <div className="flex flex-wrap gap-2">
            {saved.payment && (
              <Link to={`/print/receipt/${saved.payment.id}`} className="btn-primary" data-autofocus>
                Print receipt
              </Link>
            )}
            <Link to={`/print/bill/${saved.bill.id}`} className={saved.payment ? 'btn-ghost border border-slate-300' : 'btn-primary'} data-autofocus={saved.payment ? undefined : true}>
              Print bill
            </Link>
            <button type="button" className="btn-ghost border border-slate-300" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  const paymentsLocked = editing && alreadyPaid > 0

  return (
    <Modal title={editing ? `Edit ${bill.billNo}` : 'New bill'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {initialPatient || editing ? (
          patient && (
            <p className="text-sm">
              <span className="font-medium">{patient.name}</span> <span className="font-mono text-xs text-slate-500">{patient.opNo}</span>
            </p>
          )
        ) : (
          <PatientPicker value={patient} onChange={setPatient} />
        )}

        <div className="max-w-[12rem]">
          <label className="label" htmlFor="bill-date">
            Bill date
          </label>
          <input
            id="bill-date"
            type="date"
            className="input"
            value={date}
            disabled={paymentsLocked}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        <fieldset className="space-y-2">
          <legend className="label">Items</legend>
          {rows.map((r, i) => (
            <div key={r.key} data-testid="bill-row">
            <div className="flex gap-2">
              <input
                id={fieldId(r.key, 'desc')}
                className="input min-w-0 flex-1"
                aria-label={`Item ${i + 1}`}
                placeholder="Description"
                value={r.desc}
                data-autofocus={i === 0 && !r.desc ? true : undefined}
                onChange={(e) => setRow(r.key, { desc: e.target.value })}
              />
              <input
                id={fieldId(r.key, 'amount')}
                className="input w-28 text-right"
                aria-label={`Amount ${i + 1}`}
                placeholder="₹"
                inputMode="decimal"
                value={r.amount}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setRow(r.key, { amount: e.target.value })}
              />
              <button
                type="button"
                className="btn-ghost px-2 text-red-700"
                aria-label={`Remove item ${i + 1}`}
                onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [row()]))}
              >
                ✕
              </button>
            </div>
            {r.sale && r.qty != null && (
              <p className="mt-1 text-xs text-slate-500" data-testid="sale-note">
                Counter sale: saving takes {formatQty(r.qty)} out of stock{editing ? ' (adjusted to match on edit)' : ''}.
              </p>
            )}
            {r.unpriced && !r.amount && (
              <p className="mt-1 text-xs text-amber-700" data-testid="unpriced-note">
                No price set for this stock item. Enter the amount, or leave it blank to bill it at ₹0.
              </p>
            )}
            </div>
          ))}
          {picking && (
            <StockSalePicker
              onCancel={() => setPicking(false)}
              onAdd={(l) => {
                addRow(row(l.desc, l.amount > 0 ? String(l.amount) : '', { stockItemId: l.stockItemId, qty: l.qty, sale: true, unpriced: !(l.amount > 0) }))
                setPicking(false)
              }}
            />
          )}
          <div className="flex flex-wrap gap-2">
            {!picking && (
              <button type="button" className="btn-ghost border border-brand-500 px-3 py-1 text-brand-700" onClick={() => setPicking(true)}>
                + Medicine from stock
              </button>
            )}
            <button type="button" className="btn-ghost border border-slate-300 px-3 py-1" onClick={() => addRow(row('Medicines'))}>
              + Medicines
            </button>
            {!rows.some((r) => r.desc === 'Consultation') && (
              <button
                type="button"
                className="btn-ghost border border-slate-300 px-3 py-1"
                onClick={async () => {
                  const s = await getSettings()
                  addRow(row('Consultation', s.consultationFee > 0 ? String(s.consultationFee) : ''))
                }}
              >
                + Consultation
              </button>
            )}
            <button type="button" className="btn-ghost border border-dashed border-slate-300 px-3 py-1" onClick={addBlankRow}>
              + Item
            </button>
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="bill-discount">
              Discount
            </label>
            <input
              id="bill-discount"
              className="input text-right"
              inputMode="decimal"
              placeholder="0"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
            />
          </div>
          <div className="text-right">
            <div className="label">Total</div>
            <div className="py-2 text-lg font-semibold" data-testid="bill-total">
              {formatINR(Number.isFinite(total) ? total : 0)}
            </div>
          </div>
        </div>

        {editing ? (
          alreadyPaid > 0 && <p className="text-sm text-slate-600">Already paid {formatINR(alreadyPaid)}. The total cannot go below this.</p>
        ) : (
          <fieldset className="rounded-md border border-slate-200 p-3">
            <legend className="px-1 text-sm font-medium text-slate-700">Paid now</legend>
            <div className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_auto_8rem]">
              <input
                id="bill-pay"
                aria-label="Amount paid now"
                className="input text-right"
                inputMode="decimal"
                placeholder="0"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
              />
              <button
                type="button"
                className="btn-ghost border border-brand-500 px-3 text-brand-700"
                onClick={() => setPayAmount(total > 0 ? String(total) : '')}
              >
                Full
              </button>
              <div className="col-span-2 sm:col-span-1">
                <label className="sr-only" htmlFor="bill-mode">
                  Payment mode
                </label>
                <ModeSelect id="bill-mode" value={mode} onChange={setMode} />
              </div>
            </div>
          </fieldset>
        )}

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="text-sm">
            Balance{' '}
            <span className={`font-semibold ${balance > 0 ? 'text-amber-700' : 'text-brand-700'}`} data-testid="bill-balance">
              {formatINR(Number.isFinite(balance) ? balance : 0)}
            </span>
          </div>
          {balance > 0 && (
            <div className="w-44">
              <label className="label" htmlFor="bill-due">
                Due date
              </label>
              <input id="bill-due" type="date" className="input" value={dueDate} min={date} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button type="submit" className="btn-primary" disabled={saving}>
            {editing ? 'Save changes' : 'Save bill'}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  )
}
