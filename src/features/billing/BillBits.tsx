import type { Bill, ClinicSettings, Patient, PaymentMode } from '../../db/types'
import { dueReminderLink } from '../../lib/whatsapp'
import { billStatus, isOverdue, PAYMENT_MODES } from './billingRepo'

const PILL: Record<string, string> = {
  paid: 'bg-brand-50 text-brand-700',
  partial: 'bg-sky-100 text-sky-800',
  unpaid: 'bg-slate-100 text-slate-700',
  overdue: 'bg-red-100 text-red-800',
}

export function BillStatusPill({ bill, today }: { bill: Bill; today: string }) {
  const status = billStatus(bill)
  const overdue = isOverdue(bill, today)
  return (
    <span className="inline-flex flex-wrap gap-1">
      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium capitalize ${PILL[status]}`}>{status}</span>
      {overdue && <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${PILL.overdue}`}>Overdue</span>}
    </span>
  )
}

// Opens WhatsApp in a new tab with the reminder drafted. Nothing is sent from
// the app; the user reviews and sends it in WhatsApp.
export function WhatsAppLink({
  patient,
  balance,
  dueDate,
  settings,
  className = '',
  label = 'WhatsApp',
  onOpen,
}: {
  patient: Patient
  balance: number
  dueDate?: string
  settings: ClinicSettings | undefined
  className?: string
  label?: string
  onOpen?: () => void
}) {
  const href = settings ? dueReminderLink(patient, balance, settings, dueDate) : null
  const cls = `btn-ghost whitespace-nowrap border border-emerald-600 px-3 py-1 text-emerald-700 ${className}`
  if (!href) {
    return (
      <button type="button" className={cls} disabled title="No valid mobile number">
        {label}
      </button>
    )
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cls}
      title="Opens WhatsApp with a reminder drafted. You send it from WhatsApp."
      aria-label={`WhatsApp reminder to ${patient.name}`}
      onClick={onOpen}
    >
      {label}
    </a>
  )
}

export function ModeSelect({ id, value, onChange }: { id: string; value: PaymentMode; onChange: (m: PaymentMode) => void }) {
  return (
    <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value as PaymentMode)}>
      {PAYMENT_MODES.map((m) => (
        <option key={m.value} value={m.value}>
          {m.label}
        </option>
      ))}
    </select>
  )
}
