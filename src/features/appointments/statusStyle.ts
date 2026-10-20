import type { AppointmentStatus } from '../../db/types'

// Event colours on the calendar (background, border/text).
export const STATUS_COLOR: Record<AppointmentStatus, { bg: string; fg: string }> = {
  booked: { bg: '#dbeafe', fg: '#1e40af' },
  arrived: { bg: '#fef3c7', fg: '#92400e' },
  done: { bg: '#d1fae5', fg: '#065f46' },
  'no-show': { bg: '#fee2e2', fg: '#991b1b' },
  cancelled: { bg: '#f1f5f9', fg: '#64748b' },
}

export const STATUS_BADGE: Record<AppointmentStatus, string> = {
  booked: 'bg-blue-100 text-blue-800',
  arrived: 'bg-amber-100 text-amber-800',
  done: 'bg-emerald-100 text-emerald-800',
  'no-show': 'bg-red-100 text-red-800',
  cancelled: 'bg-slate-100 text-slate-600',
}
