import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { todayISO } from '../../lib/format'
import { appointmentsForDay, setStatus, type AppointmentWithPatient } from './appointmentRepo'
import { AppointmentDialog } from './AppointmentDialog'
import { BookingDialog } from './BookingDialog'
import { StatusBadge } from './StatusBadge'
import { formatTime } from './time'

export function TodayQueue() {
  const today = todayISO()
  const rows = useLiveQuery(async () => appointmentsForDay(today), [today])
  const navigate = useNavigate()
  const [walkIn, setWalkIn] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const queue = (rows ?? []).filter((a) => a.status !== 'cancelled')

  async function act(fn: () => Promise<unknown>) {
    setError('')
    try {
      await fn()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  function startVisit(a: AppointmentWithPatient) {
    act(async () => {
      if (a.status !== 'arrived') await setStatus(a.id, 'arrived')
      navigate(`/patients/${a.patientId}/visits/new`)
    })
  }

  return (
    <section className="card" aria-labelledby="queue-heading">
      <div className="flex items-center justify-between gap-3">
        <h2 id="queue-heading" className="font-semibold">
          Today's queue
        </h2>
        <div className="flex gap-2">
          <Link to="/calendar" className="btn-ghost px-3 py-1 text-brand-700">
            Calendar
          </Link>
          <button className="btn-primary px-3 py-1" onClick={() => setWalkIn(true)}>
            Walk-in
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {rows && queue.length === 0 && <p className="mt-2 text-sm text-slate-500">No appointments today.</p>}
      <ul className="mt-2 divide-y divide-slate-100" aria-label="Today's queue">
        {queue.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2 text-sm" data-testid="queue-row">
            <span
              className="w-10 shrink-0 text-center text-lg font-bold tabular-nums text-slate-800"
              aria-label={a.token != null ? `Token ${a.token}` : 'No token'}
              data-testid="queue-token"
            >
              {a.token ?? '–'}
            </span>
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => setOpenId(a.id)}
            >
              <span className="block truncate font-medium text-brand-700">{a.patient.name}</span>
              <span className="sr-only"> at </span>
              <span className="text-xs text-slate-500">{formatTime(a.start)}</span>
            </button>
            <StatusBadge status={a.status} />
            <span className="flex basis-full justify-end gap-1 sm:basis-auto">
              {(a.status === 'booked' || a.status === 'no-show') && (
                <button className="btn-ghost border border-slate-300 px-2 py-1" onClick={() => act(() => setStatus(a.id, 'arrived'))}>
                  Arrived
                </button>
              )}
              {a.status !== 'done' && (
                <button className="btn-ghost border border-brand-200 px-2 py-1 text-brand-700" onClick={() => startVisit(a)}>
                  Start visit
                </button>
              )}
              {a.status === 'booked' && (
                <button className="btn-ghost px-2 py-1 text-red-700" onClick={() => act(() => setStatus(a.id, 'no-show'))}>
                  No-show
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {walkIn && <BookingDialog mode="walkin" onClose={() => setWalkIn(false)} />}
      {openId && <AppointmentDialog id={openId} onClose={() => setOpenId(null)} />}
    </section>
  )
}
