import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { todayISO } from '../../lib/format'
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
})
