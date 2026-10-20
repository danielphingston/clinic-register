import { useState, type FormEvent } from 'react'
import { useAuth } from '../../auth/useAuth'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { timeAgo, toISODate } from '../../lib/format'
import { SYNC_KEY_KV } from '../../sync/engine'
import { exportBackup, importBackup } from '../../sync/backup'
import { getDeviceName, setDeviceName } from '../../sync/device'
import { syncService, useSyncStatus } from '../../sync/service'
import { chipLabel, useNow } from './syncLabels'

export const MIN_PASSPHRASE = 8
export const FORGET_WARNING = 'If you forget this passphrase, your Drive backup cannot be recovered. Data on this device is not affected.'

export function SyncSettings() {
  const { profile } = useAuth()
  const status = useSyncStatus()
  const now = useNow()

  return (
    <div className="card mt-4 space-y-4" id="sync" data-testid="sync-settings">
      <h2 className="font-semibold">Sync &amp; Security</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-slate-500">Account</dt>
        <dd className="min-w-0 break-words">{profile?.email}</dd>
        <dt className="text-slate-500">Status</dt>
        <dd data-testid="sync-settings-status">{chipLabel(status, now)}</dd>
        <dt className="text-slate-500">Last sync</dt>
        <dd>{status.lastSyncAt ? `${new Date(status.lastSyncAt).toLocaleString()} (${timeAgo(status.lastSyncAt, now)})` : 'Never'}</dd>
        <dt className="text-slate-500">Pending changes</dt>
        <dd data-testid="sync-pending">{status.pending}</dd>
      </dl>
      {status.phase === 'error' && status.errorDetail && <p className="break-words text-sm text-red-700">{status.errorDetail}</p>}
      <button
        className="btn-primary"
        disabled={status.phase === 'disabled' || status.phase === 'syncing'}
        onClick={() => void syncService.syncNow()}
      >
        {status.phase === 'syncing' ? 'Syncing…' : 'Sync now'}
      </button>

      <DeviceName />
      <Encryption />
      <Backup />
    </div>
  )
}

function DeviceName() {
  const [name, setName] = useState(getDeviceName)
  const [saved, setSaved] = useState(false)
  return (
    <form
      className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4"
      onSubmit={(e) => {
        e.preventDefault()
        setDeviceName(name)
        setName(getDeviceName())
        setSaved(true)
      }}
    >
      <div className="min-w-0 flex-1 basis-48">
        <label className="label" htmlFor="deviceName">
          This device's name
        </label>
        <input
          id="deviceName"
          className="input"
          value={name}
          maxLength={60}
          onChange={(e) => {
            setName(e.target.value)
            setSaved(false)
          }}
        />
        <p className="mt-1 text-xs text-slate-500">Shown to your other devices ("last used on …").</p>
      </div>
      <button type="submit" className="btn-ghost border border-slate-300">
        Save name
      </button>
      {saved && <span className="text-sm text-brand-700">Saved</span>}
    </form>
  )
}

type EncMode = null | 'enable' | 'change' | 'disable'

function Encryption() {
  const status = useSyncStatus()
  const [mode, setMode] = useState<EncMode>(null)
  const [message, setMessage] = useState('')
  // Live, so the button appears as soon as encryption stores the key.
  const hasKey = useLiveQuery(async () => !!(await db.kv.get(SYNC_KEY_KV)), [])

  const unavailable = status.phase === 'disabled'
  const unknown = status.encrypted === undefined
  const busy = status.phase === 'syncing'

  return (
    <div className="space-y-2 border-t border-slate-100 pt-4" data-testid="encryption-section">
      <h3 className="font-medium">Encrypt Drive backup</h3>
      <p className="text-sm text-slate-500">
        Encrypts the copy on Google Drive with a passphrase only you know. Data on this device is not encrypted.
      </p>
      {unavailable ? (
        <p className="text-sm text-slate-500">Available once Drive sync is set up.</p>
      ) : unknown ? (
        <p className="text-sm text-slate-500">Sync once to manage encryption.</p>
      ) : (
        <p className="text-sm" data-testid="encryption-state">
          Drive backup is <span className="font-medium">{status.encrypted ? 'encrypted' : 'not encrypted'}</span>.
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-brand-700">
          {message}
        </p>
      )}
      {!unavailable && !unknown && !mode && (
        <div className="flex flex-wrap gap-2">
          {!status.encrypted ? (
            <button className="btn-ghost border border-slate-300" disabled={busy} onClick={() => setMode('enable')}>
              Turn on encryption
            </button>
          ) : (
            <>
              <button className="btn-ghost border border-slate-300" disabled={busy || status.phase === 'needs-passphrase'} onClick={() => setMode('change')}>
                Change passphrase
              </button>
              <button className="btn-ghost border border-slate-300" disabled={busy || status.phase === 'needs-passphrase'} onClick={() => setMode('disable')}>
                Turn off encryption
              </button>
              {hasKey && (
                <button
                  className="btn-ghost border border-slate-300"
                  onClick={() => {
                    void syncService.forgetKey().then(() => {
                      setMessage('The key was removed from this device. Enter the passphrase to sync again.')
                    })
                  }}
                >
                  Forget key on this device
                </button>
              )}
            </>
          )}
        </div>
      )}
      {(mode === 'enable' || mode === 'change') && (
        <PassphraseSetup
          mode={mode}
          onCancel={() => setMode(null)}
          onDone={() => {
            setMode(null)
            setMessage(mode === 'enable' ? 'Encryption is on. Drive files were re-uploaded encrypted.' : 'Passphrase changed.')
          }}
        />
      )}
      {mode === 'disable' && (
        <DisableEncryption
          onCancel={() => setMode(null)}
          onDone={() => {
            setMode(null)
            setMessage('Encryption is off. Drive files were re-uploaded without encryption.')
          }}
        />
      )}
    </div>
  )
}

