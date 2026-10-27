import { useLiveQuery } from 'dexie-react-hooks'
import { useId, useState, type FormEvent } from 'react'
import type { Patient } from '../../db/types'
import { knownDiagnoses, normalizeDiagnoses, setDiagnoses } from './patientRepo'

export function PatientDiagnoses({ patient }: { patient: Patient }) {
  const list = patient.diagnoses ?? []
  const [text, setText] = useState('')
  const listId = useId()
  // Suggestions from other patients, minus what this patient already has.
  const known = useLiveQuery(knownDiagnoses, [], [] as string[])
  const have = new Set(list.map((d) => d.toLowerCase()))
  const suggestions = known.filter((d) => !have.has(d.toLowerCase()))

  async function add(e: FormEvent) {
    e.preventDefault()
    if (normalizeDiagnoses([text]).length === 0) return
    await setDiagnoses(patient.id, [...list, text])
    setText('')
  }

  return (
    <section className="card space-y-3" aria-labelledby="dx-heading" data-testid="patient-diagnoses">
      <h2 id="dx-heading" className="font-semibold">
        Diagnosis
      </h2>
      {list.length === 0 && <p className="text-sm text-slate-500">None recorded.</p>}
      <ul className="flex flex-wrap gap-2">
        {list.map((d) => (
          <li key={d} className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-0.5 pl-3 pr-1 text-sm text-brand-800">
            <span>{d}</span>
            <button
              type="button"
              aria-label={`Remove ${d}`}
              className="rounded-full px-2 text-brand-700 hover:bg-brand-100"
              onClick={() => setDiagnoses(patient.id, list.filter((x) => x !== d))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex gap-2">
        <input
          className="input"
          aria-label="Add diagnosis"
          placeholder="Add diagnosis…"
          autoComplete="off"
          list={listId}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <datalist id={listId}>
          {suggestions.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>
        <button type="submit" className="btn-ghost border border-slate-300 px-3 py-1">
          Add
        </button>
      </form>
    </section>
  )
}
