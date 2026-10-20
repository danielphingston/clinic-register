import { useLiveQuery } from 'dexie-react-hooks'
import { useParams } from 'react-router-dom'
import { db } from '../db/db'
import { amountInWords } from '../lib/amountInWords'
import { formatDate, formatINR } from '../lib/format'
import { MODE_LABEL } from '../features/billing/billingRepo'
import { Letterhead, PrintShell } from './PrintShell'

export function PrintReceipt() {
  const { paymentId = '' } = useParams()
  const data = useLiveQuery(async () => {
    const payment = await db.payments.get(paymentId)
    if (!payment || payment.deleted) return null
    const [bill, patient] = await Promise.all([db.bills.get(payment.billId), db.patients.get(payment.patientId)])
    return bill && patient ? { payment, bill, patient } : null
  }, [paymentId])

  if (data === undefined) return null
  if (data === null) return <div className="p-6 text-sm">Receipt not found.</div>
  const { payment, bill, patient } = data

  const rows: [string, string][] = [
    ['Received from', patient.name],
    ['OP No', patient.opNo],
    ['Against bill', `${bill.billNo} (${formatDate(bill.date)})`],
    ['Payment mode', MODE_LABEL[payment.mode]],
  ]

  return (
    <PrintShell title={`Receipt ${payment.receiptNo}`} ready>
      <Letterhead />
      <section className="mt-6 rounded-md border-2 border-slate-800 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[13pt] font-bold uppercase tracking-wide">Payment Receipt</div>
            <div className="font-mono text-[11pt]" data-testid="receipt-no">
              {payment.receiptNo}
            </div>
          </div>
          <div className="text-right">
            <span className="text-slate-500">Date: </span>
            {formatDate(payment.date)}
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-[8.5rem_1fr] gap-y-1.5">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-slate-500">{k}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-5 border-t border-slate-300 pt-4">
          <div className="text-[18pt] font-bold" data-testid="receipt-amount">
            {formatINR(payment.amount)}
          </div>
          <div className="mt-1 italic" data-testid="receipt-words">
            {amountInWords(payment.amount)}
          </div>
        </div>
        <div className="mt-4 text-[10pt]">
          <span className="text-slate-500">Balance remaining on this bill: </span>
          <span className="font-semibold" data-testid="receipt-balance">
            {formatINR(bill.balance)}
          </span>
          {bill.balance > 0 && bill.dueDate && <span className="text-slate-500"> (due {formatDate(bill.dueDate)})</span>}
        </div>
        <div className="mt-10 text-right text-[10pt] text-slate-600">Authorised signatory</div>
      </section>
    </PrintShell>
  )
}
