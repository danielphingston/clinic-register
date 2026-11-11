import { mondayOf, type DateRange, type Granularity } from './dateRange'
import { addDays, daysBetween, formatDate, parseISODate, toISODate } from './format'

// Whole calendar periods for the Trends report: a week (Monday to Sunday), a
// month, a quarter or a year. With `fy`, years run April to March (the Indian
// financial year) and quarters are numbered from April. Quarters cover the
// same months either way; only their names differ.

export type PeriodKind = 'week' | 'month' | 'quarter' | 'year'

export const PERIOD_KINDS: { value: PeriodKind; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year', label: 'Year' },
]

export function isPeriodKind(s: string | null | undefined): s is PeriodKind {
  return PERIOD_KINDS.some((k) => k.value === s)
}

export interface Period {
  kind: PeriodKind
  start: string // ISO date of the period's first day
  fy: boolean
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MONTHS_IN: Record<Exclude<PeriodKind, 'week'>, number> = { month: 1, quarter: 3, year: 12 }

const firstOf = (y: number, m: number) => toISODate(new Date(y, m, 1))

// The period of the given kind that holds `date`.
export function periodOf(kind: PeriodKind, date: string, fy = false): Period {
  const d = parseISODate(date)
  const y = d.getFullYear()
  const m = d.getMonth()
  switch (kind) {
    case 'week':
      return { kind, start: mondayOf(date), fy }
    case 'month':
      return { kind, start: firstOf(y, m), fy }
    case 'quarter':
      return { kind, start: firstOf(y, m - (m % 3)), fy }
    case 'year':
      return { kind, start: fy ? firstOf(m >= 3 ? y : y - 1, 3) : firstOf(y, 0), fy }
  }
}

// The period `n` steps later (or earlier, for negative n).
export function shiftPeriod(p: Period, n: number): Period {
  if (p.kind === 'week') return { ...p, start: addDays(p.start, 7 * n) }
  const d = parseISODate(p.start)
  return { ...p, start: firstOf(d.getFullYear(), d.getMonth() + n * MONTHS_IN[p.kind]) }
}

export function periodEnd(p: Period): string {
  return addDays(shiftPeriod(p, 1).start, -1)
}

export function periodRange(p: Period): DateRange {
  return { from: p.start, to: periodEnd(p) }
}

// The same period a year back. For weeks that is 52 weeks back, so the
// weekdays line up.
export function samePeriodLastYear(p: Period): Period {
  return shiftPeriod(p, p.kind === 'week' ? -52 : -12 / MONTHS_IN[p.kind])
}

// FY 2026–27 for a year starting in April 2026.
function fyName(startYear: number): string {
  return `FY ${startYear}–${String(startYear + 1).slice(2)}`
}

// "Week of 09 Nov 2026", "November 2026", "Q4 2026 (Oct–Dec)",
// "Q3 FY 2026–27 (Oct–Dec)", "2026", "FY 2026–27".
export function periodLabel(p: Period): string {
  const d = parseISODate(p.start)
  const y = d.getFullYear()
  const m = d.getMonth()
  switch (p.kind) {
    case 'week':
      return `Week of ${formatDate(p.start)}`
    case 'month':
      return `${MONTH_NAMES[m]} ${y}`
    case 'quarter': {
      const months = `${MONTHS[m]}–${MONTHS[m + 2]}`
      if (!p.fy) return `Q${m / 3 + 1} ${y} (${months})`
      const fq = ((m + 9) % 12) / 3 + 1 // April starts Q1
      return `Q${fq} ${fyName(m >= 3 ? y : y - 1)} (${months})`
    }
    case 'year':
      return p.fy ? fyName(y) : String(y)
  }
}

// How the Trends charts bucket each kind of period.
export function periodGranularity(kind: PeriodKind): Granularity {
  return kind === 'year' ? 'month' : kind === 'quarter' ? 'week' : 'day'
}

export function isCurrentPeriod(p: Period, today: string): boolean {
  return p.start <= today && today <= periodEnd(p)
}

export interface TrendWindow {
  period: Period
  label: string
  range: DateRange
}

export interface TrendWindows {
  current: TrendWindow
  previous: TrendWindow
  lastYear: TrendWindow
  // The current period is still running: it is cut at today, and the
  // comparisons cover the same number of days from their own start.
  partial: boolean
}

// The selected period and the two it is compared with. A period still in
// progress is compared like for like: 1–11 Nov with 1–11 Oct and 1–11 Nov
// last year, not with the whole of October.
export function trendWindows(p: Period, today: string): TrendWindows {
  const end = periodEnd(p)
  const partial = isCurrentPeriod(p, today) && today < end
  const days = daysBetween(p.start, partial ? today : end)
  const window = (q: Period): TrendWindow => {
    const qEnd = periodEnd(q)
    const to = partial ? addDays(q.start, days) : qEnd
    return { period: q, label: periodLabel(q), range: { from: q.start, to: to < qEnd ? to : qEnd } }
  }
  return {
    current: window(p),
    previous: window(shiftPeriod(p, -1)),
    lastYear: window(samePeriodLastYear(p)),
    partial,
  }
}
