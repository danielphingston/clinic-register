import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type FormEvent } from 'react'
import { db } from '../../db/db'
import { missingBlobHashes } from '../attachments/attachmentRepo'
import { hasLocalData, syncService } from '../../sync/service'
import { FORGET_WARNING, MIN_PASSPHRASE } from './syncLabels'

// Forgotten passphrase: delete the encrypted Drive backup and upload what
// this device holds in its place, optionally under a new passphrase.
export function ResetBackup({ onCancel, onDone }: { onCancel: () => void; onDone?: () => void }) {
  const [encrypt, setEncrypt] = useState(true)
  const [p1, setP1] = useState('')
  const [p2, setP2] = useState('')
  const [ack, setAck] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const info = useLiveQuery(async () => ({ hasData: await hasLocalData(), missing: (await missingBlobHashes(db)).length }), [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (encrypt) {
      if (p1.length < MIN_PASSPHRASE) return setError(`Use at least ${MIN_PASSPHRASE} characters`)
      if (p1 !== p2) return setError('The passphrases do not match')
    }
    if (!ack) return setError('Tick "I understand" to continue')
    setError('')
    setBusy(true)
    try {
      await syncService.resetRemote(encrypt ? p1 : null)
      onDone?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-md border border-red-200 bg-white p-3 text-sm text-slate-800" data-testid="reset-backup">
      <p className="font-medium text-red-800">Forgot the passphrase? Replace the Drive backup with this device's data</p>
      <p>
        The encrypted backup on Google Drive cannot be opened without its passphrase. You can delete it and upload the data
        on this device instead. Your other devices will then ask for the new passphrase and merge their own data back in.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-red-800">
        <li>Records that exist only in the Drive backup, and on no device you still use, are lost.</li>
        {info && !info.hasData && <li className="font-medium">This device has no clinic data: the new backup will be empty.</li>}
        {info && info.missing > 0 && (
          <li>
            {info.missing} attachment file{info.missing === 1 ? ' was' : 's were'} never downloaded to this device and will be lost.
          </li>
        )}
      </ul>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={encrypt} onChange={(e) => setEncrypt(e.target.checked)} />
        Encrypt the new backup with a new passphrase
      </label>
      {encrypt && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="reset-passphrase">
                New passphrase
              </label>
              <input id="reset-passphrase" type="password" autoComplete="new-password" className="input" value={p1} onChange={(e) => setP1(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="reset-passphrase-2">
                Repeat new passphrase
              </label>
              <input id="reset-passphrase-2" type="password" autoComplete="new-password" className="input" value={p2} onChange={(e) => setP2(e.target.value)} />
            </div>
          </div>
          <p className="rounded-md bg-amber-50 p-2 text-amber-900">{FORGET_WARNING}</p>
        </>
      )}
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I understand the current Drive backup will be deleted
      </label>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn bg-red-600 text-white hover:bg-red-700" disabled={busy}>
          {busy ? 'Replacing…' : 'Delete Drive backup and upload this device'}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  )
}
