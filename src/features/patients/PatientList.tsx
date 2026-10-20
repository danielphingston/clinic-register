import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ageSex } from '../../lib/age'
import { todayISO } from '../../lib/format'
import { useDebounced } from '../../lib/useDebounced'
import { searchPatients } from './patientRepo'

export function PatientList() {
  const [query, setQuery] = useState('')
  const q = useDebounced(query, 200)
  const patients = useLiveQuery(async () => searchPatients(q), [q])
  const navigate = useNavigate()
  const today = todayISO()

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Patients</h1>
        <Link to="/patients/new" className="btn-primary">
          + New patient
        </Link>
      </div>

      <input
        className="input mt-4"
        type="search"
        aria-label="Search patients"
        placeholder="Search by name, phone or OP no"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />

      {patients && patients.length === 0 && (
        <div className="card mt-4 text-sm text-slate-600">
          {q.trim() ? 'No patients match your search.' : 'No patients yet. Add the first one with “New patient”.'}
        </div>
      )}

      {patients && patients.length > 0 && (
        <>
          {/* Table on wider screens, cards on phones. */}
          <div className="card mt-4 hidden overflow-x-auto p-0 sm:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2">OP no</th>
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Age / Sex</th>
                  <th className="px-4 py-2">Phone</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {patients.map((p) => (
                  <tr
                    key={p.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => navigate(`/patients/${p.id}`)}
                  >
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">{p.opNo}</td>
                    <td className="px-4 py-2">
                      <Link to={`/patients/${p.id}`} className="font-medium text-brand-700 hover:underline">
                        {p.name}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">{ageSex(p, today)}</td>
                    <td className="whitespace-nowrap px-4 py-2">{p.phone}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="mt-4 space-y-2 sm:hidden">
            {patients.map((p) => (
              <li key={p.id}>
                <Link to={`/patients/${p.id}`} className="card block hover:border-brand-500">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-brand-700">{p.name}</span>
                    <span className="font-mono text-xs text-slate-500">{p.opNo}</span>
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    {[ageSex(p, today), p.phone].filter(Boolean).join(' · ')}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
