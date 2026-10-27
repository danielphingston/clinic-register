import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { addDays, todayISO } from '../../lib/format'
import { createBill } from '../billing/billingRepo'
import { createPatient } from '../patients/patientRepo'

vi.mock('../../auth/google', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/google')>()),
  requestToken: vi.fn(),
  fetchProfile: vi.fn(),
  revokeToken: vi.fn().mockResolvedValue(undefined),
}))

describe('dashboard live updates', () => {
  // Regression: live queries written as `() => helper()` (not async) lost
  // Dexie's tracking after the helper's first await, so the trend ignored
  // new payments until a reload.
  it('updates the 30-day trend when a payment is recorded', async () => {
    const p = await createPatient({ name: 'Asha' })
    await createBill({ patientId: p.id, date: todayISO(), items: [{ desc: 'Consultation', amount: 300 }], discount: 0, payNow: { amount: 300, mode: 'cash' } })
    localStorage.setItem('auth:profile', JSON.stringify({ sub: '1', email: 'd@x.com', name: 'D' }))
    render(<App />)
    const trend = await screen.findByRole('region', { name: 'Last 30 days' })
    expect(await within(trend).findByText(/₹300 collected/)).toBeInTheDocument()

    await createBill({ patientId: p.id, date: todayISO(), items: [{ desc: 'Medicines', amount: 150 }], discount: 0, payNow: { amount: 150, mode: 'upi' } })
    expect(await within(trend).findByText(/₹450 collected/)).toBeInTheDocument()
  })

  it('shows a chosen month and navigates between months', async () => {
    const p = await createPatient({ name: 'Asha' })
    const thisMonth = `${todayISO().slice(0, 8)}01`
    const lastMonth = addDays(thisMonth, -1) // last day of the previous month
    await createBill({ patientId: p.id, date: lastMonth, items: [{ desc: 'Consultation', amount: 200 }], discount: 0, payNow: { amount: 200, mode: 'cash' } })
    await createBill({ patientId: p.id, date: todayISO(), items: [{ desc: 'Consultation', amount: 500 }], discount: 0, payNow: { amount: 500, mode: 'cash' } })
    localStorage.setItem('auth:profile', JSON.stringify({ sub: '1', email: 'd@x.com', name: 'D' }))
    render(<App />)
    const user = userEvent.setup()
    const trend = await screen.findByRole('region', { name: 'Last 30 days' })
    expect(within(trend).getByRole('button', { name: 'Next month' })).toBeDisabled()

    await user.click(within(trend).getByRole('button', { name: 'Previous month' }))
    const label = new Date(lastMonth).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    const prevTrend = await screen.findByRole('region', { name: label })
    expect(await within(prevTrend).findByText(/₹200 collected/)).toBeInTheDocument()
    expect(within(prevTrend).getByText(/0 visits/)).toBeInTheDocument()
    expect(within(prevTrend).getByRole('button', { name: 'Next month' })).toBeEnabled()

    await user.click(within(prevTrend).getByRole('button', { name: 'Next month' }))
    const cur = await screen.findByRole('region', { name: /20\d\d$/ })
    expect(await within(cur).findByText(/₹500 collected/)).toBeInTheDocument()
    expect(within(cur).getByRole('button', { name: 'Next month' })).toBeDisabled()

    await user.selectOptions(within(cur).getByRole('combobox', { name: 'Period' }), '')
    expect(await screen.findByRole('region', { name: 'Last 30 days' })).toBeInTheDocument()
  })
})
