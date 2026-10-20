import { useLiveQuery } from 'dexie-react-hooks'
import { formatBytes } from '../../lib/format'
import { storageUsage } from './attachmentRepo'

export function StorageCard() {
  const usage = useLiveQuery(storageUsage)
  return (
    <div className="card mt-4 space-y-2" data-testid="storage-card">
      <h2 className="font-semibold">Storage</h2>
      {usage && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-slate-500">Attachments</dt>
          <dd data-testid="storage-attachments">
            {usage.count} file{usage.count === 1 ? '' : 's'} · {formatBytes(usage.totalSize)}
            {usage.originalSize > usage.totalSize && (
              <span className="text-slate-500"> (from {formatBytes(usage.originalSize)} before compression)</span>
            )}
          </dd>
          <dt className="text-slate-500">This browser</dt>
          <dd data-testid="storage-browser">
            {usage.usage !== undefined && usage.quota
              ? `${formatBytes(usage.usage)} used of ${formatBytes(usage.quota)} available (${((usage.usage / usage.quota) * 100).toFixed(1)}%)`
              : 'Not reported by this browser'}
          </dd>
        </dl>
      )}
    </div>
  )
}
