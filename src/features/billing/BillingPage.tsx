import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { getSettings } from '../../db/repo'
import { formatDate, formatINR, todayISO } from '../../lib/format'
import { useDebounced } from '../../lib/useDebounced'
import { BillActions } from './BillActions'
import { BillStatusPill } from './BillBits'
import { BillDialog } from './BillDialog'
import {
  AGEING_LABEL,
  billsList,
  collectionsForDay,
  duesAgeing,
  MODE_LABEL,
  outstandingTotal,
  overdueBills,
  type AgeingKey,
  type BillFilterStatus,
} from './billingRepo'
import { DuesView } from './DuesView'

const STATUS_CHIPS: { value: BillFilterStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'partial', label: 'Partial' },
  { value: 'paid', label: 'Paid' },
  { value: 'overdue', label: 'Overdue' },
]

// Single hue, light to dark as dues age; "not yet due" stays neutral.
const AGEING_COLOR: Record<AgeingKey, string> = {
  notDue: 'bg-slate-300',
  d0_30: 'bg-amber-300',
  d31_60: 'bg-amber-500',
  d61_90: 'bg-orange-600',
  d90plus: 'bg-red-800',
}

function Tile({ label, value, sub, testId }: { label: string; value: string; sub?: string; testId: string }) {
  return (
    <div className="card" data-testid={testId}>
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  )
}