function PassphraseSetup({ mode, onCancel, onDone }: { mode: 'enable' | 'change'; onCancel: () => void; onDone: () => void }) {
  const [p1, setP1] = useState('')
  const [p2, setP2] = useState('')
  const [ack, setAck] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (p1.length < MIN_PASSPHRASE) return setError(`Use at least ${MIN_PASSPHRASE} characters`)
    if (p1 !== p2) return setError('The passphrases do not match')
    if (!ack) return setError('Tick "I understand" to continue')
    setError('')
    setBusy(true)
    try {
      await syncService.setEncryption(p1)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border border-slate-200 p-3" data-testid="passphrase-setup">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="new-passphrase">
            {mode === 'change' ? 'New passphrase' : 'Passphrase'}
          </label>
          <input id="new-passphrase" type="password" autoComplete="new-password" className="input" value={p1} onChange={(e) => setP1(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="confirm-passphrase">
            Repeat passphrase
          </label>
          <input id="confirm-passphrase" type="password" autoComplete="new-password" className="input" value={p2} onChange={(e) => setP2(e.target.value)} />
        </div>
      </div>
      <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-900">{FORGET_WARNING}</p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I understand
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Re-uploading…' : mode === 'enable' ? 'Turn on encryption' : 'Change passphrase'}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function DisableEncryption({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-3 text-sm">
      <p>All Drive files will be re-uploaded without encryption. Other devices keep working without the passphrase.</p>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          className="btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await syncService.setEncryption(null)
              onDone()
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e))
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? 'Re-uploading…' : 'Yes, turn off encryption'}
        </button>
        <button className="btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function saveFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function Backup() {
  const [withFiles, setWithFiles] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function doExport() {
    setBusy(true)
    setError('')
    try {
      const r = await exportBackup({ includeAttachments: withFiles })
      // Local date and time (toISOString would stamp the UTC date before 05:30 IST).
      const now = new Date()
      const stamp = `${toISODate(now)}-${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`
      saveFile(`clinic-register-backup-${stamp}.json`, r.json)
      setMessage(
        `Backup saved: ${r.records} records${withFiles ? `, ${r.files} file${r.files === 1 ? '' : 's'}` : ''}.` +
          (r.missingFiles ? ` ${r.missingFiles} attachment file(s) aren't on this device yet and were left out.` : ''),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function doImport(file: File) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const r = await importBackup(await file.text())
      setMessage(
        `Imported: ${r.written} record${r.written === 1 ? '' : 's'} added or updated` +
          (r.files ? `, ${r.files} file${r.files === 1 ? '' : 's'}` : '') +
          (r.renumbered.length ? `, ${r.renumbered.length} renumbered` : '') +
          '. Existing newer records were kept.',
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 border-t border-slate-100 pt-4" data-testid="backup-section">
      <h3 className="font-medium">Backup file</h3>
      <p className="text-sm text-slate-500">
        A safety net that works without Drive. Importing merges with the data here (newer records win); nothing is overwritten
        wholesale.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={withFiles} onChange={(e) => setWithFiles(e.target.checked)} />
        Include attachments (larger file)
      </label>
      <div className="flex flex-wrap gap-2">
        <button className="btn-ghost border border-slate-300" disabled={busy} onClick={() => void doExport()}>
          Download a backup file (.json)
        </button>
        <label className={`btn-ghost cursor-pointer border border-slate-300 ${busy ? 'pointer-events-none opacity-50' : ''}`}>
          Import backup
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label="Import backup file"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void doImport(f)
            }}
          />
        </label>
      </div>
      {message && (
        <p role="status" className="text-sm text-brand-700" data-testid="backup-message">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}
