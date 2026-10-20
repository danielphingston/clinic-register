import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { visitsForPatient } from '../visits/visitRepo'
import { AttachmentGrid } from './AttachmentGrid'
import { AttachmentUploader } from './AttachmentUploader'
import { attachmentsForPatient } from './attachmentRepo'

export function PatientAttachments({ patientId }: { patientId: string }) {
  const items = useLiveQuery(async () => attachmentsForPatient(patientId), [patientId])
  const visits = useLiveQuery(async () => visitsForPatient(patientId), [patientId])
  const [adding, setAdding] = useState(false)
  const visitDates = new Map((visits ?? []).map((v) => [v.id, v.date]))

  return (
    <section className="card space-y-3" aria-labelledby="att-heading" data-testid="patient-attachments">
      <div className="flex items-center justify-between gap-2">
        <h2 id="att-heading" className="font-semibold">
          Attachments{items?.length ? <span className="ml-1 font-normal text-slate-500">({items.length})</span> : null}
        </h2>
        <button type="button" className="btn-ghost border border-slate-300 px-3 py-1" aria-expanded={adding} onClick={() => setAdding((a) => !a)}>
          {adding ? 'Done' : '+ Add'}
        </button>
      </div>
      {adding && <AttachmentUploader patientId={patientId} />}
      {items && <AttachmentGrid items={items} visitDates={visitDates} filter className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-2" />}
    </section>
  )
}
