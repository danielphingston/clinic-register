import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal } from '../../app/Modal'
import { getSettings } from '../../db/repo'
import type { Certificate, CertificateKind, Patient } from '../../db/types'
import { formatDate, todayISO } from '../../lib/format'
import { visitsForPatient } from '../visits/visitRepo'
import {
  createCertificate,
  fillTemplate,
  KIND_LABEL,
  medicinesFromVisit,
  updateCertificate,
} from './certificateRepo'

const KINDS = Object.keys(KIND_LABEL) as CertificateKind[]

// New or edit. Saving a new certificate opens its print page.
export function CertificateDialog({ patient, cert, onClose }: { patient: Patient; cert?: Certificate; onClose: () => void }) {
  const navigate = useNavigate()
  const editing = !!cert
  const settings = useLiveQuery(getSettings)
  const visits = useLiveQuery(async () => visitsForPatient(patient.id), [patient.id])

  const [kind, setKind] = useState<CertificateKind>(cert?.kind ?? 'medicine')
  const [date, setDate] = useState(cert?.date ?? todayISO())
  const [place, setPlace] = useState<string | undefined>(cert?.place)
  // undefined = the type's default title from Settings.
  const [title, setTitle] = useState<string | undefined>(cert?.title)
  const [condition, setCondition] = useState(cert?.condition ?? '')
  const [restFrom, setRestFrom] = useState(cert?.restFrom ?? todayISO())
  const [restTo, setRestTo] = useState(cert?.restTo ?? '')
  // undefined = not chosen yet: the latest visit once visits load.
  const [visitId, setVisitId] = useState<string | undefined>(cert ? (cert.visitId ?? '') : undefined)
  const [medicines, setMedicines] = useState<string | undefined>(cert?.medicines?.join('\n'))
  // The wording follows the template until it is edited by hand.
  const [body, setBody] = useState<string | undefined>(cert?.body)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const chosenVisit = visitId ?? visits?.[0]?.id ?? ''
  const rxLines = useLiveQuery(async () => (chosenVisit ? medicinesFromVisit(chosenVisit) : []), [chosenVisit])

  if (!settings || !visits) return null
  const s = settings

  const titleValue = title ?? s.certTypes[kind].title
  const autoBody = fillTemplate(s.certTypes[kind].template, patient, s, { date, condition, restFrom, restTo: restTo || undefined })
  const bodyValue = body ?? autoBody
  const medicinesValue = medicines ?? (rxLines ?? []).join('\n')
  const placeValue = place ?? s.certPlace

  function changeKind(k: CertificateKind) {
    if (title === s.certTypes[kind].title) setTitle(undefined)
    setKind(k)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const input = {
      kind,
      patientId: patient.id,
      visitId: chosenVisit || undefined,
      date,
      place: placeValue,
      title: titleValue,
      body: bodyValue,
      condition,
      restFrom,
      restTo,
      medicines: medicinesValue.split('\n'),
    }
    try {
      if (cert) {
        await updateCertificate(cert.id, input)
        onClose()
      } else {
        const saved = await createCertificate(input)
        navigate(`/print/certificate/${saved.id}`)
      }
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal title={editing ? `Edit ${cert.certNo}` : 'New certificate'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4" aria-label="Certificate">
        {!editing && (
          <fieldset>
            <legend className="label">Type</legend>
            <div className="flex flex-wrap gap-4">
              {KINDS.map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="cert-kind" checked={kind === k} onChange={() => changeKind(k)} />
                  {KIND_LABEL[k]}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="cert-date">
              Date of issue
            </label>
            <input id="cert-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="cert-place">
              Place
            </label>
            <input id="cert-place" className="input" value={placeValue} onChange={(e) => setPlace(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="cert-condition">
              {kind === 'medical' ? 'Diagnosis' : 'Under treatment for'}
            </label>
            <input id="cert-condition" className="input" value={condition} onChange={(e) => setCondition(e.target.value)} />
          </div>
          {kind === 'medical' && (
            <>
              <div>
                <label className="label" htmlFor="cert-from">
                  Rest from
                </label>
                <input id="cert-from" type="date" className="input" value={restFrom} onChange={(e) => setRestFrom(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="cert-to">
                  Rest to
                </label>
                <input id="cert-to" type="date" className="input" value={restTo} min={restFrom} onChange={(e) => setRestTo(e.target.value)} />
              </div>
            </>
          )}
        </div>

        {kind === 'medicine' && (
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="cert-visit">
                Medicines from visit
              </label>
              <select
                id="cert-visit"
                className="input"
                value={chosenVisit}
                onChange={(e) => {
                  setVisitId(e.target.value)
                  setMedicines(undefined)
                }}
              >
                <option value="">None</option>
                {visits.map((v) => (
                  <option key={v.id} value={v.id}>
                    {formatDate(v.date)}
                    {v.caseNotes.complaint ? ` · ${v.caseNotes.complaint.slice(0, 40)}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="cert-medicines">
                Medicines (one per line)
              </label>
              <textarea
                id="cert-medicines"
                className="input font-mono text-sm"
                rows={4}
                value={medicinesValue}
                onChange={(e) => setMedicines(e.target.value)}
              />
            </div>
          </div>
        )}

        <div>
          <label className="label" htmlFor="cert-title">
            Title
          </label>
          <input id="cert-title" className="input" value={titleValue} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <label className="label" htmlFor="cert-body">
              Wording
            </label>
            {body !== undefined && (
              <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => setBody(undefined)}>
                Reset to template
              </button>
            )}
          </div>
          <textarea id="cert-body" className="input" rows={6} value={bodyValue} onChange={(e) => setBody(e.target.value)} />
          <p className="mt-1 text-xs text-slate-500">
            {body === undefined
              ? 'Filled from the template in Settings and updated as you change the fields above. Edit freely.'
              : 'Edited by hand; changes to the fields above no longer update it.'}
          </p>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button type="submit" className="btn-primary" disabled={saving}>
            {editing ? 'Save changes' : 'Save & print'}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  )
}
