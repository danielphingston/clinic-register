import { createContext } from 'react'
import type { GoogleProfile } from './google'

export interface AuthState {
  profile: GoogleProfile | null
  // Why the redirect sign-in we just came back from failed (or was cancelled).
  authError: string | null
  signIn(): Promise<void>
  signOut(): Promise<void>
  // Returns a valid access token, or throws ReauthRequiredError (never opens a
  // popup); then call reauthorize() from a click. signIn() and reauthorize()
  // never resolve when they send the page to Google (redirect sign-in).
  getToken(opts?: { forceRefresh?: boolean }): Promise<string>
  reauthorize(): Promise<void>
}

// Thrown by getToken() when there is no valid token. Background callers must
// not open a popup, so the user has to reconnect from a click (reauthorize()).
export class ReauthRequiredError extends Error {
  readonly code = 'reauth'
  constructor() {
    super('Google sign-in expired. Sign in again to sync.')
    this.name = 'ReauthRequiredError'
  }
}

export const AuthContext = createContext<AuthState | null>(null)
