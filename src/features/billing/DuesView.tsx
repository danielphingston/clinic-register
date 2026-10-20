import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Modal } from '../../app/Modal'
import { getSettings } from '../../db/repo'
import type { ClinicSettings, Patient } from '../../db/types'
import { formatDate, formatINR } from '../../lib/format'
import { WhatsAppLink } from './BillBits'
import { duesByPatient, type PatientDueRow } from './billingRepo'
import { CollectDialog } from './CollectDialog'

function overdueText(days: number) {
  if (days > 0) return `${days} day${days === 1 ? '' : 's'} overdue`
  if (days === 0) return 'Due today'
  return `Due in ${-days} day${days === -1 ? '' : 's'}`
}

// Browsers block a burst of window.open calls, so reminders go one at a time:
// the user opens WhatsApp for the current patient, then moves on.
function RemindAll({ rows, settings, onClose }: { rows: PatientDueRow[]; settings: ClinicSettings | undefined; onClose: () => void }) {
  const [i, setI] = useState(0)
  const [opened, setOpened] = useState(0)
  const row = rows[i]

  return (
    <Modal title="Remind overdue patients" onClose={onClose}>
      {row ? (
        <div className="space-y-3 text-sm" data-testid="remind-step">
          <p className="text-slate-500">
            Patient {i + 1} of {rows.length}
          </p>
          <div className="rounded-md border border-slate-200 p-3">
            <div className="font-medium" data-testid="remind-name">
              {row.patient.name}
            </div>
            <div className="text-slate-600">{row.patient.phone ?? 'No phone'}</div>
            <div className="mt-1">
              <span className="font-semibold">{formatINR(row.balance)}</span> · {overdueText(row.daysOverdue)}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <WhatsAppLink
              patient={row.patient}
              balance={row.balance}
              dueDate={row.oldestDueDate}
              settings={settings}
              className="py-2"
              label="Open WhatsApp"
              onOpen={() => setOpened((n) => n + 1)}
            />
            <button type="button" className="btn-primary" onClick={() => setI(i + 1)}>
              Next
            </button>
            <button type="button" className="btn-ghost border border-slate-300" onClick={() => setI(i + 1)}>
              Skip
            </button>
          </div>
          <p className="text-xs text-slate-500">Open WhatsApp, press Send there, then come back and press Next.</p>
        </div>
      ) : (
        <div className="space-y-3 text-sm" data-testid="remind-done">
          <p>
            Reached the end of the list. WhatsApp was opened for {opened} of {rows.length} patients.
          </p>
          <button type="button" className="btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      )}
    </Modal>
  )
}

export function DuesView({ today }: { today: string }) {
  const settings = useLiveQuery(getSettings)
  const rows = useLiveQuery(async () => duesByPatient(today), [today])
  const [collecting, setCollecting] = useState<Patient | null>(null)
  const [reminding, setReminding] = useState<PatientDueRow[] | null>(null)
  const overdue = rows?.filter((r) => r.daysOverdue > 0) ?? []

  return (
    <section className="mt-4 space-y-3" aria-label="Dues">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">Patients with a balance, oldest due first.</p>
        <button
          type="button"
          className="btn-ghost border border-emerald-600 text-emerald-700"
          disabled={overdue.length === 0}
          onClick={() => setReminding(overdue)}
        >
          Remind all overdue ({overdue.length})
        </button>
      </div>
      {rows && rows.length === 0 && <div className="card text-sm text-slate-500">No outstanding dues. Every bill is fully paid.</div>}
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {rows?.map((r) => (
          <li key={r.patient.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm" data-testid="due-row">
            <div className="min-w-0">
              <Link to={`/patients/${r.patient.id}`} className="font-medium text-brand-700 hover:underline">
                {r.patient.name}
              </Link>
              <div className="text-xs text-slate-500">{r.patient.phone ?? 'No phone'}</div>
            </div>
            <div className="text-right">
              <div className="font-semibold">{formatINR(r.balance)}</div>
              <div className={`text-xs ${r.daysOverdue > 0 ? 'text-red-700' : 'text-slate-500'}`}>
                {formatDate(r.oldestDueDate)} · {overdueText(r.daysOverdue)}
              </div>
            </div>
            <div className="flex w-full gap-2 sm:w-auto">
              <button type="button" className="btn-primary px-3 py-1" onClick={() => setCollecting(r.patient)}>
                Collect
              </button>
              <WhatsAppLink patient={r.patient} balance={r.balance} dueDate={r.oldestDueDate} settings={settings} />
            </div>
          </li>
        ))}
      </ul>
      {collecting && <CollectDialog patient={collecting} onClose={() => setCollecting(null)} />}
      {reminding && <RemindAll rows={reminding} settings={settings} onClose={() => setReminding(null)} />}
    </section>
  )
}
