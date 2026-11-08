import { useEffect, useRef, useState } from 'react'
import type { ComplaintDetail, ComplaintStatusValue, GeneralsChecklist } from '../../db/types'
import { addTerm, AILMENTS_FROM_QUICK_PICKS, hasTerm, LEVELS, MODALITY_QUICK_PICKS, SLEEP_OPTIONS, STATUS_OPTIONS, STOOL_OPTIONS, toggleTerm, URINE_OPTIONS } from './caseNotes'
import type { TermField } from './visitRepo'

function Pill({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-sm ${pressed ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 text-slate-700 hover:bg-slate-100'}`}
    >
      {children}
    </button>
  )
}

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={title} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="w-20 shrink-0 text-sm font-medium text-slate-700">{title}</span>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  )
}

// Single choice: clicking the selected pill clears it.
function Single<T extends string>({ title, options, value, onChange }: { title: string; options: readonly { value: T; label: string }[]; value?: T; onChange: (v: T | undefined) => void }) {
  return (
    <Row title={title}>
      {options.map((o) => (
        <Pill key={o.value} pressed={value === o.value} onClick={() => onChange(value === o.value ? undefined : o.value)}>
          {o.label}
        </Pill>
      ))}
    </Row>
  )
}

export function GeneralsChecklistFields({ value, onChange }: { value: GeneralsChecklist; onChange: (v: GeneralsChecklist) => void }) {
  const set = (changes: Partial<GeneralsChecklist>) => onChange({ ...value, ...changes })
  const urine = value.urine ?? []
  function toggleUrine(o: (typeof URINE_OPTIONS)[number]['value']) {
    if (urine.includes(o)) return set({ urine: urine.filter((u) => u !== o) })
    // "Normal" excludes the abnormal options, and the other way round.
    set({ urine: o === 'normal' ? ['normal'] : [...urine.filter((u) => u !== 'normal'), o] })
  }
  return (
    <div className="mb-4 space-y-2" data-testid="generals-checklist">
      <Single title="Appetite" options={LEVELS} value={value.appetite} onChange={(appetite) => set({ appetite })} />
      <Single title="Thirst" options={LEVELS} value={value.thirst} onChange={(thirst) => set({ thirst })} />
      <Row title="Urine">
        {URINE_OPTIONS.map((o) => (
          <Pill key={o.value} pressed={urine.includes(o.value)} onClick={() => toggleUrine(o.value)}>
            {o.label}
          </Pill>
        ))}
      </Row>
      <Single title="Sleep" options={SLEEP_OPTIONS} value={value.sleep} onChange={(sleep) => set({ sleep })} />
      <Single title="Stool" options={STOOL_OPTIONS} value={value.stool} onChange={(stool) => set({ stool })} />
      {value.stool === 'constipation' && (
        <label className="ml-0 flex flex-wrap items-center gap-2 text-sm sm:ml-[5.75rem]">
          Passes stool every
          <input
            type="number"
            inputMode="numeric"
            min={1}
            className="input w-20"
            aria-label="Constipation days"
            value={value.constipationDays ?? ''}
            onChange={(e) => set({ constipationDays: e.target.value ? Number(e.target.value) : undefined })}
          />
          days
        </label>
      )}
      <Single title="Sweat" options={LEVELS} value={value.sweat} onChange={(sweat) => set({ sweat })} />
      {value.sweat === 'increased' && (
        <div className="ml-0 sm:ml-[5.75rem]">
          <input
            className="input max-w-sm"
            aria-label="Body part(s)"
            placeholder="Body part(s)"
            value={value.sweatParts ?? ''}
            onChange={(e) => set({ sweatParts: e.target.value })}
          />
        </div>
      )}
    </div>
  )
}

const TERM_FIELDS: TermField[] = ['complaint', 'duration', 'aggravation', 'amelioration', 'ailmentsFrom']

