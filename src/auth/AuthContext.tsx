import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { fetchProfile, requestToken, revokeToken, type AccessToken, type GoogleProfile } from './google'
import { isMockDrive } from '../sync/drive'
import { AuthContext } from './authState'

// The profile is kept in localStorage so the app opens offline without
// re-authenticating. The access token lives in memory only; it is needed
// solely for Drive sync and is refreshed on demand.
const PROFILE_KEY = 'auth:profile'


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
  const tokenRef = useRef<AccessToken | null>(null)

  const signIn = useCallback(async () => {
    const token = await requestToken({ prompt: 'select_account' })
    const p = await fetchProfile(token.token)
    tokenRef.current = token
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p))
    setProfile(p)
  }, [])

  const signOut = useCallback(async () => {
    if (tokenRef.current) await revokeToken(tokenRef.current.token).catch(() => {})
    tokenRef.current = null
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
      const fresh = await requestToken({ prompt: '', hint: profile?.email })
      tokenRef.current = fresh
      return fresh.token
    },
    [profile?.email],
  )

  const reauthorize = useCallback(async () => {
    if (isMockDrive()) return
    tokenRef.current = await requestToken({ prompt: '', hint: profile?.email })
  }, [profile?.email])

  const value = useMemo(
    () => ({ profile, signIn, signOut, getToken, reauthorize }),
    [profile, signIn, signOut, getToken, reauthorize],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
