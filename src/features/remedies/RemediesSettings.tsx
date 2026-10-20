import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState, type FormEvent } from 'react'
import type { Remedy } from '../../db/types'
import { useDebounced } from '../../lib/useDebounced'
import { activeStockCountForRemedy } from '../stock/stockRepo'
import { addCustomRemedy, deleteRemedy, editRemedy, listRemedies, searchRemedies } from './remedyRepo'

const PAGE = 50

function RemedyRow({ remedy }: { remedy: Remedy }) {
  const [mode, setMode] = useState<'view' | 'edit' | 'confirm'>('view')
  const [name, setName] = useState(remedy.name)
  const [abbrev, setAbbrev] = useState(remedy.abbrev ?? '')
  const [error, setError] = useState('')
  const stockCount = useLiveQuery(async () => (mode === 'confirm' ? activeStockCountForRemedy(remedy.id) : 0), [mode, remedy.id])

  async function save(e: FormEvent) {
    e.preventDefault()
    try {
      await editRemedy(remedy.id, name, abbrev)
      setMode('view')
      setError('')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  if (mode === 'edit') {
    return (
      <li className="py-2">
        <form onSubmit={save} className="flex flex-wrap items-center gap-2">
          <input className="input flex-1 basis-48" aria-label="Remedy name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input w-28" aria-label="Abbreviation" value={abbrev} onChange={(e) => setAbbrev(e.target.value)} />
          <button type="submit" className="btn-primary">
            Update
          </button>
          <button type="button" className="btn-ghost" onClick={() => setMode('view')}>
            Cancel
          </button>
        </form>
        {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      </li>
    )
  }

  return (
    <li className="flex flex-wrap items-center gap-2 py-2">
      <span className="flex-1">
        {remedy.name}
        {remedy.abbrev && <span className="ml-2 text-xs text-slate-500">{remedy.abbrev}</span>}
        {remedy.isCustom === 1 && (
          <span className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 text-xs text-brand-700">custom</span>
        )}
      </span>
      {mode === 'confirm' ? (
        <span className="flex flex-wrap items-center gap-2 text-sm">
          {!!stockCount && (
            <span className="basis-full text-amber-800" role="status">
              {stockCount} stock item{stockCount === 1 ? '' : 's'} use{stockCount === 1 ? 's' : ''} this remedy and will keep showing its name.
            </span>
          )}
          Delete {remedy.name}?
          <button className="btn bg-red-600 px-3 py-1 text-white hover:bg-red-700" onClick={() => deleteRemedy(remedy.id)}>
            Confirm delete
          </button>
          <button className="btn-ghost px-3 py-1" onClick={() => setMode('view')}>
            Cancel
          </button>
        </span>
      ) : (
        <span className="flex gap-1">
          <button className="btn-ghost px-3 py-1" aria-label={`Edit ${remedy.name}`} onClick={() => setMode('edit')}>
            Edit
          </button>
          <button
            className="btn-ghost px-3 py-1 text-red-700"
            aria-label={`Delete ${remedy.name}`}
            onClick={() => setMode('confirm')}
          >
            Delete
          </button>
        </span>
      )}
    </li>
  )
}

export function RemediesSettings() {
  const remedies = useLiveQuery(listRemedies, [], [] as Remedy[])
  const [query, setQuery] = useState('')
  const q = useDebounced(query, 150)
  const [name, setName] = useState('')
  const [abbrev, setAbbrev] = useState('')
  const [error, setError] = useState('')

  const shown = useMemo(() => (q.trim() ? searchRemedies(remedies, q, PAGE) : remedies.slice(0, PAGE)), [remedies, q])

  async function add(e: FormEvent) {
    e.preventDefault()
    try {
      await addCustomRemedy(name, abbrev)
      setQuery(name.trim())
      setName('')
      setAbbrev('')
      setError('')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <section className="card mt-4 space-y-3" aria-labelledby="remedies-heading">
      <h2 id="remedies-heading" className="font-semibold">
        Remedies
      </h2>
      <p className="text-sm text-slate-500">{remedies.length} remedies in the master list.</p>

      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <div className="flex-1 basis-48">
          <label className="label" htmlFor="new-remedy-name">
            New remedy name
          </label>
          <input id="new-remedy-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="w-32">
          <label className="label" htmlFor="new-remedy-abbrev">
            Abbreviation
          </label>
          <input id="new-remedy-abbrev" className="input" value={abbrev} onChange={(e) => setAbbrev(e.target.value)} />
        </div>
        <button type="submit" className="btn-primary" disabled={!name.trim()}>
          Add remedy
        </button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <input
        className="input"
        type="search"
        aria-label="Search remedies"
        placeholder="Search remedies by name or abbreviation"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul className="divide-y divide-slate-100 text-sm">
        {shown.map((r) => (
          <RemedyRow key={r.id + r.updatedAt} remedy={r} />
        ))}
      </ul>
      {!q.trim() && remedies.length > PAGE && (
        <p className="text-xs text-slate-500">Showing the first {PAGE}. Search to find others.</p>
      )}
      {q.trim() && shown.length === 0 && <p className="text-sm text-slate-500">No remedies match.</p>}
    </section>
  )
}
