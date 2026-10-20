import { useLiveQuery } from 'dexie-react-hooks'
import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { db } from '../db/db'
import { ageSex } from '../lib/age'
import { formatDate, todayISO } from '../lib/format'
import { Letterhead, PrintShell } from './PrintShell'
import { todaysToken } from '../features/appointments/appointmentRepo'

export function PrintOpSlip() {
  const { patientId = '' } = useParams()
  const patient = useLiveQuery(async () => (await db.patients.get(patientId)) ?? null, [patientId])
  const token = useLiveQuery(async () => todaysToken(patientId).then((t) => t ?? null), [patientId])
  const [qr, setQr] = useState<string | null>(null) // '' = generation failed
  const today = todayISO()
  const opNo = patient?.opNo

  useEffect(() => {
    if (!opNo) return
    let cancelled = false
    QRCode.toDataURL(opNo, { margin: 1, width: 240, errorCorrectionLevel: 'M' })
      .catch(() => '')
      .then((url) => {
        if (!cancelled) setQr(url)
      })
    return () => {
      cancelled = true
    }
  }, [opNo])

  if (patient === undefined) return null
  if (!patient || patient.deleted) return <div className="p-6 text-sm">Patient not found.</div>

  const rows: [string, string][] = [
    ['Name', patient.name],
    ['Age / Sex', ageSex(patient, today)],
    ['Phone', patient.phone ?? ''],
    ['Date', formatDate(today)],
  ]

  return (
    <PrintShell title={`OP slip ${patient.opNo}`} ready={qr !== null && token !== undefined}>
      <Letterhead />
      <section className="mt-6 flex items-start justify-between gap-6 rounded-md border-2 border-slate-800 p-5">
        <div className="min-w-0 flex-1">
          <div className="text-[9pt] font-semibold uppercase tracking-wide text-slate-600">OP Slip</div>
          <div className="mt-1 font-mono text-[20pt] font-bold" data-testid="op-no">
            {patient.opNo}
          </div>
          <dl className="mt-3 grid grid-cols-[6.5rem_1fr] gap-y-1.5 text-[11pt]">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-slate-500">{k}</dt>
                <dd className="font-medium">{v || '—'}</dd>
              </div>
            ))}
          </dl>
        </div>
        {token != null && (
          <div className="shrink-0 rounded-md border-2 border-slate-800 px-4 py-2 text-center" data-testid="op-token">
            <div className="text-[9pt] font-semibold uppercase tracking-wide text-slate-600">Token</div>
            <div className="text-[40pt] font-bold leading-none">{token}</div>
          </div>
        )}
        {qr && <img src={qr} alt={`QR code for ${patient.opNo}`} className="h-[38mm] w-[38mm]" />}
      </section>
      <p className="mt-3 text-[9pt] text-slate-500">Please bring this slip on every visit.</p>
    </PrintShell>
  )
}
