import { useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { isConfigured } from '../auth/google'

export function SignIn() {
  const { signIn } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const configured = isConfigured()

  async function handleSignIn() {
    setBusy(true)
    setError(null)
    try {
      await signIn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm text-center">
        <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="mx-auto h-14 w-14" />
        <h1 className="mt-4 text-xl font-semibold">Clinic Register</h1>
        <p className="mt-2 text-sm text-slate-600">
          Sign in with Google to keep your clinic data synced to your Google Drive. Data is stored on this device
          and works offline.
        </p>

        {configured ? (
          <button className="btn-primary mt-6 w-full" onClick={handleSignIn} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in with Google'}
          </button>
        ) : (
          <p className="mt-6 rounded-md bg-amber-50 p-3 text-left text-sm text-amber-800">
            Google sign-in is not configured. Set <code>VITE_GOOGLE_CLIENT_ID</code> in <code>.env.local</code> and
            restart the dev server.
          </p>
        )}

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      </div>
    </div>
  )
}
