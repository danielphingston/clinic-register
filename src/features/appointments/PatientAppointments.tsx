import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import type { Patient } from '../../db/types'
import { formatDate, toISODate } from '../../lib/format'
import { upcomingForPatient } from './appointmentRepo'
import { AppointmentDialog } from './AppointmentDialog'
import { BookingDialog } from './BookingDialog'
import { StatusBadge } from './StatusBadge'
import { formatTime } from './time'

export function PatientAppointments({ patient }: { patient: Patient }) {
  const upcoming = useLiveQuery(async () => upcomingForPatient(patient.id), [patient.id])
  const [booking, setBooking] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  return (
    <section className="card" aria-labelledby="appts-heading" data-testid="patient-appointments">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="appts-heading" className="font-semibold">
          Appointments
        </h2>
        <button className="btn-ghost whitespace-nowrap border border-slate-300 px-3 py-1" onClick={() => setBooking(true)}>
          Book appointment
        </button>
      </div>
      {upcoming && upcoming.length === 0 && <p className="mt-2 text-sm text-slate-500">No upcoming appointments.</p>}
      <ul className="mt-2 divide-y divide-slate-100">
        {upcoming?.map((a) => (
          <li key={a.id}>
            <button type="button" className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm" onClick={() => setOpenId(a.id)}>
              <span>
                {formatDate(toISODate(new Date(a.start)))} · {formatTime(a.start)}
                {a.token != null && <span className="ml-2 whitespace-nowrap font-semibold">Token {a.token}</span>}
              </span>
              <StatusBadge status={a.status} />
            </button>
          </li>
        ))}
      </ul>
      {booking && <BookingDialog patient={patient} onClose={() => setBooking(false)} />}
      {openId && <AppointmentDialog id={openId} onClose={() => setOpenId(null)} />}
    </section>
  )
}
