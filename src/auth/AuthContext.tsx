import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { fetchProfile, preloadGoogle, requestToken, revokeToken, type AccessToken, type GoogleProfile } from './google'
import { isMockDrive } from '../sync/drive'
import { AuthContext, ReauthRequiredError } from './authState'

// The profile is kept in localStorage so the app opens offline without
// re-authenticating. The access token is also persisted (with its expiry) so a
// reload doesn't need a popup; the trade-off is acceptable because it is
// short-lived and scoped to drive.appdata only.
const PROFILE_KEY = 'auth:profile'
const TOKEN_KEY = 'auth:token'

interface StoredToken extends AccessToken {
  sub: string
}

function loadToken(profile: GoogleProfile | null): AccessToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY)
    if (!raw) return null
    const t = JSON.parse(raw) as Partial<StoredToken> | null
    if (profile && t && typeof t.token === 'string' && typeof t.expiresAt === 'number' && t.sub === profile.sub && t.expiresAt > Date.now()) {
      return { token: t.token, expiresAt: t.expiresAt }
    }
  } catch {
    // fall through and drop it
  }
  clearToken()
  return null
}

function saveToken(t: AccessToken, sub: string) {
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ ...t, sub } satisfies StoredToken))
  } catch {
    // storage full or blocked: the in-memory token still works
  }
}

function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // ignore
  }
}


function loadProfile(): GoogleProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    return raw ? (JSON.parse(raw) as GoogleProfile) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<GoogleProfile | null>(loadProfile)
  const [storedToken] = useState(() => loadToken(profile))
  const tokenRef = useRef<AccessToken | null>(storedToken)

  // Load the GIS script up front so sign-in clicks can open the popup synchronously.
  useEffect(() => {
    preloadGoogle().catch(() => {})
  }, [])

  const signIn = useCallback(async () => {
    const token = await requestToken({ prompt: 'select_account' })
    const p = await fetchProfile(token.token)
    tokenRef.current = token
    saveToken(token, p.sub)
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p))
    setProfile(p)
  }, [])

  const signOut = useCallback(async () => {
    if (tokenRef.current) await revokeToken(tokenRef.current.token).catch(() => {})
    tokenRef.current = null
    clearToken()
    localStorage.removeItem(PROFILE_KEY)
    setProfile(null)
  }, [])

  const getToken = useCallback(
    async (opts: { forceRefresh?: boolean } = {}) => {
      // E2E only: the Drive API is the local mock server (VITE_DRIVE_API_BASE
      // on localhost), which accepts any token. See isMockDrive().
      if (isMockDrive()) return 'mock-drive-token'
      const t = tokenRef.current
      if (!opts.forceRefresh && t && t.expiresAt > Date.now()) return t.token
      // Background callers have no user gesture, so never open a popup here.
      tokenRef.current = null
      clearToken()
      throw new ReauthRequiredError()
    },
    [],
  )

  const reauthorize = useCallback(async () => {
    if (isMockDrive()) return
    // Call requestToken first, synchronously within the click.
    const fresh = await requestToken({ prompt: '', hint: profile?.email })
    tokenRef.current = fresh
    if (profile) saveToken(fresh, profile.sub)
  }, [profile])

  const value = useMemo(
    () => ({ profile, signIn, signOut, getToken, reauthorize }),
    [profile, signIn, signOut, getToken, reauthorize],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
