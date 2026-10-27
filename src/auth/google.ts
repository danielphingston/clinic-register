// Google Identity Services (token model). No backend: we get a short-lived
// access token in the browser and call Google APIs directly.

const GIS_SRC = 'https://accounts.google.com/gsi/client'

export const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.appdata',
].join(' ')

export interface GoogleProfile {
  sub: string
  email: string
  name: string
  picture?: string
}

export interface AccessToken {
  token: string
  expiresAt: number
}

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string; login_hint?: string }): void
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string
            scope: string
            callback: (resp: TokenResponse) => void
            error_callback?: (err: { type: string; message?: string }) => void
          }): TokenClient
          revoke(token: string, done?: () => void): void
        }
      }
    }
  }
}

let scriptPromise: Promise<void> | null = null

function loadScript(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve()
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = GIS_SRC
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      scriptPromise = null
      reject(new Error('Could not load Google sign-in. Check your internet connection.'))
    }
    document.head.appendChild(s)
  })
  return scriptPromise
}

export function isConfigured(): boolean {
  return Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID)
}

// An ignored or lost popup would otherwise leave the promise pending forever.
const POPUP_TIMEOUT_MS = 2 * 60 * 1000

const GIS_ERRORS: Record<string, string> = {
  popup_closed: 'Sign-in was cancelled.',
}

// Starts loading the GIS script early so later clicks can open the popup
// synchronously (an await before requestAccessToken loses the user gesture and
// Safari blocks the popup). Call on startup; failures (e.g. offline) are fine,
// sign-in then uses the redirect flow.
export function preloadGoogle(): Promise<void> {
  return loadScript()
}

const gisLoaded = () => Boolean(window.google?.accounts?.oauth2)

/**
 * Where Google's popup sign-in is unreliable: Safari on any device, every
 * browser on iPhone/iPad (all WebKit), and home-screen apps. There the popup
 * finishes consent but can't hand the token back (it spins forever after
 * "Continue"), so we use the redirect flow instead.
 */
export function prefersRedirectSignIn(): boolean {
  const ua = navigator.userAgent
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    Boolean(window.matchMedia?.('(display-mode: standalone)').matches)
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) // iPadOS reports as Mac
  const safari = /Safari\//.test(ua) && !/Chrome\/|Chromium\/|CriOS\/|FxiOS\/|Edg\/|EdgiOS\/|OPR\//.test(ua)
  return standalone || ios || safari
}

// ---------- Redirect sign-in ----------

const REDIRECT_STATE_KEY = 'auth:oauth-state'
const redirectUri = () => `${location.origin}${import.meta.env.BASE_URL}`

type TokenRequest = { prompt?: '' | 'consent' | 'select_account'; hint?: string }

// Full-page OAuth implicit flow: leaves the app for accounts.google.com, which
// sends the user back with the token in the URL fragment (see finishRedirectSignIn).
function startRedirectSignIn(opts: TokenRequest) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  const state = crypto.randomUUID()
  localStorage.setItem(REDIRECT_STATE_KEY, JSON.stringify({ state, back: location.pathname + location.search }))
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: SCOPES,
    include_granted_scopes: 'true',
    state,
    ...(opts.hint ? { login_hint: opts.hint } : { prompt: opts.prompt || 'select_account' }),
  })
  location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${q}`)
}

let redirectOutcome: AccessToken | string | undefined

/** Test hook: forget the cached outcome of finishRedirectSignIn. */
export function resetRedirectSignIn() {
  redirectOutcome = undefined
}

/**
 * Completes a redirect sign-in when Google sends the user back with the token
 * in the URL fragment. Returns the token, an error message, or null if this
 * page load isn't a sign-in return. Synchronous, and removes the fragment from
 * the address bar, so call it before the router reads the location. The
 * outcome is remembered for the page's lifetime (React StrictMode runs
 * initialisers twice and the second run must see the same result).
 */
export function finishRedirectSignIn(): AccessToken | string | null {
  if (redirectOutcome !== undefined) return redirectOutcome
  if (!/[#&](access_token|error)=/.test(location.hash)) return null
  const params = new URLSearchParams(location.hash.slice(1))
  let saved: { state: string; back: string } | null = null
  try {
    saved = JSON.parse(localStorage.getItem(REDIRECT_STATE_KEY) ?? 'null')
    localStorage.removeItem(REDIRECT_STATE_KEY)
  } catch {
    // unreadable: treated as a mismatch below
  }
  history.replaceState(null, '', saved?.back ?? location.pathname + location.search)
  const error = params.get('error')
  const token = params.get('access_token')
  if (!saved || params.get('state') !== saved.state) {
    redirectOutcome = "Sign-in didn't match a request from this app. Please try again."
  } else if (error) {
    redirectOutcome = error === 'access_denied' ? 'Google sign-in was cancelled' : `Google sign-in failed: ${error}`
  } else if (!token) {
    redirectOutcome = 'Google sign-in failed'
  } else {
    redirectOutcome = {
      token,
      // Refresh a minute early to avoid using a token mid-expiry.
      expiresAt: Date.now() + (Number(params.get('expires_in')) || 3600) * 1000 - 60_000,
    }
  }
  return redirectOutcome
}

function requestTokenNow(opts: TokenRequest): Promise<AccessToken | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Sign-in timed out. Please try again.')), POPUP_TIMEOUT_MS)
    const settle = <T,>(fn: (v: T) => void) => (v: T) => {
      clearTimeout(timer)
      fn(v)
    }
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
      scope: SCOPES,
      callback: settle((resp: TokenResponse) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(GIS_ERRORS[resp.error ?? ''] || resp.error_description || resp.error || 'Sign-in failed'))
          return
        }
        resolve({
          token: resp.access_token,
          // Refresh a minute early to avoid using a token mid-expiry.
          expiresAt: Date.now() + ((resp.expires_in ?? 3600) - 60) * 1000,
        })
      }),
      error_callback: settle((err: { type: string; message?: string }) => {
        if (err.type === 'popup_failed_to_open') {
          // Blocked anyway (strict browser settings): use the redirect instead.
          startRedirectSignIn(opts)
          resolve(null)
        } else reject(new Error(GIS_ERRORS[err.type] || err.message || `Sign-in ${err.type}`))
      }),
    })
    client.requestAccessToken({ prompt: opts.prompt ?? '', login_hint: opts.hint })
  })
}

/**
 * Asks Google for an access token. Only call from a user gesture, and before
 * any other await: the popup opens synchronously inside the click. Pass
 * `hint` (the known email) with prompt '' to reconnect quietly; the popup
 * closes by itself. Resolves null when the page is navigating to Google (the
 * redirect flow, used on Safari/iOS/home-screen apps, when the popup is
 * blocked, or when the GIS script isn't loaded yet); finishRedirectSignIn
 * completes it on return.
 */
export function requestToken(opts: TokenRequest = {}): Promise<AccessToken | null> {
  if (!import.meta.env.VITE_GOOGLE_CLIENT_ID) return Promise.reject(new Error('VITE_GOOGLE_CLIENT_ID is not set.'))
  if (prefersRedirectSignIn() || !gisLoaded()) {
    startRedirectSignIn(opts)
    return Promise.resolve(null)
  }
  return requestTokenNow(opts)
}

export async function fetchProfile(token: string): Promise<GoogleProfile> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Could not fetch Google profile (${res.status})`)
  return res.json()
}

export async function revokeToken(token: string): Promise<void> {
  await loadScript()
  return new Promise((resolve) => window.google!.accounts.oauth2.revoke(token, resolve))
}
