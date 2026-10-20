import type { DatesSetArg, EventChangeArg, EventClickArg, EventContentArg, EventInput } from '@fullcalendar/core'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin, { type DateClickArg } from '@fullcalendar/interaction'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useRef, useState } from 'react'
import { getSettings } from '../../db/repo'
import { parseISODate, todayISO } from '../../lib/format'
import { appointmentsInRange, reschedule, STATUS_LABEL } from './appointmentRepo'
import { AppointmentDialog } from './AppointmentDialog'
import { BookingDialog } from './BookingDialog'
import { calendarHours, widenForEvents } from './clinicHours'
import { STATUS_COLOR } from './statusStyle'

const isDesktop = () => typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 768px)').matches

function EventBody({ event }: EventContentArg) {
  const token = event.extendedProps.token as number | undefined
  const status = STATUS_LABEL[event.extendedProps.status as keyof typeof STATUS_LABEL]
  const time = event.start?.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
  // One line so 15-minute events stay readable; details are in the tooltip.
  return (
    <div className="truncate px-0.5 text-xs leading-tight" title={`${event.title} · ${time} · ${status}`}>
      {token != null && <span className="font-bold">#{token} </span>}
      <span className="font-semibold">{event.title}</span>
      <span> {time}</span>
    </div>
  )
}

export default function CalendarPage() {
  const settings = useLiveQuery(getSettings)
  const [range, setRange] = useState<{ start: number; end: number } | null>(null)
  const appts = useLiveQuery(
    async () => (range ? appointmentsInRange(range.start, range.end) : Promise.resolve([])),
    [range?.start, range?.end],
  )
  const [booking, setBooking] = useState<{ start?: Date } | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const calRef = useRef<FullCalendar>(null)
  const [desktop] = useState(isDesktop)

  const visible = useMemo(() => (appts ?? []).filter((a) => a.status !== 'cancelled'), [appts])
  const hours = useMemo(() => widenForEvents(calendarHours(settings?.sessions ?? []), visible), [settings?.sessions, visible])

  const events: EventInput[] = useMemo(
    () =>
      visible.map((a) => {
          const c = STATUS_COLOR[a.status]
          return {
            id: a.id,
            title: a.patient.name,
            start: a.start,
            end: a.end,
            backgroundColor: c.bg,
            borderColor: c.fg,
            textColor: c.fg,
            editable: a.status === 'booked',
            classNames: [`appt-${a.status}`],
            extendedProps: { status: a.status, token: a.token },
          }
        }),
    [visible],
  )

  if (!settings) return null

  function onDatesSet(arg: DatesSetArg) {
    // FullCalendar's toolbar icons are role="img" without a name; the
    // buttons themselves are labelled.
    document.querySelectorAll('.fc .fc-icon').forEach((el) => el.setAttribute('aria-hidden', 'true'))
    setRange((r) => (r?.start === +arg.start && r?.end === +arg.end ? r : { start: +arg.start, end: +arg.end }))
  }

  function onDateClick(arg: DateClickArg) {
    setError('')
    if (arg.allDay) {
      calRef.current?.getApi().changeView('timeGridDay', arg.date)
      return
    }
    if (arg.date < parseISODate(todayISO())) {
      setError('Cannot book a date in the past')
      return
    }
    setBooking({ start: arg.date })
  }

  function onEventClick(arg: EventClickArg) {
    setOpenId(arg.event.id)
  }

  async function onEventChange(arg: EventChangeArg) {
    setError('')
    const { event } = arg
    try {
      await reschedule(event.id, event.start!, event.end ?? new Date(event.start!.getTime() + settings!.slotMinutes * 60_000))
    } catch (err) {
      arg.revert()
      setError((err as Error).message)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Calendar</h1>
        <button className="btn-primary" onClick={() => setBooking({})}>
          Book appointment
        </button>
      </div>
      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
          <button className="btn-ghost px-2 py-0.5" aria-label="Dismiss" onClick={() => setError('')}>
            ✕
          </button>
        </div>
      )}
      <div className="card p-2 sm:p-4" data-testid="calendar">
        <FullCalendar
          ref={calRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView={desktop ? 'timeGridWeek' : 'timeGridDay'}
          headerToolbar={
            desktop
              ? { left: 'prev,next today', center: 'title', right: 'timeGridDay,timeGridWeek,dayGridMonth' }
              : { left: 'prev,next', center: 'title', right: 'today' }
          }
          footerToolbar={desktop ? undefined : { center: 'timeGridDay,timeGridWeek,dayGridMonth' }}
          buttonText={{ today: 'Today', day: 'Day', week: 'Week', month: 'Month' }}
          firstDay={1}
          allDaySlot={false}
          nowIndicator
          height="auto"
          businessHours={hours.businessHours}
          slotMinTime={hours.slotMinTime}
          slotMaxTime={hours.slotMaxTime}
          slotDuration={{ minutes: settings.slotMinutes }}
          slotLabelInterval={{ hours: 1 }}
          defaultTimedEventDuration={{ minutes: settings.slotMinutes }}
          eventTimeFormat={{ hour: 'numeric', minute: '2-digit', meridiem: 'short' }}
          dayMaxEvents
          eventDisplay="block"
          eventDurationEditable
          events={events}
          eventContent={EventBody}
          datesSet={onDatesSet}
          dateClick={onDateClick}
          eventClick={onEventClick}
          eventDrop={onEventChange}
          eventResize={onEventChange}
        />
      </div>
      <p className="flex flex-wrap gap-3 text-xs text-slate-500">
        {(['booked', 'arrived', 'done', 'no-show'] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm border" style={{ background: STATUS_COLOR[s].bg, borderColor: STATUS_COLOR[s].fg }} />
            {STATUS_LABEL[s]}
          </span>
        ))}
      </p>

      {booking && (
        <BookingDialog
          start={booking.start}
          durationMin={settings.slotMinutes}
          onClose={() => setBooking(null)}
        />
      )}
      {openId && <AppointmentDialog id={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}
