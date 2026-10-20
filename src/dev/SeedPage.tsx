import { useState } from 'react'
import { seedDemoData, type SeedResult } from './seed'

// Only routed when import.meta.env.DEV, so production builds drop it.
export default function SeedPage() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SeedResult | null>(null)
  const [error, setError] = useState('')

  async function run() {
    setBusy(true)
    setError('')
    try {
      setResult(await seedDemoData())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-lg space-y-3">
      <h1 className="text-2xl font-semibold">Seed demo data (dev only)</h1>
      <p className="text-sm text-slate-600">Adds about 3 months of visits for 20 patients, with bills, payments, stock and appointments.</p>
      <button className="btn-primary" onClick={run} disabled={busy}>
        {busy ? 'Seeding…' : 'Seed demo data'}
      </button>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {result && <pre data-testid="seed-result" className="card text-xs">{JSON.stringify(result, null, 2)}</pre>}
    </div>
  )
}
