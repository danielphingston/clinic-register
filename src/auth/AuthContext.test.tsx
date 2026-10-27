import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from './AuthContext'
import { useAuth } from './useAuth'
import * as google from './google'
import { ReauthRequiredError } from './authState'

vi.mock('./google', () => ({
  requestToken: vi.fn(),
  preloadGoogle: vi.fn().mockResolvedValue(undefined),
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
  localStorage.clear()
  vi.mocked(google.requestToken).mockReset()
  vi.mocked(google.preloadGoogle).mockReset().mockResolvedValue()
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

  it('throws a reauth error for an expired token without opening a popup', async () => {
    vi.mocked(google.requestToken).mockResolvedValueOnce({ token: 'old', expiresAt: Date.now() - 1 })
    const auth = setup()
    await act(() => auth().signIn())

    await expect(auth().getToken()).rejects.toBeInstanceOf(ReauthRequiredError)
    await expect(auth().getToken({ forceRefresh: true })).rejects.toMatchObject({ code: 'reauth' })
    expect(google.requestToken).toHaveBeenCalledTimes(1)
  })

  it('throws a reauth error after an offline start with no stored token', async () => {
    localStorage.setItem('auth:profile', JSON.stringify(PROFILE))
    const auth = setup()

    expect(auth().profile).toEqual(PROFILE)
    await expect(auth().getToken()).rejects.toBeInstanceOf(ReauthRequiredError)
    expect(google.requestToken).not.toHaveBeenCalled()
  })

  it('restores a stored token on startup without calling Google', async () => {
    localStorage.setItem('auth:profile', JSON.stringify(PROFILE))
    localStorage.setItem('auth:token', JSON.stringify({ token: 'kept', expiresAt: Date.now() + 60_000, sub: PROFILE.sub }))
    const auth = setup()

    expect(await auth().getToken()).toBe('kept')
    expect(google.requestToken).not.toHaveBeenCalled()
  })

  it.each([
    ['expired', { token: 'x', expiresAt: Date.now() - 1, sub: '1' }],
    ['for another account', { token: 'x', expiresAt: Date.now() + 60_000, sub: '2' }],
    ['malformed', { token: 5 }],
  ])('drops a stored token that is %s', async (_n, stored) => {
    localStorage.setItem('auth:profile', JSON.stringify(PROFILE))
    localStorage.setItem('auth:token', JSON.stringify(stored))
    const auth = setup()

    await expect(auth().getToken()).rejects.toBeInstanceOf(ReauthRequiredError)
    expect(localStorage.getItem('auth:token')).toBeNull()
  })

  it('persists the token from sign-in and from reauthorize', async () => {
    vi.mocked(google.requestToken)
      .mockResolvedValueOnce({ token: 'a', expiresAt: Date.now() + 60_000 })
      .mockResolvedValueOnce({ token: 'b', expiresAt: Date.now() + 60_000 })
    const auth = setup()
    await act(() => auth().signIn())
    expect(JSON.parse(localStorage.getItem('auth:token')!)).toMatchObject({ token: 'a', sub: '1' })

    await act(() => auth().reauthorize())
    expect(google.requestToken).toHaveBeenLastCalledWith({ prompt: '', hint: PROFILE.email })
    expect(JSON.parse(localStorage.getItem('auth:token')!)).toMatchObject({ token: 'b', sub: '1' })
    expect(await auth().getToken()).toBe('b')
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
    expect(localStorage.getItem('auth:token')).toBeNull()
  })

  it('ignores a corrupt saved profile', () => {
    localStorage.setItem('auth:profile', '{not json')
    const auth = setup()
    expect(auth().profile).toBeNull()
  })
})
