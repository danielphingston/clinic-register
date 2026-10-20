import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { db } from '../../db/db'
import { getSettings } from '../../db/repo'
import { ageSex } from '../../lib/age'
import { formatDate, formatINR, todayISO } from '../../lib/format'
import { followUpsDue, recentPatients } from '../visits/visitRepo'
import { appointmentsForDay } from '../appointments/appointmentRepo'
import { TodayQueue } from '../appointments/TodayQueue'
import { collectionsForDay, duesByPatient, outstandingTotal } from '../billing/billingRepo'
import { lowStockItems } from '../stock/stockRepo'
import { formatQty } from '../stock/stockLogic'
import { addDays } from '../../lib/format'
import { dailyTrend } from '../reports/reportQueries'
import { TrendChart } from './TrendChart'

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  )
}

export function Dashboard() {
  const settings = useLiveQuery(getSettings)
  const patientCount = useLiveQuery(async () => db.patients.where('deleted').equals(0).count(), [], 0)
  const today = todayISO()
  const recent = useLiveQuery(async () => recentPatients(5), [])
  const due = useLiveQuery(async () => followUpsDue(today), [today])
  const { hash } = useLocation()
  // Reminders link to /#followups.
  useEffect(() => {
    if (hash && due) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' })
  }, [hash, due])
  const apptCount = useLiveQuery(
    async () => (await appointmentsForDay(today)).filter((a) => a.status !== 'cancelled').length,
    [today],
  )
  const collection = useLiveQuery(async () => collectionsForDay(today), [today])
  const outstanding = useLiveQuery(outstandingTotal)
  const overdue = useLiveQuery(async () => (await duesByPatient(today)).filter((r) => r.daysOverdue > 0), [today])
  const lowStock = useLiveQuery(lowStockItems)
  const trend = useLiveQuery(async () => dailyTrend({ from: addDays(today, -29), to: today }), [today])
  const monthVisits = useLiveQuery(
    async () => (await dailyTrend({ from: `${today.slice(0, 8)}01`, to: today })).reduce((s, d) => s + d.visits, 0),
    [today],
  )
  const seenToday = trend?.[trend.length - 1]?.visits

  return (
    <div>
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      {settings && !settings.clinicName && (
        <div className="mt-4 rounded-lg border border-brand-100 bg-brand-50 p-4 text-sm">
          Welcome! Start by adding your clinic details in{' '}
          <Link to="/settings" className="font-medium text-brand-700 underline">
            Settings
          </Link>
          . They appear on prescriptions and receipts.
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Visits today" value={seenToday ?? '—'} />
        <Stat label="Visits this month" value={monthVisits ?? '—'} />
        <Stat label="Total patients" value={patientCount} />
        <Stat label="Today's appointments" value={apptCount ?? '—'} />
        <Stat label="Today's collection" value={collection ? formatINR(collection.total) : '—'} />
        <Stat label="Outstanding dues" value={outstanding == null ? '—' : formatINR(outstanding)} />
      </div>

      <div className="mt-4">
        <TodayQueue />
      </div>

      {trend && (
        <div className="mt-4">
          <TrendChart data={trend} />
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section id="followups" className="card" aria-labelledby="followups-heading">
          <h2 id="followups-heading" className="font-semibold">
            Follow-ups due
          </h2>
          {due && due.length === 0 && <p className="mt-2 text-sm text-slate-500">No follow-ups due today.</p>}
          <ul className="mt-2 divide-y divide-slate-100">
            {due?.map((f) => (
              <li key={f.patient.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <Link to={`/patients/${f.patient.id}`} className="min-w-0 truncate font-medium text-brand-700 hover:underline">
                  {f.patient.name}
                </Link>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                    f.overdue ? 'bg-amber-100 text-amber-800' : 'bg-brand-50 text-brand-700'
                  }`}
                >
                  {f.overdue ? `Overdue · ${formatDate(f.followUpDate)}` : 'Today'}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card" aria-labelledby="overdue-heading" data-testid="overdue-card">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="overdue-heading" className="font-semibold">
              Overdue dues
            </h2>
            <Link to="/billing/dues" className="text-sm text-brand-700 hover:underline">
              {overdue && overdue.length > 5 ? `All ${overdue.length} →` : 'Billing →'}
            </Link>
          </div>
          {overdue && overdue.length === 0 && <p className="mt-2 text-sm text-slate-500">No overdue dues.</p>}
          <ul className="mt-2 divide-y divide-slate-100">
            {overdue?.slice(0, 5).map((r) => (
              <li key={r.patient.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <Link to={`/patients/${r.patient.id}`} className="min-w-0 truncate font-medium text-brand-700 hover:underline">
                  {r.patient.name}
                </Link>
                <span className="shrink-0 text-right">
                  <span className="font-semibold">{formatINR(r.balance)}</span>
                  <span className="ml-2 text-xs text-red-700">{r.daysOverdue}d overdue</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {lowStock && lowStock.length > 0 && (
          <section className="card" aria-labelledby="lowstock-heading" data-testid="low-stock-card">
            <div className="flex items-baseline justify-between gap-2">
              <h2 id="lowstock-heading" className="font-semibold">
                Low stock <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">{lowStock.length}</span>
              </h2>
              <Link to="/stock?filter=low" className="text-sm text-brand-700 hover:underline">
                {lowStock.length > 5 ? `All ${lowStock.length} →` : 'Stock →'}
              </Link>
            </div>
            <ul className="mt-2 divide-y divide-slate-100">
              {lowStock.slice(0, 5).map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <Link to={`/stock/${s.id}`} className="min-w-0 truncate font-medium text-brand-700 hover:underline">
                    {s.remedyName} <span className="font-semibold">{s.potency}</span>
                  </Link>
                  <span className={`shrink-0 font-medium ${s.qty <= 0 ? 'text-red-700' : 'text-amber-700'}`}>
                    {formatQty(s.qty)} {s.unit}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="card" aria-labelledby="recent-heading">
          <h2 id="recent-heading" className="font-semibold">
            Recent patients
          </h2>
          {recent && recent.length === 0 && (
            <p className="mt-2 text-sm text-slate-500">
              No visits recorded yet.{' '}
              <Link to="/patients/new" className="font-medium text-brand-700 underline">
                Add a patient
              </Link>{' '}
              to start.
            </p>
          )}
          <ul className="mt-2 divide-y divide-slate-100">
            {recent?.map(({ patient, lastVisit }) => (
              <li key={patient.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <Link to={`/patients/${patient.id}`} className="min-w-0 truncate font-medium text-brand-700 hover:underline">
                  {patient.name}
                  <span className="ml-2 font-normal text-slate-500">{ageSex(patient, today)}</span>
                </Link>
                <span className="shrink-0 text-xs text-slate-500">{formatDate(lastVisit.date)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
