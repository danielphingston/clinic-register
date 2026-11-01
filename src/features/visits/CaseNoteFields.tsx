import { useEffect, useRef } from 'react'
import type { ComplaintDetail, ComplaintStatusValue, GeneralsChecklist } from '../../db/types'
import { hasTerm, LEVELS, MODALITY_QUICK_PICKS, SLEEP_OPTIONS, STATUS_OPTIONS, STOOL_OPTIONS, toggleTerm, URINE_OPTIONS } from './caseNotes'
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

const TERM_FIELDS: { key: TermField; label: string; placeholder: string }[] = [
  { key: 'location', label: 'Location', placeholder: 'e.g. Head, right temple, extending to eye' },
  { key: 'sensation', label: 'Sensation', placeholder: 'e.g. Throbbing, bursting' },
  { key: 'duration', label: 'Duration', placeholder: 'e.g. 3 months, after a fall' },
]

// Modality input with quick chips that add or remove a term in the text.
function Modality({ n, field, title, sign, value, onChange }: { n: number; field: string; title: string; sign: string; value?: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="label" htmlFor={`c${n}-${field}`}>
        {title} ({sign})
      </label>
      <input id={`c${n}-${field}`} className="input" aria-label={`${title} ${n}`} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
      <div role="group" aria-label={`${title} ${n} quick picks`} className="mt-1.5 flex flex-wrap gap-1">
        {MODALITY_QUICK_PICKS.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={hasTerm(value, t)}
            onClick={() => onChange(toggleTerm(value, t))}
            className={`rounded-full border px-2 py-0.5 text-xs ${hasTerm(value, t) ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 text-slate-700 hover:bg-slate-100'}`}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  )
}

// One card per complaint: location, sensation, duration, modalities, concomitants.
export function ComplaintCards({ cards, known, onChange }: { cards: ComplaintDetail[]; known?: Record<TermField, string[]>; onChange: (cards: ComplaintDetail[]) => void }) {
  const focus = useRef<number | null>(null)
  useEffect(() => {
    if (focus.current === null) return
    document.querySelector<HTMLInputElement>(`[aria-label="Location ${focus.current + 1}"]`)?.focus()
    focus.current = null
  }, [cards.length])
  const set = (i: number, changes: ComplaintDetail) => onChange(cards.map((c, j) => (j === i ? { ...c, ...changes } : c)))
  return (
    <div className="space-y-3">
      {TERM_FIELDS.map((f) => (
        <datalist key={f.key} id={`known-${f.key}`}>
          {(known?.[f.key] ?? []).map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      ))}
      {cards.map((c, i) => (
        <div key={i} role="group" aria-label={`Complaint ${i + 1}`} className="rounded-md border border-slate-200 p-3">
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
            {TERM_FIELDS.map((f) => (
              <div key={f.key} className={f.key === 'location' ? 'sm:col-span-2' : ''}>
                <label className="label" htmlFor={`c${i + 1}-${f.key}`}>
                  {f.label}
                </label>
                <input
                  id={`c${i + 1}-${f.key}`}
                  className="input"
                  aria-label={`${f.label} ${i + 1}`}
                  placeholder={f.placeholder}
                  list={`known-${f.key}`}
                  value={c[f.key] ?? ''}
                  onChange={(e) => set(i, { [f.key]: e.target.value })}
                />
              </div>
            ))}
            <Modality n={i + 1} field="worse" title="Worse" sign="<" value={c.worse} onChange={(worse) => set(i, { worse })} />
            <Modality n={i + 1} field="better" title="Better" sign=">" value={c.better} onChange={(better) => set(i, { better })} />
            <div>
              <label className="label" htmlFor={`c${i + 1}-concomitants`}>
                Concomitants
              </label>
              <input
                id={`c${i + 1}-concomitants`}
                className="input"
                aria-label={`Concomitants ${i + 1}`}
                placeholder="e.g. Nausea, photophobia"
                list="known-concomitants"
                value={c.concomitants ?? ''}
                onChange={(e) => set(i, { concomitants: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor={`c${i + 1}-note`}>
                Other notes
              </label>
              <input id={`c${i + 1}-note`} className="input" aria-label={`Other notes ${i + 1}`} value={c.note ?? ''} onChange={(e) => set(i, { note: e.target.value })} />
            </div>
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
