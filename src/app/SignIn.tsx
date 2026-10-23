import { useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { isConfigured } from '../auth/google'

const SOURCE_URL = 'https://github.com/danielphingston/clinic-register'

const FEATURES = [
  ['Patients and visits', 'OP numbers, case notes, prescriptions and follow-ups.'],
  ['Appointments', "Day, week and month calendar with today's queue."],
  ['Billing and stock', 'Bills, part payments, dues and medicine stock.'],
  ['Reports', 'OP register, collections and stock usage, printable and exportable.'],
] as const

// Signed-out page. It's also the public face of the site, so it says plainly
// what the app is, where the data goes and where the code lives before
// offering sign-in, rather than being a bare login prompt.
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
    <div className="min-h-screen">
      <main className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
        <header className="flex items-center gap-3">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="h-12 w-12" />
          <div>
            <h1 className="text-2xl font-semibold">Clinic Register</h1>
            <p className="text-sm text-slate-600">An open-source outpatient register for a small clinic</p>
          </div>
        </header>

        <p className="mt-6 text-slate-700">
          Clinic Register is a free, personal project built for one homeopathy clinic. It keeps the clinic's patient
          register, visits, prescriptions, appointments, billing and medicine stock. It runs in the browser, works
          offline and can be installed as an app.
        </p>

        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {FEATURES.map(([title, text]) => (
            <li key={title} className="card">
              <p className="font-medium">{title}</p>
              <p className="mt-1 text-sm text-slate-600">{text}</p>
            </li>
          ))}
        </ul>

        <section className="card mt-6" aria-labelledby="signin-heading">
          <h2 id="signin-heading" className="font-semibold">
            For the clinic's staff
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Sign in with the clinic's Google account to open the register. If you're not from the clinic, there's
            nothing here for you to sign in to.
          </p>

          {configured ? (
            <button
              type="button"
              className="mt-4 inline-flex items-center gap-3 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-50 disabled:opacity-50"
              onClick={handleSignIn}
              disabled={busy}
            >
              <GoogleG />
              {busy ? 'Signing in…' : 'Sign in with Google'}
            </button>
          ) : (
            <p className="mt-4 rounded-md bg-amber-50 p-3 text-left text-sm text-amber-800">
              Google sign-in is not configured. Set <code>VITE_GOOGLE_CLIENT_ID</code> in <code>.env.local</code> and
              restart the dev server.
            </p>
          )}

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </section>

        <section className="mt-6 text-sm text-slate-600" aria-labelledby="privacy-heading">
          <h2 id="privacy-heading" className="font-semibold text-slate-800">
            Your data and privacy
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              Sign-in happens on Google's own page (accounts.google.com). This app never sees your Google password.
            </li>
            <li>
              It asks only for your name, email address and a private app folder in your own Google Drive, used to
              sync between the clinic's devices.
            </li>
            <li>There is no server: records stay in this browser and in your Drive, optionally encrypted.</li>
            <li>No ads, no tracking, nothing to download or install.</li>
          </ul>
        </section>

        <footer className="mt-10 border-t border-slate-200 pt-4 text-sm text-slate-500">
          <a className="text-brand-700 underline" href={SOURCE_URL}>
            Source code on GitHub
          </a>
          <span aria-hidden="true"> · </span>
          Not affiliated with Google.
        </footer>
      </main>
    </div>
  )
}

// Google's "G" mark, which their sign-in branding guidelines ask for on the button.
function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}
