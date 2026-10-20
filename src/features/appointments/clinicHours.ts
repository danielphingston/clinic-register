import type { ClinicSession } from '../../db/types'

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

export function toMinutes(hhmm: string): number {
  const m = HHMM.exec(hhmm)
  if (!m) return NaN
  return Number(m[1]) * 60 + Number(m[2])
}

function fromMinutes(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
}

// Returns an error message, or null if the sessions are valid.
export function validateSessions(sessions: ClinicSession[]): string | null {
  const sorted = [...sessions].sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
  for (const s of sorted) {
    if (Number.isNaN(toMinutes(s.start)) || Number.isNaN(toMinutes(s.end))) return 'Enter session times as HH:MM'
    if (toMinutes(s.end) <= toMinutes(s.start)) return 'Each session must end after it starts'
  }
  for (let i = 1; i < sorted.length; i++) {
    if (toMinutes(sorted[i].start) < toMinutes(sorted[i - 1].end)) return 'Sessions must not overlap'
  }
  return null
}

export interface CalendarHours {
  businessHours: { daysOfWeek: number[]; startTime: string; endTime: string }[]
  slotMinTime: string
  slotMaxTime: string
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]

// Maps clinic sessions to FullCalendar businessHours, and widens the visible
// time range to whole hours around the earliest start and latest end.
export function calendarHours(sessions: ClinicSession[]): CalendarHours {
  const valid = sessions.filter((s) => toMinutes(s.end) > toMinutes(s.start))
  if (valid.length === 0) {
    return { businessHours: [], slotMinTime: '08:00:00', slotMaxTime: '21:00:00' }
  }
  const min = Math.min(...valid.map((s) => toMinutes(s.start)))
  const max = Math.max(...valid.map((s) => toMinutes(s.end)))
  return {
    businessHours: valid.map((s) => ({ daysOfWeek: ALL_DAYS, startTime: s.start, endTime: s.end })),
    slotMinTime: fromMinutes(Math.floor(min / 60) * 60),
    slotMaxTime: fromMinutes(Math.min(24 * 60, Math.ceil(max / 60) * 60)),
  }
}

// The first session start at or after `now` on the same day, rounded up to the
// slot length; falls back to the next slot from now.
export function suggestedStart(sessions: ClinicSession[], slotMinutes: number, now = new Date()): Date {
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const rounded = Math.ceil(nowMin / slotMinutes) * slotMinutes
  const sorted = [...sessions].sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
  let pick = rounded
  for (const s of sorted) {
    const start = toMinutes(s.start)
    const end = toMinutes(s.end)
    if (rounded < end) {
      pick = Math.max(rounded, start)
      break
    }
  }
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  d.setMinutes(Math.min(pick, 24 * 60 - slotMinutes))
  return d
}

// Widens the visible range so appointments outside clinic hours (late
// walk-ins, say) still show on the calendar.
export function widenForEvents(hours: CalendarHours, events: { start: number; end: number }[]): CalendarHours {
  let min = toMinutes(hours.slotMinTime.slice(0, 5))
  let max = hours.slotMaxTime.startsWith('24') ? 24 * 60 : toMinutes(hours.slotMaxTime.slice(0, 5))
  for (const e of events) {
    const s = new Date(e.start)
    const startMin = s.getHours() * 60 + s.getMinutes()
    const sameDay = new Date(e.end).toDateString() === s.toDateString()
    const en = new Date(e.end)
    const endMin = sameDay ? en.getHours() * 60 + en.getMinutes() : 24 * 60
    min = Math.min(min, Math.floor(startMin / 60) * 60)
    max = Math.max(max, Math.min(24 * 60, Math.ceil(endMin / 60) * 60))
  }
  return { ...hours, slotMinTime: fromMinutes(min), slotMaxTime: fromMinutes(max) }
}