// Removable chips, an add box (Enter, "Add" or leaving the box) and quick chips that toggle an entry.
function TermList({
  n,
  field,
  title,
  sign,
  picks = MODALITY_QUICK_PICKS,
  className,
  value,
  onChange,
}: {
  n: number
  field: 'aggravation' | 'amelioration' | 'ailmentsFrom'
  title: string
  sign: string
  picks?: string[]
  className?: string
  value?: string[]
  onChange: (v: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const entries = value ?? []
  const commit = () => {
    if (draft.trim()) onChange(addTerm(entries, draft))
    setDraft('')
  }
  return (
    <div role="group" aria-label={`${title} ${n}`} className={className}>
      <label className="label" htmlFor={`c${n}-${field}`}>
        {title} ({sign})
      </label>
      {entries.length > 0 && (
        <ul className="mb-1.5 flex flex-wrap gap-1">
          {entries.map((t) => (
            <li key={t.toLowerCase()} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-2.5 pr-1 text-sm">
              {t}
              <button type="button" className="rounded-full px-1.5 text-slate-500 hover:text-red-700" aria-label={`Remove ${t} from ${title.toLowerCase()} ${n}`} onClick={() => onChange(toggleTerm(entries, t))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          id={`c${n}-${field}`}
          className="input"
          aria-label={`${title} ${n}`}
          placeholder="Type and press Enter"
          list={`known-${field}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            commit()
          }}
          onBlur={commit}
        />
        <button type="button" className="btn-ghost border border-slate-300 px-3 py-1" aria-label={`Add ${title.toLowerCase()} ${n}`} onClick={commit}>
          Add
        </button>
      </div>
      <div role="group" aria-label={`${title} ${n} quick picks`} className="mt-1.5 flex flex-wrap gap-1">
        {picks.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={hasTerm(entries, t)}
            onClick={() => onChange(toggleTerm(entries, t))}
            className={`rounded-full border px-2 py-0.5 text-xs ${hasTerm(entries, t) ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 text-slate-700 hover:bg-slate-100'}`}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  )
}

// One card per complaint: the complaint, its duration, what aggravates and ameliorates it, and what it started after.
export function ComplaintCards({ cards, known, onChange }: { cards: ComplaintDetail[]; known?: Record<TermField, string[]>; onChange: (cards: ComplaintDetail[]) => void }) {
  const focus = useRef<number | null>(null)
  useEffect(() => {
    if (focus.current === null) return
    document.querySelector<HTMLInputElement>(`[aria-label="Complaint ${focus.current + 1}"]`)?.focus()
    focus.current = null
  }, [cards.length])
  const set = (i: number, changes: ComplaintDetail) => onChange(cards.map((c, j) => (j === i ? { ...c, ...changes } : c)))
  return (
    <div className="space-y-3">
      {TERM_FIELDS.map((f) => (
        <datalist key={f} id={`known-${f}`}>
          {(known?.[f] ?? []).map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      ))}
      {cards.map((c, i) => (
        <div key={i} role="group" aria-label={`Complaint card ${i + 1}`} className="rounded-md border border-slate-200 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700">Complaint {i + 1}</span>
            <button
              type="button"
              className="btn-ghost px-2 py-0.5 text-red-700"
              aria-label={`Remove complaint ${i + 1}`}
              title="Remove"
              onClick={() => onChange(cards.length > 1 ? cards.filter((_, j) => j !== i) : [{}])}
            >
              ×
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label" htmlFor={`c${i + 1}-complaint`}>
                Complaint
              </label>
              <input
                id={`c${i + 1}-complaint`}
                className="input"
                aria-label={`Complaint ${i + 1}`}
                placeholder="e.g. Throbbing headache, right temple"
                list="known-complaint"
                value={c.complaint ?? ''}
                onChange={(e) => set(i, { complaint: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor={`c${i + 1}-duration`}>
                Duration
              </label>
              <input
                id={`c${i + 1}-duration`}
                className="input"
                aria-label={`Duration ${i + 1}`}
                placeholder="e.g. 3 months"
                list="known-duration"
                value={c.duration ?? ''}
                onChange={(e) => set(i, { duration: e.target.value })}
              />
            </div>
            <TermList n={i + 1} field="aggravation" title="Aggravation" sign="<" value={c.aggravation} onChange={(aggravation) => set(i, { aggravation })} />
            <TermList n={i + 1} field="amelioration" title="Amelioration" sign=">" value={c.amelioration} onChange={(amelioration) => set(i, { amelioration })} />
            <TermList
              n={i + 1}
              field="ailmentsFrom"
              title="Ailments from"
              sign="A/F"
              picks={AILMENTS_FROM_QUICK_PICKS}
              className="sm:col-span-2"
              value={c.ailmentsFrom}
              onChange={(ailmentsFrom) => set(i, { ailmentsFrom })}
            />
          </div>
        </div>
      ))}
      <button
        type="button"
        className="btn-ghost border border-slate-300 px-3 py-1"
        onClick={() => {
          focus.current = cards.length
          onChange([...cards, {}])
        }}
      >
        + Add complaint
      </button>
    </div>
  )
}

export function ComplaintStatusRows({
  complaints,
  statuses,
  onChange,
}: {
  complaints: string[]
  statuses: Record<string, ComplaintStatusValue | undefined>
  onChange: (complaint: string, status: ComplaintStatusValue | undefined) => void
}) {
  return (
    <ul className="space-y-2">
      {complaints.map((c) => {
        const current = statuses[c.toLowerCase()]
        return (
          <li key={c} role="group" aria-label={c} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="min-w-32 font-medium">{c}</span>
            <span className="flex flex-wrap gap-1.5">
              {STATUS_OPTIONS.map((o) => (
                <Pill key={o.value} pressed={current === o.value} onClick={() => onChange(c, current === o.value ? undefined : o.value)}>
                  {o.label}
                </Pill>
              ))}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
