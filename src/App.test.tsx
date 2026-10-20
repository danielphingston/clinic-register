import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import * as google from './auth/google'
import { db } from './db/db'
import { getSettings, insert } from './db/repo'
import type { Patient } from './db/types'

// Google is never contacted in tests: the token/profile calls are mocked and
// the client ID is blank (see vitest.config.ts).
vi.mock('./auth/google', async (importOriginal) => {
  const actual = await importOriginal<typeof google>()
  return {
    ...actual,
    requestToken: vi.fn(),
    fetchProfile: vi.fn(),
    revokeToken: vi.fn(),
  }
})

const PROFILE: google.GoogleProfile = {
  sub: '123',
  email: 'doctor@example.com',
  name: 'Dr Test',
}

function signedIn() {
  localStorage.setItem('auth:profile', JSON.stringify(PROFILE))
}

function goTo(path: string) {
  window.history.replaceState(null, '', path)
}

beforeEach(() => {
  vi.mocked(google.requestToken).mockReset()
  vi.mocked(google.fetchProfile).mockReset()
  vi.mocked(google.revokeToken).mockReset().mockResolvedValue()
})

describe('sign-in screen', () => {
  it('shows setup instructions when no client ID is configured', () => {
    render(<App />)
    expect(screen.getByText(/Google sign-in is not configured/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sign in with google/i })).not.toBeInTheDocument()
  })

  it('signs in with Google and lands on the dashboard', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id')
    vi.mocked(google.requestToken).mockResolvedValue({ token: 'tok', expiresAt: Date.now() + 3_600_000 })
    vi.mocked(google.fetchProfile).mockResolvedValue(PROFILE)

    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /sign in with google/i }))

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(google.requestToken).toHaveBeenCalledWith({ prompt: 'select_account' })
    expect(google.fetchProfile).toHaveBeenCalledWith('tok')
    expect(JSON.parse(localStorage.getItem('auth:profile')!)).toEqual(PROFILE)
  })

  it('shows the error and stays on sign-in when Google fails', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id')
    vi.mocked(google.requestToken).mockRejectedValue(new Error('popup_closed'))

    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /sign in with google/i }))

    expect(await screen.findByText('popup_closed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeEnabled()
    expect(localStorage.getItem('auth:profile')).toBeNull()
  })
})

describe('signed-in app', () => {
  it('opens straight to the dashboard from a saved profile without contacting Google', async () => {
    signedIn()
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(google.requestToken).not.toHaveBeenCalled()
    expect(screen.getAllByText(PROFILE.email).length).toBeGreaterThan(0)
  })

  it('shows the welcome prompt until clinic details are saved', async () => {
    signedIn()
    render(<App />)
    expect(await screen.findByText(/Start by adding your clinic details/)).toBeInTheDocument()
  })

  it('counts only non-deleted patients on the dashboard', async () => {
    signedIn()
    await insert<Patient>(db.patients, { opNo: 'OP-1', name: 'A' })
    const b = await insert<Patient>(db.patients, { opNo: 'OP-2', name: 'B' })
    await db.patients.update(b.id, { deleted: 1 })

    render(<App />)
    const label = await screen.findByText('Total patients', { selector: 'div' })
    await waitFor(() => expect(label.nextElementSibling).toHaveTextContent('1'))
  })

  it('saves clinic settings and defaults an empty OP prefix to "OP"', async () => {
    signedIn()
    goTo('/settings')
    render(<App />)

    await userEvent.type(await screen.findByLabelText('Clinic name'), 'Sunrise Homeo Clinic')
    await userEvent.clear(screen.getByLabelText('OP number prefix'))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Saved')).toBeInTheDocument()
    const s = await getSettings()
    expect(s.clinicName).toBe('Sunrise Homeo Clinic')
    expect(s.opPrefix).toBe('OP')
    expect(screen.getByLabelText('OP number prefix')).toHaveValue('OP')
  })

  it('signs out to the sign-in screen but keeps local data', async () => {
    signedIn()
    await insert<Patient>(db.patients, { opNo: 'OP-1', name: 'A' })
    goTo('/settings')
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }))

    expect(await screen.findByText(/Google sign-in is not configured/)).toBeInTheDocument()
    expect(localStorage.getItem('auth:profile')).toBeNull()
    expect(window.location.pathname).toBe('/')
    expect(await db.patients.count()).toBe(1)
  })

  it('renders the lazy reports page and redirects unknown routes', async () => {
    signedIn()
    goTo('/reports')
    const { unmount } = render(<App />)
    expect(await screen.findByRole('heading', { name: 'Reports' })).toBeInTheDocument()
    unmount()

    goTo('/does-not-exist')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
  })
})
