import { parseISODate } from '../../lib/format'

const pad = (n: number) => String(n).padStart(2, '0')

export const toTimeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

export function combineDateTime(date: string, time: string): Date {
  const d = parseISODate(date)
  const [h, m] = time.split(':').map(Number)
  d.setHours(h, m, 0, 0)
  return d
}

// 1730 local -> "5:30 pm"
export function formatTime(ms: number): string {
  const d = new Date(ms)
  const h = d.getHours()
  return `${h % 12 || 12}:${pad(d.getMinutes())} ${h < 12 ? 'am' : 'pm'}`
}
