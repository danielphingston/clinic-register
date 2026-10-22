import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { db } from '../../db/db'
import type { PrescriptionItem } from '../../db/types'
import { ageSex } from '../../lib/age'
import { formatDate, todayISO } from '../../lib/format'
import { remedyMap } from '../remedies/remedyRepo'
import { rxDetails } from '../visits/rxFormat'
import { byRxOrder, visitsForPatient } from '../visits/visitRepo'
import { PatientAppointments } from '../appointments/PatientAppointments'
import { PatientDues } from '../billing/PatientDues'
import { PatientAttachments } from '../attachments/PatientAttachments'
import { PatientCertificates } from '../certificates/PatientCertificates'

export function PatientProfile() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  // "Save & bill" from a visit lands here with ?bill=<visitId>.
  const billVisit = params.get('bill') ?? undefined
  const patient = useLiveQuery(async () => (await db.patients.get(id)) ?? null, [id])
  // One query so a visit card never renders before its Rx lines and names.
  const history = useLiveQuery(async () => {
    const [visits, items, remedies] = await Promise.all([
      visitsForPatient(id),
      db.prescriptionItems.where('patientId').equals(id).filter((i) => i.deleted === 0).toArray(),
      remedyMap(),
    ])
    const byVisit = new Map<string, PrescriptionItem[]>()
    for (const i of items.sort(byRxOrder)) byVisit.set(i.visitId, [...(byVisit.get(i.visitId) ?? []), i])
    return { visits, byVisit, remedies }
  }, [id])
  const visits = history?.visits
  const remedies = history?.remedies

  if (patient === undefined) return null
  if (!patient || patient.deleted) {
    return (
      <div className="card text-sm">
        Patient not found.{' '}
        <Link to="/patients" className="text-brand-700 underline">
          Back to patients
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{patient.name}</h1>
            <p className="font-mono text-sm text-slate-500">{patient.opNo}</p>
            <p className="mt-1 text-sm text-slate-700">
              {[ageSex(patient, todayISO()), patient.phone, patient.dob && `DOB ${formatDate(patient.dob)}`]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {patient.address && <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{patient.address}</p>}
            {patient.notes && <p className="mt-1 whitespace-pre-line text-sm text-slate-500">{patient.notes}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to={`/patients/${patient.id}/visits/new`} className="btn-primary">
              New visit
            </Link>
            <Link to={`/patients/${patient.id}/edit`} className="btn-ghost border border-slate-300">
              Edit
            </Link>
            <Link to={`/print/op-slip/${patient.id}`} className="btn-ghost border border-slate-300">
              Print OP slip
            </Link>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="space-y-3 lg:col-span-2" aria-label="Visits">
          <h2 className="font-semibold">Visits</h2>
          {visits && visits.length === 0 && (
            <div className="card text-sm text-slate-500">
              No visits yet.{' '}
              <Link to={`/patients/${patient.id}/visits/new`} className="font-medium text-brand-700 underline">
                Record the first visit
              </Link>
            </div>
          )}
          <ol className="space-y-3">
            {visits?.map((v) => {
              const rx = history?.byVisit.get(v.id) ?? []
              return (
                <li key={v.id} className="card" data-testid="visit">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{formatDate(v.date)}</span>
                    <span className="flex gap-3 text-sm">
                      <Link to={`/patients/${patient.id}/visits/${v.id}`} className="text-brand-700 hover:underline">
                        Open
                      </Link>
                      <Link to={`/print/rx/${v.id}`} className="text-brand-700 hover:underline">
                        Print Rx
                      </Link>
                    </span>
                  </div>
                  {v.caseNotes.complaint && <p className="mt-1 whitespace-pre-line text-sm">{v.caseNotes.complaint}</p>}
                  {rx.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-sm">
                      {rx.map((i) => (
                        <li key={i.id}>
                          <span className="font-medium">{remedies?.get(i.remedyId)?.name ?? '…'}</span>{' '}
                          <span className="font-semibold text-brand-700">{i.potency}</span>
                          {rxDetails(i) && <span className="text-slate-500"> · {rxDetails(i)}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {v.followUpDate && (
                    <p className="mt-2 text-xs text-slate-500">Follow-up {formatDate(v.followUpDate)}</p>
                  )}
                </li>
              )
            })}
          </ol>
        </section>

        <aside aria-label="Appointments, billing, certificates and attachments" className="space-y-4">
          <PatientAppointments patient={patient} />
          <PatientDues patient={patient} newBillVisitId={billVisit} onNewBillClosed={() => setParams({}, { replace: true })} />
          <PatientCertificates patient={patient} />
          <PatientAttachments patientId={patient.id} />
        </aside>
      </div>
    </div>
  )
}
