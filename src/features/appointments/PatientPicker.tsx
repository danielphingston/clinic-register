import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type KeyboardEvent } from 'react'
import type { Patient } from '../../db/types'
import { useDebounced } from '../../lib/useDebounced'
import { createPatient, normalizeIndianMobile, searchPatients } from '../patients/patientRepo'

// Search existing patients or quick-add a new one (name + phone).
export function PatientPicker({ value, onChange }: { value: Patient | null; onChange: (p: Patient | null) => void }) {
  const [query, setQuery] = useState('')
  const q = useDebounced(query, 150)
  const results = useLiveQuery(async () => (q.trim() ? searchPatients(q, 8) : Promise.resolve([])), [q])
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
        <span className="min-w-0 truncate">
          <span className="font-medium" data-testid="picked-patient">
            {value.name}
          </span>{' '}
          <span className="font-mono text-xs text-slate-500">{value.opNo}</span>
        </span>
        <button type="button" className="btn-ghost px-2 py-1 text-brand-700" onClick={() => onChange(null)}>
          Change
        </button>
      </div>
    )
  }

  function enterAdds(e: KeyboardEvent) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    add()
  }

  async function add() {
    if (!name.trim()) return setError('Name is required')
    let ph: string | undefined
    if (phone.trim()) {
      const n = normalizeIndianMobile(phone)
      if (!n) return setError('Enter a 10-digit Indian mobile number')
      ph = n
    }
    try {
      onChange(await createPatient({ name, phone: ph }))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  if (adding) {
    return (
      // Not a <form>: this sits inside the booking form.
      <div className="space-y-2 rounded-md border border-slate-200 p-3" role="group" aria-label="New patient">
        <div>
          <label className="label" htmlFor="qa-name">
            New patient name
          </label>
          <input id="qa-name" className="input" value={name} autoFocus onKeyDown={enterAdds} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="qa-phone">
            Phone
          </label>
          <input id="qa-phone" className="input" inputMode="tel" value={phone} onKeyDown={enterAdds} onChange={(e) => setPhone(e.target.value)} />
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button type="button" className="btn-primary" onClick={add}>
            Add patient
          </button>
          <button type="button" className="btn-ghost" onClick={() => setAdding(false)}>
            Back to search
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <label className="label" htmlFor="pp-search">
        Patient
      </label>
      <input
        id="pp-search"
        type="search"
        className="input"
        placeholder="Name, phone or OP no"
        value={query}
        data-autofocus
        onChange={(e) => setQuery(e.target.value)}
      />
      {q.trim() && results && (
        <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200" aria-label="Matching patients">
          {results.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No match.</li>}
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                onClick={() => onChange(p)}
              >
                <span className="truncate font-medium">{p.name}</span>
                <span className="shrink-0 text-xs text-slate-500">{p.phone ?? p.opNo}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="btn-ghost border border-dashed border-slate-300 px-3 py-1"
        onClick={() => {
          setAdding(true)
          setName(/\d/.test(query) ? '' : query.trim())
          setPhone(/\d/.test(query) ? query.trim() : '')
          setError('')
        }}
      >
        + New patient
      </button>
    </div>
  )
}
