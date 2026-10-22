import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { getSettings, saveSettings } from '../../db/repo'

vi.mock('../../auth/google', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/google')>()),
  requestToken: vi.fn(),
  fetchProfile: vi.fn(),
  revokeToken: vi.fn().mockResolvedValue(undefined),
}))

vi.setConfig({ testTimeout: 20_000 })

describe('settings number fields', () => {
  it('can be cleared before typing a new value, and a blank one is rejected on save', async () => {
    await saveSettings({ ...(await getSettings()), consultationFee: 300 })
    localStorage.setItem('auth:profile', JSON.stringify({ sub: '1', email: 'd@x.com', name: 'D' }))
    window.history.replaceState(null, '', '/settings')
    render(<App />)
    const user = userEvent.setup()

    const fee = await screen.findByLabelText('Consultation fee (₹)')
    await user.clear(fee)
    expect(fee).toHaveValue(null)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a consultation fee of 0 or more')

    await user.type(fee, '450')
    expect(fee).toHaveValue(450)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(async () => expect((await getSettings()).consultationFee).toBe(450))
  })
})
