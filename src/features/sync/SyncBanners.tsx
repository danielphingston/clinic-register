import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { db } from '../../db/db'
import { timeAgo } from '../../lib/format'
import { NOTICES_KEY } from '../../sync/apply'
import { syncService, useSyncStatus } from '../../sync/service'
import type { RenumberNotice } from '../../sync/types'
import { PassphraseForm } from './PassphraseForm'
import { useNow } from './syncLabels'

const NOTICE_LABEL: Record<RenumberNotice['table'], string> = { patients: 'Patient', bills: 'Bill', certificates: 'Certificate' }

// Advisory banners above the page content. None of them block work.
export function SyncBanners() {
  return (
    <div className="no-print mb-4 space-y-2 empty:hidden">
      <LockBanner />
      <AuthBanner />
      <PassphraseBanner />
      <NoticesBanner />
    </div>
  )
}

function LockBanner() {
  const { lock, phase } = useSyncStatus()
  const now = useNow()
  if (!lock) return null
  return (
    <div role="status" data-testid="lock-banner" className="flex flex-wrap items-center gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
      <p className="min-w-0 flex-1 basis-60">
        This clinic's data was last used on <span className="font-medium">{lock.deviceName}</span> {timeAgo(lock.heartbeat, now)}. Sync
        now before making changes?
      </p>
      <button
        className="btn-primary"
        disabled={phase === 'syncing'}
        onClick={() =>
          void syncService.syncNow().then((r) => {
            if (r) syncService.dismissLock()
          })
        }
      >
        {phase === 'syncing' ? 'Syncing…' : 'Sync now'}
      </button>
      <button className="btn-ghost" onClick={() => syncService.dismissLock()}>
        Dismiss
      </button>
    </div>
  )
}

function AuthBanner() {
  const { phase } = useSyncStatus()
  const { reauthorize, authError } = useAuth()
  const [error, setError] = useState(authError ?? '')
  if (phase !== 'needs-auth') return null
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 rounded-md bg-red-50 p-3 text-sm text-red-800">
      <p className="min-w-0 flex-1 basis-60">Google sign-in expired, so changes aren't being backed up to Drive.</p>
      <button
        className="btn-primary"
        onClick={() =>
          reauthorize().then(
            () => void syncService.syncNow(),
            (e) => setError(e instanceof Error ? e.message : String(e)),
          )
        }
      >
        Sign in again to sync
      </button>
      {error && <p className="w-full">{error}</p>}
    </div>
  )
}

function PassphraseBanner() {
  const { phase } = useSyncStatus()
  if (phase !== 'needs-passphrase') return null
  return (
    <div role="status" data-testid="passphrase-banner" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
      <p>Your Drive backup is encrypted. Enter the passphrase to resume sync. This device keeps working meanwhile.</p>
      <PassphraseForm />
    </div>
  )
}

function NoticesBanner() {
  const notices = useLiveQuery(async () => ((await db.kv.get(NOTICES_KEY))?.value as RenumberNotice[] | undefined) ?? [], [])
  if (!notices?.length) return null
  return (
    <div role="status" data-testid="renumber-notice" className="rounded-md bg-sky-50 p-3 text-sm text-sky-900">
      <p className="font-medium">Numbers changed during sync</p>
      <p>Another device had used the same number, so the newer record was renumbered. Nothing was deleted.</p>
      <ul className="mt-1 list-disc pl-5">
        {notices.slice(-5).map((n) => (
          <li key={`${n.id}-${n.at}`}>
            {NOTICE_LABEL[n.table]} {n.from} → <span className="font-medium">{n.to}</span>
          </li>
        ))}
      </ul>
      <button className="btn-ghost mt-1" onClick={() => void db.kv.delete(NOTICES_KEY)}>
        Dismiss
      </button>
    </div>
  )
}
