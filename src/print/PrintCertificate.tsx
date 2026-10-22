import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { db } from '../db/db'
import { getBranding, getSettings } from '../db/repo'
import { formatDate } from '../lib/format'
import { certLayout } from '../features/certificates/certificateRepo'
import { Letterhead, PrintShell } from './PrintShell'

export function PrintCertificate() {
  const { certId = '' } = useParams()
  const data = useLiveQuery(async () => {
    const cert = await db.certificates.get(certId)
    if (!cert) return null
    const [patient, settings, branding] = await Promise.all([db.patients.get(cert.patientId), getSettings(), getBranding()])
    return patient ? { cert, patient, settings, branding } : null
  }, [certId])
  // Never remembered: each time the page opens the doctor opts in again.
  const [withSignature, setWithSignature] = useState(false)
  const [withSeal, setWithSeal] = useState(false)

  if (data === undefined) return null
  if (data === null) return <div className="p-6 text-sm">Certificate not found.</div>
  const { cert, patient, settings, branding } = data
  const cancelled = cert.deleted === 1
  const signature = withSignature && !cancelled ? branding.signature : undefined
  const seal = withSeal && !cancelled ? branding.seal : undefined
  const candidateLine = settings.certTypes[cert.kind].candidateLine
  const layout = certLayout(settings, cert.kind)
  const candidate = <div>Signature of the candidate: ....................................</div>

  const toolbar = (
    <>
      {branding.signature && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={withSignature}
            disabled={cancelled}
            onChange={(e) => setWithSignature(e.target.checked)}
          />
          Add signature
        </label>
      )}
      {branding.seal && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={withSeal} disabled={cancelled} onChange={(e) => setWithSeal(e.target.checked)} />
          Add seal
        </label>
      )}
    </>
  )

  return (
    <PrintShell title={`${cert.certNo} ${patient.name}`} ready={!cancelled} toolbar={toolbar}>
      {/* Own stacking context so the watermark sits under the text but above the page. */}
      <div className="relative z-0">
        {layout.watermark && branding.logo && (
          <div className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center" aria-hidden>
            <img src={branding.logo} alt="" className="max-h-[110mm] w-[70%] object-contain opacity-[0.07] grayscale" />
          </div>
        )}
        <Letterhead style={layout.letterhead} />

        {cancelled && (
          <p role="alert" className="mt-3 rounded bg-red-50 p-2 text-center font-semibold text-red-800">
            This certificate was cancelled and must not be issued.
          </p>
        )}

        <div className="mt-3 flex justify-between text-[9.5pt] text-slate-600">
          <span>
            No. <span className="font-mono">{cert.certNo}</span>
          </span>
          <span>Date: {formatDate(cert.date)}</span>
        </div>

        {candidateLine === 'top' && <div className="mt-6 flex justify-end text-[10pt]">{candidate}</div>}

        <h1 className="mt-8 text-center text-[14pt] font-bold uppercase tracking-wide underline underline-offset-4">
          {cert.title}
        </h1>

        <div className="mt-6 whitespace-pre-line text-justify text-[11.5pt] leading-relaxed">{cert.body}</div>

        {cert.kind === 'medicine' && cert.medicines && cert.medicines.length > 0 && (
          <section className="mt-6 break-inside-avoid">
            <div className="font-serif text-[20pt] leading-none text-brand-800">℞</div>
            <ol className="mt-2 list-decimal space-y-1 pl-8 text-[11pt]">
              {cert.medicines.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ol>
          </section>
        )}

        <footer className="mt-16 flex break-inside-avoid items-end justify-between gap-6 text-[10pt]">
          <div className="space-y-1">
            {candidateLine === 'bottom' && <div className="mb-10">{candidate}</div>}
            {cert.place && <div>Place: {cert.place}</div>}
            <div>Date: {formatDate(cert.date)}</div>
          </div>
          <div className="w-64 text-center">
            {/* Seal under the signature, as when stamped then signed. Multiply
              keeps any leftover paper tone from showing as a box. */}
            <div className="relative h-[28mm]">
              {seal && (
                <img
                  src={seal}
                  alt="Seal"
                  className="absolute bottom-0 left-0 max-h-[28mm] max-w-[34mm] object-contain opacity-90 mix-blend-multiply"
                />
              )}
              {signature && (
                <img
                  src={signature}
                  alt="Signature"
                  className="absolute bottom-1 left-1/2 max-h-[20mm] max-w-[58mm] -translate-x-1/2 object-contain mix-blend-multiply"
                />
              )}
            </div>
            <div className="border-t border-slate-500 pt-1">
              <div className="font-semibold">{settings.doctorName || 'Signature of Medical Officer'}</div>
              {settings.qualification && <div>{settings.qualification}</div>}
              {settings.regNo && <div className="text-slate-600">Reg. No. {settings.regNo}</div>}
            </div>
          </div>
        </footer>
      </div>
    </PrintShell>
  )
}
