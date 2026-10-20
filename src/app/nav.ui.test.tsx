import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from '../App'
import { db } from '../db/db'
import { insert } from '../db/repo'
import type { Appointment } from '../db/types'
import { createPatient } from '../features/patients/patientRepo'
import { createStockItem } from '../features/stock/stockRepo'
import { seedRemedies, seedRemedyId } from '../features/remedies/remedyRepo'
import { addDays, parseISODate, todayISO } from '../lib/format'
import { saveVisit } from '../features/visits/visitRepo'

vi.mock('../auth/google', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth/google')>()),
  requestToken: vi.fn(),
  fetchProfile: vi.fn(),
  revokeToken: vi.fn().mockResolvedValue(undefined),
}))

vi.setConfig({ testTimeout: 20_000 })

function open(path: string) {
  localStorage.setItem('auth:profile', JSON.stringify({ sub: '1', email: 'd@x.com', name: 'D' }))
  window.history.replaceState(null, '', path)
  return render(<App />)
}

describe('mobile bottom nav', () => {
  it('has five items; More opens an accessible sheet with Stock, Reports and Settings', async () => {
    const user = userEvent.setup()
    open('/')
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    const label = (l: HTMLElement) => l.textContent?.slice(1) // after the icon
    const items = within(nav).getAllByRole('link').map(label)
    expect(items).toEqual(['Dashboard', 'Patients', 'Calendar', 'Billing'])
    const more = within(nav).getByRole('button', { name: 'More' })
    expect(more).toHaveAttribute('aria-haspopup', 'dialog')
    expect(more).toHaveAttribute('aria-expanded', 'false')

    await user.click(more)
    const sheet = screen.getByRole('dialog', { name: 'More' })
    expect(more).toHaveAttribute('aria-expanded', 'true')
    expect(within(sheet).getAllByRole('link').map(label)).toEqual(['Stock', 'Reports', 'Settings'])
    expect(within(sheet).getByRole('link', { name: 'Stock' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'More' })).toBeNull()
    expect(more).toHaveFocus()

    await user.click(more)
    await user.click(within(screen.getByRole('dialog', { name: 'More' })).getByRole('link', { name: 'Reports' }))
    expect(await screen.findByRole('heading', { name: 'Reports' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'More' })).toBeNull()
    expect(more).toHaveClass('text-brand-700') // More shows as the active section
  })
})

describe('reminders bell', () => {
  it('counts today’s open appointments and low stock, linking to each page', async () => {
    const user = userEvent.setup()
    await seedRemedies()
    const p = await createPatient({ name: 'Asha' })
    const start = parseISODate(todayISO()).getTime() + 23 * 3600_000
    await insert<Appointment>(db.appointments, { patientId: p.id, start, end: start + 900_000, status: 'booked' })
    await createStockItem({ remedyId: seedRemedyId('Sulphur'), potency: '30C', form: 'dilution', unit: 'ml', lowStockAt: 10, price: 1, openingQty: 2 })
    open('/')
    const bell = await screen.findByRole('button', { name: 'Reminders, 2 pending' })
    expect(screen.getByTestId('reminder-badge')).toHaveTextContent('2')
    await user.click(bell)
    const panel = screen.getByRole('region', { name: 'Reminders' })
    expect(within(panel).getByRole('link', { name: /Appointments today/ })).toHaveAttribute('href', '/calendar')
    await user.click(within(panel).getByRole('link', { name: /Low stock/ }))
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe('/stock?filter=low'))
    expect(screen.queryByRole('region', { name: 'Reminders' })).toBeNull()
  })

  it('lists follow-up patients under the follow-ups entry, each linking to the profile', async () => {
    const user = userEvent.setup()
    const p = await createPatient({ name: 'Ravi' })
    await saveVisit({ patientId: p.id, date: addDays(todayISO(), -7), caseNotes: {}, followUpDate: todayISO(), items: [] })
    open('/')
    await user.click(await screen.findByRole('button', { name: 'Reminders, 1 pending' }))
    const panel = screen.getByRole('region', { name: 'Reminders' })
    expect(within(panel).getByRole('link', { name: /Follow-ups due/ })).toHaveAttribute('href', '/#followups')
    const list = await within(panel).findByRole('list', { name: 'Patients due for follow-up' })
    await user.click(within(list).getByRole('link', { name: 'Ravi' }))
    await waitFor(() => expect(window.location.pathname).toBe(`/patients/${p.id}`))
  })
})
