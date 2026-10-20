import type { AppointmentStatus } from '../../db/types'
import { STATUS_LABEL } from './appointmentRepo'
import { STATUS_BADGE } from './statusStyle'

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[status]}`} data-testid="status">
      {STATUS_LABEL[status]}
    </span>
  )
}
