import { useLiveQuery } from 'dexie-react-hooks'
import { useParams } from 'react-router-dom'
import { db } from '../db/db'
import { ageSex } from '../lib/age'
import { amountInWords } from '../lib/amountInWords'
import { formatDate, formatINR } from '../lib/format'
import { Letterhead, PrintShell } from './PrintShell'

export function PrintBill() {
  const { billId = '' } = useParams()
  const data = useLiveQuery(async () => {
    const bill = await db.bills.get(billId)
    if (!bill || bill.deleted) return null
    const patient = await db.patients.get(bill.patientId)
    return patient ? { bill, patient } : null
  }, [billId])

  if (data === undefined) return null
  if (data === null) return <div className="p-6 text-sm">Bill not found.</div>
  const { bill, patient } = data
  const subtotal = bill.items.reduce((s, i) => s + i.amount, 0)

  return (
    <PrintShell title={`Bill ${bill.billNo}`} ready>
      <Letterhead />
      <section className="mt-4 grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-[10.5pt]">
        <div>
          <span className="text-slate-500">Patient: </span>
          <span className="font-semibold">{patient.name}</span>
          {ageSex(patient, bill.date) && <span> ({ageSex(patient, bill.date)})</span>}
        </div>
        <div className="text-right">
          <span className="text-slate-500">Bill No: </span>
          <span className="font-mono" data-testid="bill-no">
            {bill.billNo}
          </span>
        </div>
        <div>
          <span className="text-slate-500">OP No: </span>
          <span className="font-mono">{patient.opNo}</span>
        </div>
        <div className="text-right">
          <span className="text-slate-500">Date: </span>
          {formatDate(bill.date)}
        </div>
      </section>

      <table className="mt-5 w-full border-collapse text-[10.5pt]">
        <thead>
          <tr className="border-y-2 border-slate-800 text-left">
            <th className="w-10 py-1.5">#</th>
            <th className="py-1.5">Description</th>
            <th className="py-1.5 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {bill.items.map((i, n) => (
            <tr key={n} className="border-b border-slate-200">
              <td className="py-1.5">{n + 1}</td>
              <td className="py-1.5">
                {i.desc}
                {i.qty != null && <span className="text-slate-500"> × {i.qty}</span>}
              </td>
              <td className="py-1.5 text-right">{formatINR(i.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="text-right">
          {bill.discount > 0 && (
            <>
              <tr>
                <td colSpan={2} className="pt-2 text-slate-600">Subtotal</td>
                <td className="pt-2">{formatINR(subtotal)}</td>
              </tr>
              <tr>
                <td colSpan={2} className="text-slate-600">Discount</td>
                <td>−{formatINR(bill.discount)}</td>
              </tr>
            </>
          )}
          <tr className="font-bold">
            <td colSpan={2} className="pt-2">Total</td>
            <td className="pt-2" data-testid="bill-print-total">{formatINR(bill.total)}</td>
          </tr>
          <tr>
            <td colSpan={2}>Paid</td>
            <td>{formatINR(bill.paid)}</td>
          </tr>
          <tr className="font-semibold">
            <td colSpan={2}>Balance</td>
            <td data-testid="bill-print-balance">{formatINR(bill.balance)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="mt-3 text-[10pt] italic">{amountInWords(bill.total)}</p>
      {bill.balance > 0 && bill.dueDate && (
        <p className="mt-2 text-[10.5pt]">
          Balance due by <span className="font-semibold">{formatDate(bill.dueDate)}</span>
        </p>
      )}
      <div className="mt-12 text-right text-[10pt] text-slate-600">Authorised signatory</div>
    </PrintShell>
  )
}
