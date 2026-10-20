import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Modal } from '../../app/Modal'
import { db } from '../../db/db'
import { formatDate, formatINR, todayISO } from '../../lib/format'
import { BillStatusPill } from './BillBits'
import { MODE_LABEL, paymentsForBill, reversePayment } from './billingRepo'

export function BillView({ billId, onClose }: { billId: string; onClose: () => void }) {
  const data = useLiveQuery(async () => {
    const bill = await db.bills.get(billId)
    if (!bill || bill.deleted) return null
    return { bill, patient: await db.patients.get(bill.patientId), payments: await paymentsForBill(billId) }
  }, [billId])
  const [confirming, setConfirming] = useState<string | null>(null)
  const [error, setError] = useState('')

  if (data === undefined) return null
  if (data === null) {
    return (
      <Modal title="Bill" onClose={onClose}>
        <p className="text-sm">This bill no longer exists.</p>
      </Modal>
    )
  }
  const { bill, patient, payments } = data

  async function reverse(id: string) {
    setError('')
    try {
      await reversePayment(id)
      setConfirming(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Modal title={bill.billNo} onClose={onClose}>
      <div className="space-y-3 text-sm" data-testid="bill-view">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            <span className="font-medium">{patient?.name}</span> · {formatDate(bill.date)}
          </span>
          <BillStatusPill bill={bill} today={todayISO()} />
        </div>
        <table className="w-full">
          <tbody className="divide-y divide-slate-100">
            {bill.items.map((i, n) => (
              <tr key={n}>
                <td className="py-1">{i.desc}</td>
                <td className="py-1 text-right">{formatINR(i.amount)}</td>
              </tr>
            ))}
            {bill.discount > 0 && (
              <tr>
                <td className="py-1 text-slate-500">Discount</td>
                <td className="py-1 text-right">−{formatINR(bill.discount)}</td>
              </tr>
            )}
            <tr className="font-semibold">
              <td className="py-1">Total</td>
              <td className="py-1 text-right">{formatINR(bill.total)}</td>
            </tr>
            <tr>
              <td className="py-1">Paid</td>
              <td className="py-1 text-right">{formatINR(bill.paid)}</td>
            </tr>
            <tr className="font-semibold">
              <td className="py-1">Balance</td>
              <td className="py-1 text-right">{formatINR(bill.balance)}</td>
            </tr>
          </tbody>
        </table>
        {bill.balance > 0 && bill.dueDate && <p className="text-slate-600">Due {formatDate(bill.dueDate)}</p>}

        <h3 className="pt-2 font-semibold">Payments</h3>
        {payments.length === 0 && <p className="text-slate-500">No payments yet.</p>}
        <ul className="divide-y divide-slate-100">
          {payments.map((p) => (
            <li key={p.id} className="py-2" data-testid="bill-payment">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {formatDate(p.date)} · <span className="font-mono text-xs">{p.receiptNo}</span> · {formatINR(p.amount)} {MODE_LABEL[p.mode]}
                </span>
                <span className="flex gap-1">
                  <Link to={`/print/receipt/${p.id}`} className="btn-ghost px-2 py-1 text-brand-700">
                    Receipt
                  </Link>
                  <button type="button" className="btn-ghost px-2 py-1 text-red-700" onClick={() => setConfirming(p.id)}>
                    Reverse
                  </button>
                </span>
              </div>
              {confirming === p.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-red-50 p-2" role="group" aria-label="Confirm reverse">
                  <span className="text-red-800">Reverse {formatINR(p.amount)}? The bill balance goes back up.</span>
                  <button type="button" className="btn-primary bg-red-700 px-3 py-1 hover:bg-red-800" onClick={() => reverse(p.id)}>
                    Yes, reverse
                  </button>
                  <button type="button" className="btn-ghost px-3 py-1" onClick={() => setConfirming(null)}>
                    Keep
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {error && (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
        <div className="flex gap-2 pt-1">
          <Link to={`/print/bill/${bill.id}`} className="btn-primary">
            Print bill
          </Link>
          <button type="button" className="btn-ghost border border-slate-300" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  )
}
