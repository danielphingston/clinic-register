import { useEffect, useState } from 'react'
import { timeAgo } from '../../lib/format'
import type { SyncStatus } from '../../sync/service'

// Re-render every 30 s so "2 min ago" stays current.
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

export function chipLabel(s: SyncStatus, now: number): string {
  const pending = s.pending > 0 ? `${s.pending} change${s.pending === 1 ? '' : 's'} pending` : ''
  switch (s.phase) {
    case 'disabled':
      return 'Sync not set up'
    case 'syncing':
      return 'Syncing…'
    case 'offline':
      return pending ? `Offline · ${pending}` : 'Offline'
    case 'needs-auth':
      return 'Sign in to sync'
    case 'needs-passphrase':
      return 'Sync paused · passphrase needed'
    case 'error':
      return `Sync error: ${s.error ?? 'unknown'}`
    case 'idle':
      if (!s.lastSyncAt) return pending ? `Not synced · ${pending}` : 'Not synced yet'
      return `Synced ${timeAgo(s.lastSyncAt, now)}${s.pending > 0 ? ` · ${s.pending} pending` : ''}`
  }
}

