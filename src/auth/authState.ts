import { createContext } from 'react'
import type { GoogleProfile } from './google'

export interface AuthState {
  profile: GoogleProfile | null
  signIn(): Promise<void>
  signOut(): Promise<void>
  // Returns a valid access token, refreshing silently if possible. A silent
  // refresh can fail outside a user gesture; then call reauthorize() from a click.
  getToken(opts?: { forceRefresh?: boolean }): Promise<string>
  reauthorize(): Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)
