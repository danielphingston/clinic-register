import { useState } from 'react'
import type { Bill, ClinicSettings, Patient } from '../../db/types'
import { BillDialog } from './BillDialog'
import { BillView } from './BillView'
import { CollectDialog } from './CollectDialog'
import { WhatsAppLink } from './BillBits'
import { voidBill } from './billingRepo'

type Open = 'collect' | 'view' | 'edit' | 'void' | null

// Row actions for one bill; owns its dialogs and the inline void confirm.
export function BillActions({ bill, patient, settings }: { bill: Bill; patient: Patient; settings: ClinicSettings | undefined }) {
  const [open, setOpen] = useState<Open>(null)
  const [error, setError] = useState('')
  const close = () => setOpen(null)
  const small = 'btn-ghost whitespace-nowrap border border-slate-300 px-2.5 py-1'

  async function doVoid() {
    try {
      await voidBill(bill.id)
    } catch (err) {
      setError((err as Error).message)
      setOpen(null)
    }
  }

  if (open === 'void') {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md bg-red-50 p-2 text-sm" role="group" aria-label={`Confirm void ${bill.billNo}`}>
        <span className="text-red-800">Void {bill.billNo}?</span>
        <button type="button" className="btn-primary bg-red-700 px-3 py-1 hover:bg-red-800" onClick={doVoid}>
          Yes, void
        </button>
        <button type="button" className="btn-ghost px-3 py-1" onClick={close}>
          Keep
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {bill.balance > 0 && (
          <button type="button" className="btn-primary whitespace-nowrap px-2.5 py-1" onClick={() => setOpen('collect')}>
            Collect
          </button>
        )}
        {bill.balance > 0 && <WhatsAppLink patient={patient} balance={bill.balance} dueDate={bill.dueDate} settings={settings} className="px-2.5" />}
        <button type="button" className={small} onClick={() => setOpen('view')}>
          View
        </button>
        <button type="button" className={small} onClick={() => setOpen('edit')}>
          Edit
        </button>
        <button
          type="button"
          className={`${small} text-red-700`}
          onClick={() => {
            setError(bill.paid > 0 ? 'Reverse the payments on this bill (View → Reverse) before voiding it' : '')
            if (bill.paid <= 0) setOpen('void')
          }}
        >
          Void
        </button>
      </div>
      {/* Hide a stale "reverse first" error once the payments are gone. */}
      {error && bill.paid > 0 && (
        <p role="alert" className="mt-1 text-xs text-red-700">
          {error}
        </p>
      )}
      {open === 'collect' && <CollectDialog patient={patient} bill={bill} onClose={close} />}
      {open === 'view' && <BillView billId={bill.id} onClose={close} />}
      {open === 'edit' && <BillDialog bill={bill} patient={patient} onClose={close} />}
    </div>
  )
}
