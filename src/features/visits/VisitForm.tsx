import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom'
import { Modal } from '../../app/Modal'
import { db } from '../../db/db'
import type { CaseNotes, ComplaintStatusValue, GeneralsChecklist, Visit } from '../../db/types'
import { ageSex } from '../../lib/age'
import { addDays, formatDate, todayISO } from '../../lib/format'
import { RemedyAutocomplete } from '../remedies/RemedyAutocomplete'
import { remedyMap } from '../remedies/remedyRepo'
import { POTENCY_PRESETS, REPETITION_PRESETS, rxDetails } from './rxFormat'
import { blankRow, repeatRows, rowsFromItems, rowsToInput, type RxRow } from './rxRows'
import { cleanChecklist, cleanStatuses, complaintLines, normaliseComplaints, previousComplaints } from './caseNotes'
import { ComplaintLines, ComplaintStatusRows, GeneralsChecklistFields } from './CaseNoteFields'
import { itemsForVisit, previousVisit, saveVisit } from './visitRepo'
import { completeAppointmentForVisit } from '../appointments/appointmentRepo'
import { DispenseField } from '../stock/DispenseField'
import { VisitAttachments } from '../attachments/VisitAttachments'

// The free-text tabs; complaints and the generals checklist are structured fields beside them.
type NoteKey = 'complaint' | 'history' | 'mentals' | 'generals' | 'modalities' | 'constitution'
type TextNotes = Pick<CaseNotes, NoteKey>

const TABS: { key: NoteKey; label: string }[] = [
  { key: 'complaint', label: 'Complaint' },
  { key: 'history', label: 'History' },
  { key: 'mentals', label: 'Mentals' },
  { key: 'generals', label: 'Generals' },
  { key: 'modalities', label: 'Modalities' },
  { key: 'constitution', label: 'Constitution' },
]

// Keyed by route params so switching records never carries over form state.
export function VisitForm() {
  const p = useParams()
  return <VisitFormInner key={`${p.id}/${p.visitId ?? 'new'}`} />
}

