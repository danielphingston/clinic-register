import { useEffect, useRef, useState } from 'react'
import { chipLabel, useNow } from './syncLabels'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { timeAgo } from '../../lib/format'
import { syncService, useSyncStatus, type SyncStatus } from '../../sync/service'

function chipTone(s: SyncStatus): string {
  if (s.phase === 'error' || s.phase === 'needs-auth' || s.phase === 'needs-passphrase') return 'bg-red-100 text-red-800'
  if (s.phase === 'offline') return 'bg-amber-100 text-amber-800'
  if (s.phase === 'syncing') return 'bg-brand-50 text-brand-700'
  if (s.phase === 'idle' && s.lastSyncAt) return 'bg-brand-50 text-brand-700'
  return 'bg-slate-100 text-slate-600'
}

export function SyncChip() {
  const status = useSyncStatus()
  const now = useNow()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        data-testid="sync-chip"
        aria-expanded={open}
        className={`max-w-[60vw] truncate rounded-full px-3 py-1 text-xs font-medium ${chipTone(status)}`}
        onClick={() => setOpen((o) => !o)}
      >
        {chipLabel(status, now)}
        {status.blobsPending > 0 && status.phase === 'idle' && ` · ${status.blobsPending} file${status.blobsPending === 1 ? '' : 's'} to download`}
      </button>
      {open && <SyncPanel status={status} now={now} onClose={() => setOpen(false)} />}
    </div>
  )
}

function SyncPanel({ status, now, onClose }: { status: SyncStatus; now: number; onClose: () => void }) {
  const { reauthorize } = useAuth()
  const [authError, setAuthError] = useState('')
  const canSync = status.phase !== 'disabled' && status.phase !== 'syncing' && status.phase !== 'needs-passphrase'

  return (
    <div
      role="dialog"
      aria-label="Sync status"
      className="absolute right-0 top-full z-20 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-lg"
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-slate-500">Last sync</dt>
        <dd>{status.lastSyncAt ? `${timeAgo(status.lastSyncAt, now)} (${new Date(status.lastSyncAt).toLocaleTimeString()})` : 'Never'}</dd>
        <dt className="text-slate-500">Pending</dt>
        <dd>
          {status.pending} change{status.pending === 1 ? '' : 's'}
        </dd>
        {status.blobsPending > 0 && (
          <>
            <dt className="text-slate-500">Files</dt>
            <dd>{status.blobsPending} downloading</dd>
          </>
        )}
      </dl>
      {status.phase === 'disabled' && <p className="mt-2 text-slate-600">Google Drive sync isn't configured for this app.</p>}
      {status.phase === 'error' && (
        <p className="mt-2 break-words text-red-700" data-testid="sync-error-detail">
          {status.errorDetail ?? status.error}
        </p>
      )}
      {status.phase === 'offline' && <p className="mt-2 text-slate-600">Changes are saved on this device and sync when you're back online.</p>}
      {status.phase === 'needs-passphrase' && <p className="mt-2 text-slate-600">Enter the backup passphrase (banner above, or Settings) to resume sync.</p>}
      {authError && <p className="mt-2 text-red-700">{authError}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {status.phase === 'needs-auth' ? (
          <button
            className="btn-primary"
            onClick={() => {
              // Must run inside this click: Google's popup needs a user gesture.
              reauthorize().then(
                () => void syncService.syncNow(),
                (e) => setAuthError(e instanceof Error ? e.message : String(e)),
              )
            }}
          >
            Sign in again to sync
          </button>
        ) : (
          <button className="btn-primary" disabled={!canSync} onClick={() => void syncService.syncNow()}>
            {status.phase === 'error' ? 'Retry' : 'Sync now'}
          </button>
        )}
        <Link to="/settings#sync" className="btn-ghost" onClick={onClose}>
          Settings
        </Link>
      </div>
    </div>
  )
}
