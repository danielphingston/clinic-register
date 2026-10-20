import { addDays, daysBetween, formatDate, parseISODate, toISODate } from './format'

export type RangePreset = 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'custom'

export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'thisWeek', label: 'This week' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'lastMonth', label: 'Last month' },
  { value: 'thisYear', label: 'This year' },
  { value: 'custom', label: 'Custom' },
]

export interface DateRange {
  from: string
  to: string
}

// Inclusive local-date ranges. Weeks start on Monday.
export function presetRange(preset: Exclude<RangePreset, 'custom'>, today: string): DateRange {
  const d = parseISODate(today)
  const y = d.getFullYear()
  const m = d.getMonth()
  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case 'yesterday': {
      const y1 = addDays(today, -1)
      return { from: y1, to: y1 }
    }
    case 'thisWeek': {
      const back = (d.getDay() + 6) % 7
      return { from: addDays(today, -back), to: today }
    }
    case 'thisMonth':
      return { from: toISODate(new Date(y, m, 1)), to: today }
    case 'lastMonth':
      return { from: toISODate(new Date(y, m - 1, 1)), to: toISODate(new Date(y, m, 0)) }
    case 'thisYear':
      return { from: toISODate(new Date(y, 0, 1)), to: today }
  }
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

export function isISODate(s: string | null | undefined): s is string {
  return !!s && ISO.test(s) && toISODate(parseISODate(s)) === s
}

// Days in the range, both ends included.
export function rangeDays(r: DateRange): number {
  return daysBetween(r.from, r.to) + 1
}

// Charts and summaries switch from days to months for long ranges.
export type Granularity = 'day' | 'month'

export function granularityFor(r: DateRange): Granularity {
  return rangeDays(r) > 62 ? 'month' : 'day'
}

export function bucketKey(iso: string, g: Granularity): string {
  return g === 'day' ? iso : iso.slice(0, 7)
}

// Every bucket key in the range, so empty days/months still appear.
export function bucketKeys(r: DateRange, g: Granularity): string[] {
  const out: string[] = []
  if (r.from > r.to) return out
  if (g === 'day') {
    for (let d = r.from; d <= r.to; d = addDays(d, 1)) out.push(d)
    return out
  }
  const start = parseISODate(r.from)
  const cur = new Date(start.getFullYear(), start.getMonth(), 1)
  const end = r.to.slice(0, 7)
  for (;;) {
    const key = toISODate(cur).slice(0, 7)
    if (key > end) break
    out.push(key)
    cur.setMonth(cur.getMonth() + 1)
  }
  return out
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Short axis label: "20 Oct" for a day, "Oct 2026" for a month.
export function bucketLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return d ? `${d} ${MONTHS[m - 1]}` : `${MONTHS[m - 1]} ${y}`
}

export function rangeLabel(r: DateRange): string {
  return r.from === r.to ? formatDate(r.from) : `${formatDate(r.from)} to ${formatDate(r.to)}`
}
