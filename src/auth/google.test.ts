import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { finishRedirectSignIn, prefersRedirectSignIn, requestToken, resetRedirectSignIn } from './google'

type Cfg = { callback: (r: object) => void; error_callback: (e: { type: string }) => void }

let cfg: Cfg
const requestAccessToken = vi.fn()

beforeEach(() => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'cid')
  requestAccessToken.mockReset()
  window.google = {
    accounts: {
      oauth2: {
        initTokenClient: ((c: Cfg) => {
          cfg = c
          return { requestAccessToken }
        }) as never,
        revoke: vi.fn(),
      },
    },
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  resetRedirectSignIn()
  localStorage.clear()
  history.replaceState(null, '', '/')
  vi.unstubAllEnvs()
  delete window.google
})

describe('requestToken', () => {
  it('requests the token synchronously when GIS is already loaded', () => {
    void requestToken({ prompt: 'select_account' })
    expect(requestAccessToken).toHaveBeenCalledWith({ prompt: 'select_account', login_hint: undefined })
  })

  it('maps GIS popup errors to friendly messages', async () => {
    const closed = requestToken()
    cfg.error_callback({ type: 'popup_closed' })
    await expect(closed).rejects.toThrow('Sign-in was cancelled.')
  })

  it('rejects when the popup is ignored for two minutes', async () => {
    vi.useFakeTimers()
    const p = requestToken()
    const assertion = expect(p).rejects.toThrow(/timed out/)
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
    await assertion
  })
})

const assign = vi.fn()
const UA = {
  chrome: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1',
  firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
}

function stubNavigator(userAgent: string, extra: object = {}) {
  vi.stubGlobal('navigator', { userAgent, maxTouchPoints: 0, ...extra })
}

function stubLocation() {
  assign.mockReset()
  vi.stubGlobal('location', { origin: 'https://doc.github.io', pathname: '/clinic-register/patients', search: '?q=1', hash: '', assign })
}

const redirectParams = () => new URL(assign.mock.calls[0][0] as string).searchParams

describe('prefersRedirectSignIn', () => {
  it('is false for Chrome and Firefox', () => {
    stubNavigator(UA.chrome)
    expect(prefersRedirectSignIn()).toBe(false)
    stubNavigator(UA.firefox)
    expect(prefersRedirectSignIn()).toBe(false)
  })

  it.each([
    ['desktop Safari', UA.safari, {}],
    ['Chrome on iPhone', UA.iphoneChrome, {}],
    ['iPadOS (reports as a Mac)', UA.safari.replace('Version/17.0 ', ''), { maxTouchPoints: 5 }],
    ['an iOS home-screen app', UA.chrome, { standalone: true }],
  ])('is true for %s', (_n, ua, extra) => {
    stubNavigator(ua, extra)
    expect(prefersRedirectSignIn()).toBe(true)
  })

  it('is true for an installed (display-mode: standalone) app', () => {
    stubNavigator(UA.chrome)
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(display-mode: standalone)' }))
    expect(prefersRedirectSignIn()).toBe(true)
  })
})

describe('redirect sign-in', () => {
  beforeEach(() => {
    stubLocation()
    stubNavigator(UA.chrome)
  })

  it('uses the redirect on Safari, with an account chooser for a first sign-in', async () => {
    stubNavigator(UA.safari)
    await expect(requestToken({ prompt: 'select_account' })).resolves.toBeNull()
    expect(requestAccessToken).not.toHaveBeenCalled()
    const url = new URL(assign.mock.calls[0][0] as string)
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    const q = url.searchParams
    expect(q.get('client_id')).toBe('cid')
    expect(q.get('response_type')).toBe('token')
    expect(q.get('redirect_uri')).toBe('https://doc.github.io/')
    expect(q.get('include_granted_scopes')).toBe('true')
    expect(q.get('scope')).toContain('drive.appdata')
    expect(q.get('prompt')).toBe('select_account')
    expect(q.get('login_hint')).toBeNull()
    expect(JSON.parse(localStorage.getItem('auth:oauth-state')!)).toEqual({ state: q.get('state'), back: '/clinic-register/patients?q=1' })
  })

  it('passes the known email as login_hint instead of a prompt', async () => {
    stubNavigator(UA.safari)
    await requestToken({ prompt: '', hint: 'doc@example.com' })
    expect(redirectParams().get('login_hint')).toBe('doc@example.com')
    expect(redirectParams().get('prompt')).toBeNull()
  })

  it('uses the redirect when Google sign-in has not loaded (offline at start-up)', async () => {
    delete window.google
    await expect(requestToken({ prompt: '', hint: 'a@b.c' })).resolves.toBeNull()
    expect(assign).toHaveBeenCalledOnce()
  })

  it('falls back to the redirect when the popup fails to open', async () => {
    const p = requestToken({ prompt: '', hint: 'a@b.c' })
    expect(assign).not.toHaveBeenCalled()
    cfg.error_callback({ type: 'popup_failed_to_open' })
    await expect(p).resolves.toBeNull()
    expect(redirectParams().get('login_hint')).toBe('a@b.c')
  })
})

describe('finishRedirectSignIn', () => {
  const returnTo = (hash: string, saved: object | null = { state: 's1', back: '/clinic-register/patients?q=1' }) => {
    if (saved) localStorage.setItem('auth:oauth-state', JSON.stringify(saved))
    history.replaceState(null, '', `/clinic-register/${hash}`)
  }

  it('does nothing on an ordinary page load', () => {
    history.replaceState(null, '', '/clinic-register/#section')
    expect(finishRedirectSignIn()).toBeNull()
    expect(location.hash).toBe('#section')
  })

  it('returns the token, drops the fragment and goes back to the saved page', () => {
    returnTo('#access_token=tok&expires_in=3600&scope=openid&state=s1&token_type=Bearer')
    const r = finishRedirectSignIn()
    expect(r).toMatchObject({ token: 'tok' })
    expect((r as { expiresAt: number }).expiresAt).toBeGreaterThan(Date.now() + 3_000_000)
    expect(location.hash).toBe('')
    expect(location.pathname + location.search).toBe('/clinic-register/patients?q=1')
    expect(localStorage.getItem('auth:oauth-state')).toBeNull()
    expect(finishRedirectSignIn()).toBe(r) // second call (StrictMode) sees the same outcome
  })

  it('rejects a state mismatch or a missing saved state, and still strips the fragment', () => {
    returnTo('#access_token=tok&state=other')
    expect(finishRedirectSignIn()).toMatch(/didn't match/)
    expect(location.hash).toBe('')

    resetRedirectSignIn()
    returnTo('#access_token=tok&state=s1', null)
    expect(finishRedirectSignIn()).toMatch(/didn't match/)
  })

  it('maps access_denied to a cancelled message and other errors to a failure', () => {
    returnTo('#error=access_denied&state=s1')
    expect(finishRedirectSignIn()).toBe('Google sign-in was cancelled')

    resetRedirectSignIn()
    returnTo('#error=server_error&state=s1')
    expect(finishRedirectSignIn()).toBe('Google sign-in failed: server_error')
  })
})
