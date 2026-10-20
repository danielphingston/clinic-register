import { useLiveQuery } from 'dexie-react-hooks'
import { AttachmentGrid } from './AttachmentGrid'
import { AttachmentUploader } from './AttachmentUploader'
import { attachmentsForVisit } from './attachmentRepo'

// New visits have no id yet, so attaching waits until the first save
// (simpler and safer than queueing files across the save + navigation).
export function VisitAttachments({ patientId, visitId }: { patientId: string; visitId?: string }) {
  const items = useLiveQuery(async () => (visitId ? attachmentsForVisit(visitId) : []), [visitId])
  return (
    <section className="card space-y-3" aria-labelledby="visit-att-heading" data-testid="visit-attachments">
      <h2 id="visit-att-heading" className="font-semibold">
        Attachments
      </h2>
      {visitId ? (
        <>
          <AttachmentUploader patientId={patientId} visitId={visitId} />
          {items && <AttachmentGrid items={items} empty="No files attached to this visit." className="grid-cols-2 sm:grid-cols-4 lg:grid-cols-6" />}
        </>
      ) : (
        <p className="text-sm text-slate-500">
          Save the visit first, then open it again from the patient's profile to attach lab reports or photos.
        </p>
      )}
    </section>
  )
}
