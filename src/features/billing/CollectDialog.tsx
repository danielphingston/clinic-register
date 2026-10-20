import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Modal } from '../../app/Modal'
import type { Bill, Patient, Payment, PaymentMode } from '../../db/types'
import { formatINR, parseAmount, todayISO } from '../../lib/format'
import { ModeSelect } from './BillBits'
import { collectFromPatient, patientDues, recordPayment } from './billingRepo'

// Collects towards one bill, or (without `bill`) towards the patient's dues,
// oldest bill first.
export function CollectDialog({ patient, bill, onClose }: { patient: Patient; bill?: Bill; onClose: () => void }) {
  const dues = useLiveQuery(async () => patientDues(patient.id), [patient.id])
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState<PaymentMode>('cash')
  const [date, setDate] = useState(todayISO())
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<Payment[] | null>(null)

  const max = bill ? bill.balance : dues?.balance

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const amt = parseAmount(amount)
    if (!(amt > 0)) return setError('Enter an amount above zero')
    if (!date) return setError('Enter the payment date')
    setSaving(true)
    try {
      setDone(bill ? [await recordPayment(bill.id, amt, mode, date)] : await collectFromPatient(patient.id, amt, mode, date))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    const total = done.reduce((s, p) => s + p.amount, 0)
    return (
      <Modal title="Payment recorded" onClose={onClose}>
        <div className="space-y-3 text-sm" data-testid="payment-done">
          <p>
            {formatINR(total)} received from <span className="font-medium">{patient.name}</span>.
            {done.length > 1 && ` Split across ${done.length} bills, oldest first.`}
          </p>
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {done.map((p, i) => (
              <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span>
                  <span className="font-mono">{p.receiptNo}</span> · {formatINR(p.amount)}
                </span>
                <Link to={`/print/receipt/${p.id}`} className="btn-ghost border border-brand-500 px-3 py-1 text-brand-700" data-autofocus={i === 0 ? true : undefined}>
                  Print receipt
                </Link>
              </li>
            ))}
          </ul>
          <button type="button" className="btn-ghost border border-slate-300" onClick={onClose}>
            Done
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={bill ? `Collect for ${bill.billNo}` : 'Collect payment'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <p className="text-sm">
          <span className="font-medium">{patient.name}</span> <span className="font-mono text-xs text-slate-500">{patient.opNo}</span>
          <br />
          {bill ? 'Bill balance' : 'Total dues'}{' '}
          <span className="font-semibold text-amber-700" data-testid="collect-max">
            {max == null ? '…' : formatINR(max)}
          </span>
          {!bill && dues && dues.bills.length > 1 && <span className="text-slate-500"> across {dues.bills.length} bills</span>}
        </p>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <div>
            <label className="label" htmlFor="collect-amount">
              Amount
            </label>
            <input
              id="collect-amount"
              className="input text-right"
              inputMode="decimal"
              value={amount}
              data-autofocus
              onChange={(e) => {
                setAmount(e.target.value)
                setError('')
              }}
            />
          </div>
          <button
            type="button"
            className="btn-ghost mt-6 border border-brand-500 px-3 text-brand-700"
            disabled={!max}
            onClick={() => setAmount(String(max ?? ''))}
          >
            Full
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="collect-mode">
              Mode
            </label>
            <ModeSelect id="collect-mode" value={mode} onChange={setMode} />
          </div>
          <div>
            <label className="label" htmlFor="collect-date">
              Date
            </label>
            <input id="collect-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button type="submit" className="btn-primary" disabled={saving || !max}>
            Record payment
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  )
}
