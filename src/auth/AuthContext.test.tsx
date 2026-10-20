import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from './AuthContext'
import { useAuth } from './useAuth'
import * as google from './google'

vi.mock('./google', () => ({
  requestToken: vi.fn(),
  fetchProfile: vi.fn(),
  revokeToken: vi.fn(),
}))

const PROFILE = { sub: '1', email: 'doc@example.com', name: 'Doc' }

function setup() {
  let auth!: ReturnType<typeof useAuth>
  function Probe() {
    auth = useAuth()
    return null
  }
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  )
  return () => auth
}

beforeEach(() => {
  vi.mocked(google.requestToken).mockReset()
  vi.mocked(google.fetchProfile).mockReset().mockResolvedValue(PROFILE)
  vi.mocked(google.revokeToken).mockReset().mockResolvedValue()
})

describe('getToken', () => {
  it('reuses the token from sign-in while it is valid', async () => {
    vi.mocked(google.requestToken).mockResolvedValue({ token: 'a', expiresAt: Date.now() + 60_000 })
    const auth = setup()
    await act(() => auth().signIn())

    expect(await auth().getToken()).toBe('a')
    expect(google.requestToken).toHaveBeenCalledTimes(1)
  })

  it('silently refreshes an expired token with the account hint', async () => {
    vi.mocked(google.requestToken)
      .mockResolvedValueOnce({ token: 'old', expiresAt: Date.now() - 1 })
      .mockResolvedValueOnce({ token: 'new', expiresAt: Date.now() + 60_000 })
    const auth = setup()
    await act(() => auth().signIn())

    expect(await auth().getToken()).toBe('new')
    expect(google.requestToken).toHaveBeenLastCalledWith({ prompt: '', hint: PROFILE.email })
  })

  it('fetches a token on demand after an offline start from a saved profile', async () => {
    localStorage.setItem('auth:profile', JSON.stringify(PROFILE))
    vi.mocked(google.requestToken).mockResolvedValue({ token: 't', expiresAt: Date.now() + 60_000 })
    const auth = setup()

    expect(auth().profile).toEqual(PROFILE)
    expect(await auth().getToken()).toBe('t')
    expect(google.requestToken).toHaveBeenCalledWith({ prompt: '', hint: PROFILE.email })
  })
})

describe('signOut', () => {
  it('revokes the token and clears the saved profile', async () => {
    vi.mocked(google.requestToken).mockResolvedValue({ token: 'a', expiresAt: Date.now() + 60_000 })
    const auth = setup()
    await act(() => auth().signIn())
    await act(() => auth().signOut())

    expect(google.revokeToken).toHaveBeenCalledWith('a')
    expect(auth().profile).toBeNull()
    expect(localStorage.getItem('auth:profile')).toBeNull()
  })

  it('ignores a corrupt saved profile', () => {
    localStorage.setItem('auth:profile', '{not json')
    const auth = setup()
    expect(auth().profile).toBeNull()
  })
})
