import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '../../auth/useAuth'
import { getKV, setKV } from '../../db/repo'
import { seedRemedies } from '../remedies/remedyRepo'
import { AuthRequiredError, hasLocalData, OWNER_KEY, syncService, useSyncStatus } from '../../sync/service'
import { PassphraseForm } from './PassphraseForm'

type Stage = 'checking' | 'mismatch' | 'restore' | 'ready'

// Runs before the app proper after sign-in:
// 1. Local data that belongs to another Google account is never mixed in.
// 2. An empty device restores from Drive first (so seeding can't race it).
// 3. Then remedies are seeded and background sync starts.
export function SyncGate({ children }: { children: ReactNode }) {
  const { profile, getToken } = useAuth()
  const sub = profile!.sub
  const [stage, setStage] = useState<Stage>('checking')

  useEffect(() => {
    let cancelled = false
    syncService.setAuth({ sub, getToken })
    ;(async () => {
      const owner = await getKV<string>(OWNER_KEY)
      const hasData = await hasLocalData()
      if (cancelled) return
      if (owner && owner !== sub && hasData) return setStage('mismatch')
      if (owner !== sub) await setKV(OWNER_KEY, sub)
      if (!hasData && syncService.enabled && navigator.onLine) return setStage('restore')
      setStage('ready')
    })().catch((e) => {
      console.error('Sync check failed', e)
      if (!cancelled) setStage('ready')
    })
    return () => {
      cancelled = true
    }
  }, [sub, getToken])

  useEffect(() => {
    if (stage !== 'ready') return
    seedRemedies().catch((e) => console.error('Remedy seed failed', e))
    void syncService.start()
    return () => syncService.stop()
  }, [stage])

  if (stage === 'checking') return <FullPage><p className="text-sm text-slate-500">Loading…</p></FullPage>
  if (stage === 'mismatch') return <AccountMismatch onErased={() => setStage(syncService.enabled ? 'restore' : 'ready')} />
  if (stage === 'restore') return <RestoreScreen onDone={() => setStage('ready')} />
  return <>{children}</>
}

function FullPage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-md">{children}</div>
    </div>
  )
}

type RestoreState = 'checking' | 'restoring' | 'passphrase' | 'auth' | 'error'

export function RestoreScreen({ onDone }: { onDone: () => void }) {
  const { reauthorize } = useAuth()
  const status = useSyncStatus()
  const [state, setState] = useState<RestoreState>('checking')
  const [error, setError] = useState('')
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  const run = useCallback(async () => {
    const onDone = () => doneRef.current()
    setState('checking')
    setError('')
    try {
      const info = await syncService.remoteInfo()
      if (!info.exists) return onDone()
      setState('restoring')
      const r = await syncService.syncNow()
      if (r) return onDone()
      const st = syncService.getSnapshot()
      if (st.phase === 'needs-passphrase') setState('passphrase')
      else if (st.phase === 'needs-auth') setState('auth')
      else {
        setError(st.errorDetail ?? st.error ?? 'Unknown error')
        setState('error')
      }
    } catch (e) {
      if (e instanceof AuthRequiredError) return setState('auth')
      setError(e instanceof Error ? e.message : String(e))
      setState('error')
    }
  }, [])

  useEffect(() => {
    void run()
  }, [run])

  const p = status.progress
  return (
    <FullPage>
      <div data-testid="restore-screen">
        <h1 className="text-lg font-semibold">Restoring your clinic data…</h1>
        {state === 'checking' && <p className="mt-2 text-sm text-slate-600">Looking for your data on Google Drive…</p>}
        {state === 'restoring' && (
          <>
            <p className="mt-2 text-sm text-slate-600" data-testid="restore-progress">
              {p?.stage === 'tables' && p.total ? `Downloading records: ${p.done} of ${p.total} sets` : 'Downloading from Google Drive…'}
            </p>
            <div className="mt-3 h-2 overflow-hidden rounded bg-slate-100">
              <div
                className="h-full bg-brand-600 transition-all"
                style={{ width: `${p?.stage === 'tables' && p.total ? Math.round((p.done / p.total) * 100) : 10}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-slate-500">Attachment files download in the background afterwards.</p>
          </>
        )}
        {state === 'passphrase' && (
          <>
            <p className="mt-2 text-sm text-slate-600">
              Your Drive backup is encrypted. Enter the passphrase that was set on your other device.
            </p>
            <PassphraseForm onUnlocked={() => void run()} />
          </>
        )}
        {state === 'auth' && (
          <>
            <p className="mt-2 text-sm text-slate-600">Google needs you to sign in again before your data can be restored.</p>
            <button className="btn-primary mt-3" onClick={() => reauthorize().then(run, (e) => setError(String(e?.message ?? e)))}>
              Sign in again to sync
            </button>
          </>
        )}
        {state === 'error' && (
          <p role="alert" className="mt-2 text-sm text-red-700">
            Could not restore: {error}
          </p>
        )}
        {(state === 'error' || state === 'passphrase' || state === 'auth') && (
          <div className="mt-4 flex flex-wrap gap-2">
            {state === 'error' && (
              <button className="btn-primary" onClick={() => void run()}>
                Retry
              </button>
            )}
            <button className="btn-ghost border border-slate-300" onClick={onDone}>
              Continue without restoring
            </button>
          </div>
        )}
      </div>
    </FullPage>
  )
}

function AccountMismatch({ onErased }: { onErased: () => void }) {
  const { profile, signOut } = useAuth()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  async function erase() {
    setBusy(true)
    await syncService.eraseLocal(profile!.sub)
    onErased()
  }

  return (
    <FullPage>
      <div data-testid="account-mismatch">
        <h1 className="text-lg font-semibold">This device has another account's data</h1>
        <p className="mt-2 text-sm text-slate-600">
          The clinic data on this device was synced with a different Google account than{' '}
          <span className="font-medium">{profile?.email}</span>. Data from two accounts is never mixed.
        </p>
        {!confirm ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn-ghost border border-red-300 text-red-700" onClick={() => setConfirm(true)}>
              Erase local data and restore from this account
            </button>
            <button className="btn-primary" onClick={() => void signOut()}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800">
            <p>
              Everything stored on this device will be deleted. Data that was synced to the other account's Drive is
              not affected.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn bg-red-600 text-white hover:bg-red-700" disabled={busy} onClick={() => void erase()}>
                {busy ? 'Erasing…' : 'Yes, erase this device'}
              </button>
              <button className="btn-ghost" onClick={() => setConfirm(false)}>
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </FullPage>
  )
}
