import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Certificate, Patient } from '../../db/types'
import { formatDate } from '../../lib/format'
import { CertificateDialog } from './CertificateDialog'
import { cancelCertificate, certificatesForPatient, KIND_LABEL } from './certificateRepo'

export function PatientCertificates({ patient }: { patient: Patient }) {
  const items = useLiveQuery(async () => certificatesForPatient(patient.id), [patient.id])
  const [dialog, setDialog] = useState<{ cert?: Certificate } | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)

  return (
    <section className="card space-y-3" aria-labelledby="cert-heading" data-testid="patient-certificates">
      <div className="flex items-center justify-between gap-2">
        <h2 id="cert-heading" className="font-semibold">
          Certificates
        </h2>
        <button type="button" className="btn-ghost border border-slate-300 px-3 py-1" onClick={() => setDialog({})}>
          + New
        </button>
      </div>
      {items?.length === 0 && <p className="text-sm text-slate-500">None issued.</p>}
      <ul className="divide-y divide-slate-100">
        {items?.map((c) => (
          <li key={c.id} className="py-2 text-sm" data-testid="certificate">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className={c.deleted ? 'text-slate-400 line-through' : 'font-medium'}>{KIND_LABEL[c.kind]}</span>
              <span className="text-slate-500">{formatDate(c.date)}</span>
            </div>
            <div className="font-mono text-xs text-slate-500">
              {c.certNo}
              {c.deleted ? ' · cancelled' : ''}
            </div>
            {!c.deleted &&
              (confirm === c.id ? (
                <div className="mt-1 flex flex-wrap items-center gap-2 rounded-md bg-red-50 p-2" role="group" aria-label={`Confirm cancel ${c.certNo}`}>
                  <span className="text-red-800">Cancel {c.certNo}? It stays in the register.</span>
                  <button
                    type="button"
                    className="btn-primary bg-red-700 px-3 py-1 hover:bg-red-800"
                    onClick={() => void cancelCertificate(c.id).then(() => setConfirm(null))}
                  >
                    Yes, cancel
                  </button>
                  <button type="button" className="btn-ghost px-3 py-1" onClick={() => setConfirm(null)}>
                    Keep
                  </button>
                </div>
              ) : (
                <div className="mt-1 flex gap-3">
                  <Link to={`/print/certificate/${c.id}`} className="text-brand-700 hover:underline" aria-label={`Print ${c.certNo}`}>
                    Print
                  </Link>
                  <button type="button" className="text-brand-700 hover:underline" aria-label={`Edit ${c.certNo}`} onClick={() => setDialog({ cert: c })}>
                    Edit
                  </button>
                  <button type="button" className="text-red-700 hover:underline" aria-label={`Cancel ${c.certNo}`} onClick={() => setConfirm(c.id)}>
                    Cancel
                  </button>
                </div>
              ))}
          </li>
        ))}
      </ul>
      {dialog && <CertificateDialog patient={patient} cert={dialog.cert} onClose={() => setDialog(null)} />}
    </section>
  )
}
