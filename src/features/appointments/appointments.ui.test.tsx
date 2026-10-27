import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { db } from '../../db/db'
import { getSettings } from '../../db/repo'
import { addDays, todayISO } from '../../lib/format'
import { createPatient } from '../patients/patientRepo'
import { bookAppointment, setStatus } from './appointmentRepo'
import { combineDateTime } from './time'

vi.mock('../../auth/google', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/google')>()),
  requestToken: vi.fn(),
  fetchProfile: vi.fn(),
  revokeToken: vi.fn().mockResolvedValue(undefined),
}))

vi.setConfig({ testTimeout: 20_000 })

beforeAll(() => {
  // FullCalendar measures layout; jsdom has no ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

function open(path: string) {
  localStorage.setItem('auth:profile', JSON.stringify({ sub: '1', email: 'd@x.com', name: 'D' }))
  window.history.replaceState(null, '', path)
  return render(<App />)
}

const at = (dayOffset: number, time: string) => combineDateTime(addDays(todayISO(), dayOffset), time)
const tomorrow = addDays(todayISO(), 1)

describe('booking dialog', () => {
  it('books from the patient profile, prefilled with the patient', async () => {
    const user = userEvent.setup()
    const p = await createPatient({ name: 'Asha Menon' })
    open(`/patients/${p.id}`)
    const card = await screen.findByTestId('patient-appointments')
    expect(await within(card).findByText('No upcoming appointments.')).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Book appointment' }))

    const dialog = await screen.findByRole('dialog', { name: 'Book appointment' })
    expect(within(dialog).getByTestId('picked-patient')).toHaveTextContent('Asha Menon')
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: tomorrow } })
    fireEvent.change(within(dialog).getByLabelText('Time'), { target: { value: '10:30' } })
    await waitFor(() => expect(within(dialog).getByLabelText('Duration')).toHaveValue('15'))
    await user.click(within(dialog).getByRole('button', { name: 'Book' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await within(card).findByText(/10:30 am/)).toBeInTheDocument()
    const [a] = await db.appointments.toArray()
    expect(a).toMatchObject({ patientId: p.id, start: +at(1, '10:30'), end: +at(1, '10:45'), status: 'booked' })
  })

  it('quick-adds a new patient and shows overlap errors; Escape closes', async () => {
    const user = userEvent.setup()
    const other = await createPatient({ name: 'Ravi' })
    await bookAppointment(other.id, at(1, '10:00'))
    open('/')
    await user.click(await screen.findByRole('button', { name: 'Walk-in' }))
    let dialog = await screen.findByRole('dialog', { name: 'Walk-in' })
    expect(within(dialog).getByLabelText('Patient')).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    const p = await createPatient({ name: 'Booker' })
    open(`/patients/${p.id}`)
    await user.click(await screen.findByRole('button', { name: 'Book appointment' }))
    dialog = await screen.findByRole('dialog', { name: 'Book appointment' })
    await user.click(within(dialog).getByRole('button', { name: 'Change' }))
    await user.type(within(dialog).getByLabelText('Patient'), 'Meera')
    expect(await within(dialog).findByText('No match.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '+ New patient' }))
    expect(within(dialog).getByLabelText('New patient name')).toHaveValue('Meera')
    await user.type(within(dialog).getByLabelText('Phone'), '123')
    await user.click(within(dialog).getByRole('button', { name: 'Add patient' }))
    expect(await within(dialog).findByText('Enter a 10-digit Indian mobile number')).toBeInTheDocument()
    await user.clear(within(dialog).getByLabelText('Phone'))
    await user.type(within(dialog).getByLabelText('Phone'), '9876543210')
    await user.click(within(dialog).getByRole('button', { name: 'Add patient' }))
    expect(await within(dialog).findByTestId('picked-patient')).toHaveTextContent('Meera')

    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: tomorrow } })
    fireEvent.change(within(dialog).getByLabelText('Time'), { target: { value: '10:05' } })
    await user.click(within(dialog).getByRole('button', { name: 'Book' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent("Overlaps with Ravi's appointment")

    const meera = (await db.patients.toArray()).find((x) => x.name === 'Meera')!
    expect(meera.phone).toBe('9876543210')
    expect(meera.opNo).toMatch(/^OP-/)
  })
})

describe('dashboard queue', () => {
  it('marks arrived with tokens, no-show, walk-in and start visit', async () => {
    const user = userEvent.setup()
    const a = await createPatient({ name: 'Asha' })
    const b = await createPatient({ name: 'Ravi' })
    const c = await createPatient({ name: 'Meera' })
    await createPatient({ name: 'Walker' })
    await bookAppointment(a.id, at(0, '00:00'))
    await bookAppointment(b.id, at(0, '00:15'))
    await bookAppointment(c.id, at(0, '00:30'))
    const cancelled = await bookAppointment(c.id, at(0, '00:45'))
    await setStatus(cancelled.id, 'cancelled')
    open('/')

    const queue = await screen.findByRole('list', { name: "Today's queue" })
    await waitFor(() => expect(within(queue).getAllByTestId('queue-row')).toHaveLength(3))
    expect(screen.getByText("Today's appointments").nextSibling).toHaveTextContent('3')

    const row = (name: string) => within(queue).getAllByTestId('queue-row').find((r) => r.textContent!.includes(name))!
    await user.click(within(row('Ravi')).getByRole('button', { name: 'Arrived' }))
    await waitFor(() => expect(within(row('Ravi')).getByTestId('queue-token')).toHaveTextContent('1'))
    await user.click(within(row('Asha')).getByRole('button', { name: 'Arrived' }))
    await waitFor(() => expect(within(row('Asha')).getByTestId('queue-token')).toHaveTextContent('2'))
    expect(within(row('Asha')).getByTestId('status')).toHaveTextContent('Arrived')

    await user.click(within(row('Meera')).getByRole('button', { name: 'No-show' }))
    await waitFor(() => expect(within(row('Meera')).getByTestId('status')).toHaveTextContent('No-show'))

    await user.click(screen.getByRole('button', { name: 'Walk-in' }))
    const dialog = await screen.findByRole('dialog', { name: 'Walk-in' })
    await user.type(within(dialog).getByLabelText('Patient'), 'Walk')
    await user.click(await within(dialog).findByRole('button', { name: /Walker/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Add walk-in' }))
    await waitFor(() => expect(within(queue).getAllByTestId('queue-row')).toHaveLength(4))
    expect(within(row('Walker')).getByTestId('queue-token')).toHaveTextContent('3')

    await user.click(within(row('Ravi')).getByRole('button', { name: 'Start visit' }))
    expect(await screen.findByRole('heading', { name: /New visit/i })).toBeInTheDocument()
    expect(window.location.pathname).toBe(`/patients/${b.id}/visits/new`)
  })
})

describe('calendar and print', () => {
  it('renders the calendar page with events and opens details', async () => {
    const user = userEvent.setup()
    const p = await createPatient({ name: 'Asha' })
    const appt = await bookAppointment(p.id, at(0, '23:00'))
    await setStatus(appt.id, 'arrived')
    open('/calendar')
    expect(await screen.findByRole('heading', { name: 'Calendar' })).toBeInTheDocument()
    const ev = await screen.findByTitle(/^Asha · .* · Arrived$/, {}, { timeout: 5000 })
    expect(ev).toHaveTextContent('#1 Asha')
    await user.click(ev)
    const dialog = await screen.findByRole('dialog', { name: 'Appointment' })
    expect(within(dialog).getByTestId('token')).toHaveTextContent('1')
    expect(within(dialog).getByRole('link', { name: 'Asha' })).toHaveAttribute('href', `/patients/${p.id}`)
    await user.click(within(dialog).getByRole('button', { name: 'Mark done' }))
    await waitFor(() => expect(within(dialog).getByTestId('status')).toHaveTextContent('Done'))
  })

  it('shows today’s token on the OP slip', async () => {
    const p = await createPatient({ name: 'Asha' })
    const appt = await bookAppointment(p.id, at(0, '00:00'))
    await setStatus(appt.id, 'arrived')
    open(`/print/op-slip/${p.id}`)
    expect(await screen.findByTestId('op-token')).toHaveTextContent('1')
  })

  it('saves clinic sessions in settings', async () => {
    const user = userEvent.setup()
    open('/settings?tab=hours')
    const end = await screen.findByLabelText('to', { selector: '#session-0-end' })
    fireEvent.change(end, { target: { value: '08:00' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Each session must end after it starts')).toBeInTheDocument()
    fireEvent.change(end, { target: { value: '12:30' } })
    await user.click(screen.getByRole('button', { name: 'Remove session 2' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved')
    expect((await getSettings()).sessions).toEqual([{ start: '09:00', end: '12:30' }])
  })
})
