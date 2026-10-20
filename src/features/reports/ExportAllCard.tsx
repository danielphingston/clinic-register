import { useState } from 'react'
import { exportAllData } from './exportAll'

export function ExportAllCard() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run() {
    setBusy(true)
    setError('')
    try {
      await exportAllData()
    } catch (e) {
      setError(`Export failed: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card mt-4 space-y-3" aria-labelledby="export-all-heading">
      <h2 id="export-all-heading" className="font-semibold">
        Export all data to Excel
      </h2>
      <p className="text-sm text-slate-500">
        One workbook with a sheet each for patients, visits, prescriptions, bills, payments, stock and stock moves, for the clinic's own records. For a
        restorable backup use the JSON backup above.
      </p>
      <button type="button" className="btn-ghost border border-slate-300" onClick={run} disabled={busy}>
        {busy ? 'Exporting…' : 'Export all data'}
      </button>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </section>
  )
}