function Summary({ today }: { today: string }) {
  const coll = useLiveQuery(async () => collectionsForDay(today), [today])
  const outstanding = useLiveQuery(outstandingTotal)
  const overdue = useLiveQuery(async () => overdueBills(today), [today])
  const ageing = useLiveQuery(async () => duesAgeing(today), [today])

  const modes = coll
    ? (Object.keys(coll.byMode) as (keyof typeof coll.byMode)[])
        .filter((m) => coll.byMode[m] > 0)
        .map((m) => `${MODE_LABEL[m]} ${formatINR(coll.byMode[m])}`)
        .join(' · ')
    : ''
  const overdueAmt = overdue?.reduce((s, b) => s + b.balance, 0) ?? 0
  const ageTotal = ageing ? Object.values(ageing).reduce((s, b) => s + b.amount, 0) : 0

  return (
    <>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Tile testId="tile-collection" label="Today's collection" value={coll ? formatINR(coll.total) : '—'} sub={modes || 'No payments yet today'} />
        <Tile testId="tile-outstanding" label="Total outstanding" value={outstanding == null ? '—' : formatINR(outstanding)} />
        <Tile
          testId="tile-overdue"
          label="Overdue"
          value={overdue ? formatINR(Math.round(overdueAmt * 100) / 100) : '—'}
          sub={overdue ? `${overdue.length} bill${overdue.length === 1 ? '' : 's'}` : undefined}
        />
      </div>

      {ageing && ageTotal > 0 && (
        <section className="card mt-4" aria-labelledby="ageing-heading">
          <h2 id="ageing-heading" className="font-semibold">
            Dues ageing
          </h2>
          <p className="text-xs text-slate-500">Days past the due date, by outstanding amount.</p>
          <div className="mt-3 flex h-4 gap-0.5 overflow-hidden rounded" aria-hidden="true">
            {(Object.keys(AGEING_LABEL) as AgeingKey[])
              .filter((k) => ageing[k].amount > 0)
              .map((k) => (
                <div
                  key={k}
                  className={`${AGEING_COLOR[k]} first:rounded-l last:rounded-r`}
                  style={{ width: `${(ageing[k].amount / ageTotal) * 100}%` }}
                  title={`${AGEING_LABEL[k]}: ${formatINR(ageing[k].amount)}`}
                />
              ))}
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm" data-testid="ageing-table">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-500">
                  <th className="py-1 font-medium">Bucket</th>
                  <th className="py-1 text-right font-medium">Bills</th>
                  <th className="py-1 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(Object.keys(AGEING_LABEL) as AgeingKey[]).map((k) => (
                  <tr key={k}>
                    <td className="py-1">
                      <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-sm ${AGEING_COLOR[k]}`} />
                      {AGEING_LABEL[k]}
                    </td>
                    <td className="py-1 text-right">{ageing[k].count}</td>
                    <td className="py-1 text-right">{formatINR(ageing[k].amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  )
}

function BillsList({ today }: { today: string }) {
  const settings = useLiveQuery(getSettings)
  const [status, setStatus] = useState<BillFilterStatus>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [query, setQuery] = useState('')
  const search = useDebounced(query, 200)
  const bills = useLiveQuery(async () => billsList({ status, from, to, search, today }), [status, from, to, search, today])

  return (
    <section className="mt-4 space-y-3" aria-label="Bills">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Status filter">
        {STATUS_CHIPS.map((c) => (
          <button
            key={c.value}
            type="button"
            aria-pressed={status === c.value}
            onClick={() => setStatus(c.value)}
            className={`rounded-full border px-3 py-1 text-sm ${
              status === c.value ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 text-slate-700 hover:bg-slate-100'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_10rem_10rem]">
        <input
          type="search"
          className="input"
          aria-label="Search bills"
          placeholder="Name, phone, OP no or bill no"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <input type="date" className="input" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className="input" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>

      {bills && bills.length === 0 && (
        <div className="card space-y-2 text-sm text-slate-500" data-testid="bills-empty">
          {status === 'all' && !from && !to && !search ? (
            <p>No bills yet. Use “New bill”, or “Save &amp; bill” at the end of a visit.</p>
          ) : (
            <>
              <p>No bills match these filters.</p>
              <button
                type="button"
                className="btn-ghost border border-slate-300 px-3 py-1"
                onClick={() => {
                  setStatus('all')
                  setFrom('')
                  setTo('')
                  setQuery('')
                }}
              >
                Clear filters
              </button>
            </>
          )}
        </div>
      )}

      {bills && bills.length > 0 && (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white md:block">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Bill</th>
                  <th className="px-3 py-2 font-medium">Patient</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-3 py-2 text-right font-medium">Balance</th>
                  <th className="px-3 py-2 font-medium">Due</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {bills.map((b) => (
                  <tr key={b.id} data-testid="bill-row-item" className="align-top">
                    <td className="px-3 py-2">
                      <div className="whitespace-nowrap font-mono text-xs">{b.billNo}</div>
                      <div className="text-xs text-slate-500">{formatDate(b.date)}</div>
                    </td>
                    <td className="px-3 py-2">
                      <Link to={`/patients/${b.patient.id}`} className="whitespace-nowrap font-medium text-brand-700 hover:underline">
                        {b.patient.name}
                      </Link>
                      <div className="text-xs text-slate-500">{b.patient.phone ?? b.patient.opNo}</div>
                    </td>
                    <td className="px-3 py-2 text-right">{formatINR(b.total)}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatINR(b.balance)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">{b.balance > 0 ? formatDate(b.dueDate) : '—'}</td>
                    <td className="px-3 py-2">
                      <BillStatusPill bill={b} today={today} />
                    </td>
                    <td className="px-3 py-2">
                      <BillActions bill={b} patient={b.patient} settings={settings} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-3 md:hidden">
            {bills.map((b) => (
              <li key={b.id} className="card space-y-2 text-sm" data-testid="bill-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link to={`/patients/${b.patient.id}`} className="font-medium text-brand-700">
                      {b.patient.name}
                    </Link>
                    <div className="font-mono text-xs text-slate-500">
                      {b.billNo} · {formatDate(b.date)}
                    </div>
                  </div>
                  <BillStatusPill bill={b} today={today} />
                </div>
                <div className="flex flex-wrap gap-x-4 text-slate-700">
                  <span>Total {formatINR(b.total)}</span>
                  <span className="font-semibold">Balance {formatINR(b.balance)}</span>
                  {b.balance > 0 && <span className="text-slate-500">Due {formatDate(b.dueDate)}</span>}
                </div>
                <BillActions bill={b} patient={b.patient} settings={settings} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

export function BillingPage({ view }: { view: 'bills' | 'dues' }) {
  const today = todayISO()
  const [creating, setCreating] = useState(false)
  const tab = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Billing</h1>
        <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
          New bill
        </button>
      </div>
      <Summary today={today} />
      <nav className="mt-6 flex gap-2 border-b border-slate-200 pb-2" aria-label="Billing views">
        <NavLink to="/billing" end className={tab}>
          Bills
        </NavLink>
        <NavLink to="/billing/dues" className={tab}>
          Dues
        </NavLink>
      </nav>
      {view === 'bills' ? <BillsList today={today} /> : <DuesView today={today} />}
      {creating && <BillDialog onClose={() => setCreating(false)} />}
    </div>
  )
}