function VisitFormInner() {
  const { id: patientId = '', visitId } = useParams()
  const navigate = useNavigate()
  const patient = useLiveQuery(async () => db.patients.get(patientId), [patientId])
  const remedies = useLiveQuery(remedyMap)

  const [loaded, setLoaded] = useState<Visit | null | undefined>(visitId ? undefined : null)
  const [date, setDate] = useState(todayISO())
  const [notes, setNotes] = useState<TextNotes>({})
  const [complaints, setComplaints] = useState<string[]>([''])
  const [checklist, setChecklist] = useState<GeneralsChecklist>({})
  // Progress of the previous visit's complaints, keyed by lowercased complaint.
  const [statuses, setStatuses] = useState<Record<string, ComplaintStatusValue | undefined>>({})
  const [tab, setTab] = useState<NoteKey>('complaint')
  const [advice, setAdvice] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [rows, setRows] = useState<RxRow[]>(() => [blankRow()])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  // Stock already deducted by this visit's saved rows, per stock item.
  const [savedDispense, setSavedDispense] = useState<Map<string, number>>(() => new Map())

  useEffect(() => {
    if (!visitId) return
    let cancelled = false
    ;(async () => {
      const v = await db.visits.get(visitId)
      if (cancelled) return
      if (!v || v.deleted || v.patientId !== patientId) {
        setLoaded(null)
        navigate(`/patients/${patientId}`, { replace: true })
        return
      }
      const items = await itemsForVisit(v.id)
      if (cancelled) return
      setDate(v.date)
      const { history, mentals, generals, modalities, constitution } = v.caseNotes ?? {}
      setNotes({ history, mentals, generals, modalities, constitution })
      const lines = complaintLines(v.caseNotes)
      setComplaints(lines.length ? lines : [''])
      setChecklist(v.caseNotes?.generalsChecklist ?? {})
      setStatuses(Object.fromEntries((v.caseNotes?.complaintStatus ?? []).map((s) => [s.complaint.toLowerCase(), s.status])))
      setAdvice(v.advice ?? '')
      setFollowUp(v.followUpDate ?? '')
      setRows(items.length ? rowsFromItems(items, true) : [blankRow()])
      const saved = new Map<string, number>()
      for (const i of items) if (i.stockItemId && i.qtyDispensed) saved.set(i.stockItemId, (saved.get(i.stockItemId) ?? 0) + i.qtyDispensed)
      setSavedDispense(saved)
      setLoaded(v)
    })()
    return () => {
      cancelled = true
    }
  }, [visitId, patientId, navigate])

  const prev = useLiveQuery(async () => {
    if (loaded === undefined) return undefined
    const v = await previousVisit(patientId, loaded ?? undefined)
    return v ? { visit: v, items: await itemsForVisit(v.id) } : null
  }, [patientId, loaded])

  // Unsaved-changes guard: losing a half-written case history is the worst
  // failure here. Compare the form with what it was when it opened.
  // Complaints from the earlier visit to ask about, plus any statuses already
  // saved on this visit (the earlier visit may have been edited since).
  const asked = (() => {
    const list = prev ? previousComplaints(prev.visit.caseNotes) : []
    const known = new Set(list.map((c) => c.toLowerCase()))
    for (const s of loaded?.caseNotes.complaintStatus ?? []) if (!known.has(s.complaint.toLowerCase())) list.push(s.complaint)
    return list
  })()
  const lines = normaliseComplaints(complaints)
  const caseNotes: CaseNotes = {
    ...Object.fromEntries(Object.entries(notes).filter(([, v]) => v?.trim())),
    ...(lines.length && { complaint: lines.join('\n'), complaints: lines }),
    generalsChecklist: cleanChecklist(checklist),
    complaintStatus: cleanStatuses(asked, statuses),
  }
  if (!caseNotes.generalsChecklist) delete caseNotes.generalsChecklist
  if (!caseNotes.complaintStatus?.length) delete caseNotes.complaintStatus
  const snapshot = JSON.stringify({
    date,
    notes: caseNotes,
    advice: advice.trim(),
    followUp,
    rows: rows.map((r) => ({ ...r, key: undefined })),
  })
  const [baseline, setBaseline] = useState<string | null>(null)
  useEffect(() => {
    if (loaded !== undefined && baseline === null) setBaseline(snapshot)
  }, [loaded, baseline, snapshot])
  const leaving = useRef(false)
  // Keyboard flow: "+ Add remedy" moves focus into the new row.
  const focusRemedy = useRef(0)
  useEffect(() => {
    if (!focusRemedy.current) return
    document.querySelector<HTMLInputElement>(`[aria-label="Remedy ${focusRemedy.current}"]`)?.focus()
    focusRemedy.current = 0
  }, [rows.length])
  const dirty = baseline !== null && snapshot !== baseline
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname)
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  if (loaded === undefined || patient === undefined) return null
  if (!patient || patient.deleted) {
    return <div className="card text-sm">Patient not found.</div>
  }

  function setRow(key: string, changes: Partial<RxRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...changes } : r)))
    setError('')
  }

  async function handleSubmit(e: FormEvent, then: 'profile' | 'print' | 'bill' = 'profile') {
    e.preventDefault()
    const { items, error } = rowsToInput(rows)
    if (!date) return setError('Enter the visit date')
    if (error) return setError(error)
    setSaving(true)
    try {
      const id = await saveVisit({
        id: loaded?.id,
        patientId,
        date,
        caseNotes,
        advice,
        followUpDate: followUp,
        items,
      })
      if (!loaded) await completeAppointmentForVisit(patientId, date)
      // Replace so Back from the printout returns to the profile, not a stale form.
      const next = { profile: `/patients/${patientId}`, print: `/print/rx/${id}`, bill: `/patients/${patientId}?bill=${id}` }[then]
      leaving.current = true
      navigate(next, { replace: true })
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-5xl space-y-4" noValidate>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{loaded ? 'Visit' : 'New visit'}</h1>
          <p className="text-sm text-slate-600">
            <Link to={`/patients/${patient.id}`} className="font-medium text-brand-700 hover:underline">
              {patient.name}
            </Link>{' '}
            · <span className="font-mono">{patient.opNo}</span> · {ageSex(patient, todayISO())}
          </p>
        </div>
        <div className="w-44">
          <label className="label" htmlFor="v-date">
            Visit date
          </label>
          <input id="v-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      <section className="card">
        <div role="tablist" aria-label="Case notes" className="-mx-1 flex gap-1 overflow-x-auto pb-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`tab-${t.key}`}
              aria-selected={tab === t.key}
              aria-controls="case-panel"
              onClick={() => setTab(t.key)}
              className={`shrink-0 rounded-md px-3 py-1.5 text-sm font-medium ${
                tab === t.key ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {t.label}
              {(t.key === 'complaint' ? lines.length > 0 : notes[t.key]?.trim()) && tab !== t.key && <span className="ml-1 text-brand-600">•</span>}
            </button>
          ))}
        </div>
        <div role="tabpanel" id="case-panel" aria-labelledby={`tab-${tab}`}>
          {tab === 'complaint' ? (
            <ComplaintLines lines={complaints} onChange={setComplaints} />
          ) : (
            <>
              {tab === 'generals' && <GeneralsChecklistFields value={checklist} onChange={setChecklist} />}
              <textarea
                key={tab}
                className="input"
                rows={5}
                aria-label={tab === 'generals' ? 'Other generals' : TABS.find((t) => t.key === tab)!.label}
                value={notes[tab] ?? ''}
                onChange={(e) => setNotes((n) => ({ ...n, [tab]: e.target.value }))}
              />
            </>
          )}
        </div>
      </section>

      {asked.length > 0 && (
        <section className="card space-y-2 text-sm" aria-labelledby="prevc-heading">
          <h2 id="prevc-heading" className="font-semibold">
            Previous complaints
          </h2>
          <ComplaintStatusRows
            complaints={asked}
            statuses={statuses}
            onChange={(c, status) => setStatuses((s) => ({ ...s, [c.toLowerCase()]: status }))}
          />
        </section>
      )}

      <div className="grid gap-4 2xl:grid-cols-3">
        <section className="card space-y-2 text-sm 2xl:order-2" aria-labelledby="prev-heading">
          <h2 id="prev-heading" className="font-semibold">
            Previous prescription
          </h2>
          {prev === null && <p className="text-slate-500">No earlier visit.</p>}
          {prev && (
            <>
              <p className="text-slate-600">
                {formatDate(prev.visit.date)}
                {prev.visit.caseNotes.complaint && ` · ${prev.visit.caseNotes.complaint}`}
              </p>
              {prev.items.length === 0 ? (
                <p className="text-slate-500">No remedies prescribed.</p>
              ) : (
                <>
                  <ul className="space-y-0.5" data-testid="prev-rx">
                    {prev.items.map((i) => (
                      <li key={i.id}>
                        <span className="font-medium">{remedies?.get(i.remedyId)?.name}</span>{' '}
                        <span className="font-semibold text-brand-700">{i.potency}</span>
                        {rxDetails(i) && <span className="text-slate-500"> · {rxDetails(i)}</span>}
                      </li>
                    ))}
                  </ul>
                  <button type="button" className="btn-ghost w-full border border-brand-500 text-brand-700" onClick={() => setRows((rs) => repeatRows(rs, prev.items))}>
                    Repeat last prescription
                  </button>
                </>
              )}
            </>
          )}
        </section>
        <section className="card space-y-3 2xl:order-1 2xl:col-span-2" aria-labelledby="rx-heading">
          <h2 id="rx-heading" className="font-semibold">
            Prescription
          </h2>
          <div className="hidden grid-cols-[2fr_0.9fr_0.9fr_0.9fr_0.7fr_2rem] gap-2 text-xs font-medium uppercase text-slate-500 sm:grid">
            <span>Remedy</span>
            <span>Potency</span>
            <span>Dose</span>
            <span>Repetition</span>
            <span>Days</span>
            <span />
          </div>
          <ol className="space-y-3 sm:space-y-2">
            {rows.map((r, i) => (
              <li
                key={r.key}
                data-testid="rx-row"
                className="grid grid-cols-2 gap-2 rounded-md border border-slate-200 p-2 sm:grid-cols-[2fr_0.9fr_0.9fr_0.9fr_0.7fr_2rem] sm:border-0 sm:p-0"
              >
                {/* On phones the row's remove button sits up here, small and
                    out of the way, so a thumb scrolling past can't hit it. */}
                <span className="order-first self-center text-xs font-medium text-slate-500 sm:hidden" aria-hidden="true">
                  Remedy {i + 1}
                </span>
                <RemedyAutocomplete
                  className="col-span-2 sm:col-span-1"
                  label={`Remedy ${i + 1}`}
                  value={r.remedyId}
                  onChange={(remedyId) => setRow(r.key, { remedyId })}
                />
                <input
                  className="input"
                  aria-label={`Potency ${i + 1}`}
                  placeholder="Potency"
                  list="potency-presets"
                  value={r.potency}
                  onChange={(e) => setRow(r.key, { potency: e.target.value })}
                />
                <input
                  className="input"
                  aria-label={`Dose ${i + 1}`}
                  placeholder="Dose"
                  value={r.dose}
                  onChange={(e) => setRow(r.key, { dose: e.target.value })}
                />
                <input
                  className="input"
                  aria-label={`Repetition ${i + 1}`}
                  placeholder="Repetition"
                  list="repetition-presets"
                  value={r.repetition}
                  onChange={(e) => setRow(r.key, { repetition: e.target.value })}
                />
                <input
                  className="input"
                  aria-label={`Days ${i + 1}`}
                  placeholder="Days"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={r.duration}
                  onChange={(e) => setRow(r.key, { duration: e.target.value })}
                />
                <button
                  type="button"
                  className="btn-ghost order-first gap-1 justify-self-end px-2 py-0.5 text-xs text-red-700 sm:order-none sm:justify-self-auto sm:py-2 sm:text-sm"
                  aria-label={`Remove row ${i + 1}`}
                  title="Remove"
                  onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [blankRow()]))}
                >
                  ✕<span className="sm:hidden">Remove</span>
                </button>
                {r.remedyId && r.potency.trim() && (
                  <div className="col-span-full">
                    <DispenseField
                      index={i + 1}
                      remedyId={r.remedyId}
                      potency={r.potency}
                      stockItemId={r.stockItemId}
                      qty={r.qty}
                      saved={savedDispense}
                      otherRowsQty={rows.reduce((sum, o) => (o.key !== r.key && o.stockItemId && o.stockItemId === r.stockItemId ? sum + (Number(o.qty) || 0) : sum), 0)}
                      onChange={(changes) => setRow(r.key, changes)}
                    />
                  </div>
                )}
              </li>
            ))}
          </ol>
          <datalist id="potency-presets">
            {POTENCY_PRESETS.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <datalist id="repetition-presets">
            {REPETITION_PRESETS.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <button
            type="button"
            className="btn-ghost border border-slate-300"
            onClick={() => {
              focusRemedy.current = rows.length + 1
              setRows((rs) => [...rs, blankRow()])
            }}
          >
            + Add remedy
          </button>
        </section>

      </div>

      <section className="card grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="v-advice">
            Advice
          </label>
          <textarea id="v-advice" rows={3} className="input" value={advice} onChange={(e) => setAdvice(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="v-followup">
            Follow-up date
          </label>
          <input
            id="v-followup"
            type="date"
            className="input"
            min={date}
            value={followUp}
            onChange={(e) => setFollowUp(e.target.value)}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {[7, 15, 30].map((d) => (
              <button
                key={d}
                type="button"
                className="btn-ghost border border-slate-300 px-3 py-1"
                onClick={() => setFollowUp(addDays(date || todayISO(), d))}
              >
                +{d}d
              </button>
            ))}
            {followUp && (
              <button type="button" className="btn-ghost px-3 py-1 text-slate-500" onClick={() => setFollowUp('')}>
                Clear
              </button>
            )}
          </div>
        </div>
      </section>

      <VisitAttachments patientId={patientId} visitId={loaded?.id} />

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button type="submit" className="btn-primary" disabled={saving}>
          Save visit
        </button>
        <button type="button" className="btn-ghost border border-brand-500 text-brand-700" disabled={saving} onClick={(e) => handleSubmit(e, 'print')}>
          Save &amp; print Rx
        </button>
        <button type="button" className="btn-ghost border border-brand-500 text-brand-700" disabled={saving} onClick={(e) => handleSubmit(e, 'bill')}>
          Save &amp; bill
        </button>
        <Link to={`/patients/${patient.id}`} className="btn-ghost border border-slate-300">
          Cancel
        </Link>
      </div>
      {blocker.state === 'blocked' && (
        <Modal title="Leave without saving?" onClose={() => blocker.reset()}>
          <p className="text-sm text-slate-600">This visit has changes that are not saved yet. If you leave now, they will be lost.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="btn-primary" data-autofocus onClick={() => blocker.reset()}>
              Keep editing
            </button>
            <button type="button" className="btn-ghost border border-red-300 text-red-700" onClick={() => blocker.proceed()}>
              Discard changes
            </button>
          </div>
        </Modal>
      )}
    </form>
  )
}
