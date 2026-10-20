import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Modal } from '../../app/Modal'
import { db } from '../../db/db'
import type { AppointmentStatus } from '../../db/types'
import { formatDate, toISODate } from '../../lib/format'
import { allowedTransitions, reschedule, setStatus } from './appointmentRepo'
import { StatusBadge } from './StatusBadge'
import { combineDateTime, formatTime, toTimeInput } from './time'

const ACTION_LABEL: Partial<Record<AppointmentStatus, string>> = {
  arrived: 'Mark arrived',
  done: 'Mark done',
  'no-show': 'No-show',
}

export function AppointmentDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const navigate = useNavigate()
  const appt = useLiveQuery(async () => (await db.appointments.get(id)) ?? null, [id])
  const patient = useLiveQuery(async () => (appt ? ((await db.patients.get(appt.patientId)) ?? null) : undefined), [appt?.patientId])
  const [error, setError] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [editing, setEditing] = useState(false)
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [duration, setDuration] = useState(15)

  if (appt === undefined || patient === undefined) return null
  if (!appt || appt.deleted || !patient) {
    return (
      <Modal title="Appointment" onClose={onClose}>
        <p className="text-sm">Appointment not found.</p>
      </Modal>
    )
  }
  const a = appt

  async function run(fn: () => Promise<unknown>) {
    setError('')
    try {
      await fn()
      return true
    } catch (err) {
      setError((err as Error).message)
      return false
    }
  }

  async function startVisit() {
    if (a.status === 'booked' || a.status === 'no-show') {
      if (!(await run(() => setStatus(a.id, 'arrived')))) return
    }
    onClose()
    navigate(`/patients/${a.patientId}/visits/new`)
  }

  function openReschedule() {
    const s = new Date(a.start)
    setDate(toISODate(s))
    setTime(toTimeInput(s))
    setDuration(Math.round((a.end - a.start) / 60_000))
    setEditing(true)
  }

  async function saveReschedule(e: FormEvent) {
    e.preventDefault()
    const s = combineDateTime(date, time)
    if (await run(() => reschedule(a.id, s, s.getTime() + duration * 60_000))) setEditing(false)
  }

  const transitions = allowedTransitions(a.status).filter((s) => s !== 'cancelled')
  const canCancel = allowedTransitions(a.status).includes('cancelled')
  const startable = ['booked', 'arrived', 'no-show'].includes(a.status)

  return (
    <Modal title="Appointment" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link to={`/patients/${patient.id}`} className="text-base font-semibold text-brand-700 hover:underline" onClick={onClose}>
              {patient.name}
            </Link>
            <div className="font-mono text-xs text-slate-500">{patient.opNo}</div>
          </div>
          {a.token != null && (
            <div className="text-right">
              <div className="text-xs text-slate-500">Token</div>
              <div className="text-2xl font-bold" data-testid="token">
                {a.token}
              </div>
            </div>
          )}
        </div>
        <p>
          {formatDate(toISODate(new Date(a.start)))} · {formatTime(a.start)} – {formatTime(a.end)}
        </p>
        <p>
          <StatusBadge status={a.status} />
        </p>
        {a.notes && <p className="text-slate-600">{a.notes}</p>}

        {editing ? (
          <form onSubmit={saveReschedule} className="space-y-2 rounded-md border border-slate-200 p-3" aria-label="Reschedule">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="label" htmlFor="rs-date">
                  Date
                </label>
                <input id="rs-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="rs-time">
                  Time
                </label>
                <input id="rs-time" type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="rs-dur">
                  Minutes
                </label>
                <input
                  id="rs-dur"
                  type="number"
                  min={5}
                  step={5}
                  className="input"
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn-primary">
                Save time
              </button>
              <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>
                Back
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            {startable && (
              <button type="button" className="btn-primary" onClick={startVisit}>
                Start visit
              </button>
            )}
            {transitions.map((s) => (
              <button key={s} type="button" className="btn-ghost border border-slate-300" onClick={() => run(() => setStatus(a.id, s))}>
                {ACTION_LABEL[s] ?? s}
              </button>
            ))}
            {a.status === 'booked' && (
              <button type="button" className="btn-ghost border border-slate-300" onClick={openReschedule}>
                Reschedule
              </button>
            )}
            {canCancel &&
              (confirmCancel ? (
                <button type="button" className="btn bg-red-600 text-white hover:bg-red-700" onClick={() => run(() => setStatus(a.id, 'cancelled'))}>
                  Confirm cancel
                </button>
              ) : (
                <button type="button" className="btn-ghost border border-red-200 text-red-700" onClick={() => setConfirmCancel(true)}>
                  Cancel appointment
                </button>
              ))}
          </div>
        )}
        {error && (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
