import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getSettings } from '../../db/repo'
import type { Patient } from '../../db/types'
import { formatDate, formatINR, todayISO } from '../../lib/format'
import { BillActions } from './BillActions'
import { BillStatusPill, WhatsAppLink } from './BillBits'
import { BillDialog } from './BillDialog'
import { billsForPatient, MODE_LABEL, patientDues, paymentsForPatient } from './billingRepo'
import { CollectDialog } from './CollectDialog'

export function PatientDues({ patient, newBillVisitId, onNewBillClosed }: { patient: Patient; newBillVisitId?: string; onNewBillClosed?: () => void }) {
  const today = todayISO()
  const settings = useLiveQuery(getSettings)
  const dues = useLiveQuery(async () => patientDues(patient.id), [patient.id])
  const bills = useLiveQuery(async () => billsForPatient(patient.id), [patient.id])
  const payments = useLiveQuery(async () => paymentsForPatient(patient.id), [patient.id])
  const [dialog, setDialog] = useState<'bill' | 'collect' | null>(null)
  const billNo = new Map(bills?.map((b) => [b.id, b.billNo]))

  return (
    <section className="card space-y-3" aria-labelledby="dues-heading" data-testid="patient-dues">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="dues-heading" className="font-semibold">
          Billing
        </h2>
        <span className="text-sm">
          Outstanding{' '}
          <span className={`font-semibold ${dues?.balance ? 'text-amber-700' : 'text-brand-700'}`} data-testid="patient-balance">
            {dues ? formatINR(dues.balance) : '…'}
          </span>
        </span>
      </div>
      {dues?.oldestDueDate && dues.balance > 0 && (
        <p className={`text-xs ${dues.oldestDueDate < today ? 'text-red-700' : 'text-slate-500'}`}>
          Oldest due {formatDate(dues.oldestDueDate)}
          {dues.oldestDueDate < today && ' (overdue)'}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-ghost whitespace-nowrap border border-slate-300 px-3 py-1" onClick={() => setDialog('bill')}>
          New bill
        </button>
        {!!dues?.balance && (
          <>
            <button type="button" className="btn-primary whitespace-nowrap px-3 py-1" onClick={() => setDialog('collect')}>
              Collect payment
            </button>
            <WhatsAppLink patient={patient} balance={dues.balance} dueDate={dues.oldestDueDate} settings={settings} />
          </>
        )}
      </div>

      <div>
        <h3 className="text-sm font-medium text-slate-700">Bills</h3>
        {bills && bills.length === 0 && <p className="text-sm text-slate-500">No bills yet.</p>}
        <ul className="divide-y divide-slate-100">
          {bills?.map((b) => (
            <li key={b.id} className="space-y-1.5 py-2 text-sm" data-testid="patient-bill">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="font-mono text-xs">{b.billNo}</span> · {formatDate(b.date)}
                </span>
                <BillStatusPill bill={b} today={today} />
              </div>
              <div className="text-slate-600">
                {formatINR(b.total)}
                {b.balance > 0 && <> · balance {formatINR(b.balance)} · due {formatDate(b.dueDate)}</>}
              </div>
              <BillActions bill={b} patient={patient} settings={settings} />
            </li>
          ))}
        </ul>
      </div>

      {payments && payments.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-slate-700">Payments</h3>
          <ul className="divide-y divide-slate-100">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 py-1.5 text-sm" data-testid="patient-payment">
                <span>
                  {formatDate(p.date)} · {formatINR(p.amount)} {MODE_LABEL[p.mode]}
                  <span className="block font-mono text-xs text-slate-500">
                    {p.receiptNo} → {billNo.get(p.billId)}
                  </span>
                </span>
                <Link to={`/print/receipt/${p.id}`} className="text-brand-700 hover:underline">
                  Receipt
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(dialog === 'bill' || newBillVisitId) && (
        <BillDialog
          patient={patient}
          visitId={newBillVisitId}
          onClose={() => {
            setDialog(null)
            onNewBillClosed?.()
          }}
        />
      )}
      {dialog === 'collect' && <CollectDialog patient={patient} onClose={() => setDialog(null)} />}
    </section>
  )
}
