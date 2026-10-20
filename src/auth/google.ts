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

// Opens the Google popup (or silently refreshes when `prompt` is '' and the
// user has already consented). Must be called from a user gesture the first time.
export async function requestToken(opts: { prompt?: '' | 'consent' | 'select_account'; hint?: string } = {}): Promise<AccessToken> {
  await loadScript()
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  if (!clientId) throw new Error('VITE_GOOGLE_CLIENT_ID is not set.')

  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error_description || resp.error || 'Sign-in failed'))
          return
        }
        resolve({
          token: resp.access_token,
          // Refresh a minute early to avoid using a token mid-expiry.
          expiresAt: Date.now() + ((resp.expires_in ?? 3600) - 60) * 1000,
        })
      },
      error_callback: (err) => reject(new Error(err.message || `Sign-in ${err.type}`)),
    })
    client.requestAccessToken({ prompt: opts.prompt ?? '', login_hint: opts.hint })
  })
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
