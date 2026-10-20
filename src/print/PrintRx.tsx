import { useLiveQuery } from 'dexie-react-hooks'
import { useParams } from 'react-router-dom'
import { db } from '../db/db'
import { getSettings } from '../db/repo'
import { ageSex } from '../lib/age'
import { formatDate } from '../lib/format'
import { remedyMap } from '../features/remedies/remedyRepo'
import { itemsForVisit } from '../features/visits/visitRepo'
import { Letterhead, PrintShell } from './PrintShell'

export function PrintRx() {
  const { visitId = '' } = useParams()
  const data = useLiveQuery(async () => {
    const visit = await db.visits.get(visitId)
    if (!visit || visit.deleted) return null
    const [patient, items, remedies, settings] = await Promise.all([
      db.patients.get(visit.patientId),
      itemsForVisit(visit.id),
      remedyMap(),
      getSettings(),
    ])
    return patient ? { visit, patient, items, remedies, settings } : null
  }, [visitId])

  if (data === undefined) return null
  if (data === null) return <div className="p-6 text-sm">Visit not found.</div>
  const { visit, patient, items, remedies, settings } = data

  return (
    <PrintShell title={`Rx ${patient.name} ${visit.date}`} ready>
      <Letterhead />

      <section className="mt-4 grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-[10.5pt]">
        <div>
          <span className="text-slate-500">Patient: </span>
          <span className="font-semibold">{patient.name}</span>
          {ageSex(patient, visit.date) && <span> ({ageSex(patient, visit.date)})</span>}
        </div>
        <div className="text-right">
          <span className="text-slate-500">Date: </span>
          {formatDate(visit.date)}
        </div>
        <div>
          <span className="text-slate-500">OP No: </span>
          <span className="font-mono">{patient.opNo}</span>
        </div>
        {patient.phone && (
          <div className="text-right">
            <span className="text-slate-500">Ph: </span>
            {patient.phone}
          </div>
        )}
      </section>

      {visit.caseNotes.complaint && (
        <p className="mt-3 text-[10pt]">
          <span className="text-slate-500">C/o: </span>
          {visit.caseNotes.complaint}
        </p>
      )}

      <div className="mt-5 text-[22pt] font-serif leading-none text-brand-800">℞</div>
      {items.length === 0 ? (
        <p className="mt-2 text-slate-500">No remedies prescribed.</p>
      ) : (
        <table className="mt-2 w-full border-collapse text-left text-[10.5pt]">
          <thead>
            <tr className="border-b border-slate-400 text-[9pt] uppercase tracking-wide text-slate-600">
              <th className="w-8 py-1.5">#</th>
              <th className="py-1.5">Remedy</th>
              <th className="py-1.5">Potency</th>
              <th className="py-1.5">Dose</th>
              <th className="py-1.5">Repetition</th>
              <th className="py-1.5 text-right">Duration</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i, n) => (
              <tr key={i.id} className="break-inside-avoid border-b border-slate-200">
                <td className="py-2 align-top">{n + 1}.</td>
                <td className="py-2 align-top font-semibold">{remedies.get(i.remedyId)?.name ?? ''}</td>
                <td className="py-2 align-top font-semibold">{i.potency}</td>
                <td className="py-2 align-top">{i.dose}</td>
                <td className="py-2 align-top">{i.repetition}</td>
                <td className="py-2 text-right align-top">{i.durationDays ? `${i.durationDays} days` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {visit.advice && (
        <section className="mt-6 break-inside-avoid">
          <h2 className="text-[9pt] font-semibold uppercase tracking-wide text-slate-600">Advice</h2>
          <p className="mt-1 whitespace-pre-line">{visit.advice}</p>
        </section>
      )}

      {visit.followUpDate && (
        <p className="mt-4 break-inside-avoid">
          <span className="font-semibold">Next visit: </span>
          {formatDate(visit.followUpDate)}
        </p>
      )}

      <footer className="mt-16 flex break-inside-avoid justify-end">
        <div className="w-56 border-t border-slate-500 pt-1 text-center text-[9.5pt]">
          <div className="font-semibold">{settings.doctorName || 'Signature'}</div>
          {settings.regNo && <div className="text-slate-600">Reg. No. {settings.regNo}</div>}
        </div>
      </footer>
    </PrintShell>
  )
}
