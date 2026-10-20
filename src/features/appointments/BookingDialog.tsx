import { useEffect, useState, type FormEvent } from 'react'
import { Modal } from '../../app/Modal'
import { getSettings } from '../../db/repo'
import type { Appointment, Patient } from '../../db/types'
import { toISODate } from '../../lib/format'
import { bookAppointment, walkIn } from './appointmentRepo'
import { suggestedStart } from './clinicHours'
import { PatientPicker } from './PatientPicker'
import { combineDateTime, toTimeInput } from './time'

const DURATIONS = [5, 10, 15, 20, 30, 45, 60]

interface Props {
  mode?: 'book' | 'walkin'
  patient?: Patient
  start?: Date
  durationMin?: number
  onClose: () => void
  onDone?: (a: Appointment) => void
}

export function BookingDialog({ mode = 'book', patient: initialPatient, start, durationMin, onClose, onDone }: Props) {
  const [patient, setPatient] = useState<Patient | null>(initialPatient ?? null)
  const [date, setDate] = useState(start ? toISODate(start) : '')
  const [time, setTime] = useState(start ? toTimeInput(start) : '')
  const [duration, setDuration] = useState(durationMin ?? 0)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    getSettings().then((s) => {
      if (!live) return
      setDuration((d) => d || s.slotMinutes)
      if (!start) {
        const st = suggestedStart(s.sessions, s.slotMinutes)
        setDate((v) => v || toISODate(st))
        setTime((v) => v || toTimeInput(st))
      }
    })
    return () => {
      live = false
    }
  }, [start])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!patient) return setError('Choose a patient')
    setError('')
    setBusy(true)
    try {
      let a: Appointment
      if (mode === 'walkin') a = await walkIn(patient.id, duration || 15)
      else {
        if (!date || !time) throw new Error('Enter date and time')
        a = await bookAppointment(patient.id, combineDateTime(date, time), duration || 15, notes)
      }
      onDone?.(a)
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  const isWalkIn = mode === 'walkin'

  return (
    <Modal title={isWalkIn ? 'Walk-in' : 'Book appointment'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <PatientPicker value={patient} onChange={setPatient} />
        {!isWalkIn && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="bk-date">
                  Date
                </label>
                <input id="bk-date" type="date" data-autofocus className="input" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="bk-time">
                  Time
                </label>
                <input id="bk-time" type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="bk-duration">
                  Duration
                </label>
                <select
                  id="bk-duration"
                  className="input"
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                >
                  {[...new Set([...DURATIONS, duration].filter(Boolean))]
                    .sort((a, b) => a - b)
                    .map((d) => (
                      <option key={d} value={d}>
                        {d} min
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="bk-notes">
                  Notes
                </label>
                <input id="bk-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
          </>
        )}
        {isWalkIn && <p className="text-sm text-slate-500">The patient is added to today's queue now and gets the next token.</p>}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Close
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !patient}>
            {isWalkIn ? 'Add walk-in' : 'Book'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
