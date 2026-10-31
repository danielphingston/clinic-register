import { useEffect, useRef } from 'react'
import type { ComplaintStatusValue, GeneralsChecklist } from '../../db/types'
import { LEVELS, SLEEP_OPTIONS, STATUS_OPTIONS, STOOL_OPTIONS, URINE_OPTIONS } from './caseNotes'

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

// One single-line input per complaint. Enter adds a line below and focuses it.
export function ComplaintLines({ lines, onChange }: { lines: string[]; onChange: (lines: string[]) => void }) {
  const focus = useRef<number | null>(null)
  useEffect(() => {
    if (focus.current === null) return
    document.querySelector<HTMLInputElement>(`[aria-label="Complaint ${focus.current + 1}"]`)?.focus()
    focus.current = null
  }, [lines.length])
  function insertAfter(i: number) {
    focus.current = i + 1
    onChange([...lines.slice(0, i + 1), '', ...lines.slice(i + 1)])
  }
  return (
    <div className="space-y-2">
      {lines.map((line, i) => (
        <div key={i} className="flex gap-2">
          <input
            className="input"
            aria-label={`Complaint ${i + 1}`}
            value={line}
            onChange={(e) => onChange(lines.map((l, j) => (j === i ? e.target.value : l)))}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              insertAfter(i)
            }}
          />
          <button
            type="button"
            className="btn-ghost px-2 text-red-700"
            aria-label={`Remove complaint ${i + 1}`}
            title="Remove"
            onClick={() => onChange(lines.length > 1 ? lines.filter((_, j) => j !== i) : [''])}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className="btn-ghost border border-slate-300 px-3 py-1" aria-label="Add complaint" title="Add complaint" onClick={() => insertAfter(lines.length - 1)}>
        +
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
