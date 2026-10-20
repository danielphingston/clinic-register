import { useState, type FormEvent } from 'react'
import { syncService } from '../../sync/service'

// Unlocks an encrypted Drive backup on this device.
export function PassphraseForm({ onUnlocked, compact }: { onUnlocked?: () => void; compact?: boolean }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!value) return
    setBusy(true)
    setError('')
    try {
      if (await syncService.unlock(value)) {
        setValue('')
        if (onUnlocked) onUnlocked()
        else void syncService.syncNow()
      } else setError('Wrong passphrase')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className={`flex flex-wrap items-end gap-2 ${compact ? '' : 'mt-3'}`}>
      <div className="min-w-0 flex-1 basis-48">
        <label className="label" htmlFor="unlock-passphrase">
          Backup passphrase
        </label>
        <input
          id="unlock-passphrase"
          type="password"
          autoComplete="current-password"
          className="input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
      <button type="submit" className="btn-primary" disabled={busy || !value}>
        {busy ? 'Checking…' : 'Unlock'}
      </button>
      {error && (
        <p role="alert" className="w-full text-sm text-red-700">
          {error}
        </p>
      )}
    </form>
  )
}
