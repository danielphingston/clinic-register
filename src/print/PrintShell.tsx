import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSettings } from '../db/repo'

export function PrintShell({ title, children, ready, landscape = false }: { title: string; children: ReactNode; ready: boolean; landscape?: boolean }) {
  const navigate = useNavigate()

  useEffect(() => {
    const prev = document.title
    document.title = title
    return () => {
      document.title = prev
    }
  }, [title])

  return (
    <main className="min-h-screen bg-slate-100 print:bg-white">
      <div className="no-print sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <button className="btn-ghost border border-slate-300" onClick={() => navigate(-1)}>
          ← Back
        </button>
        <button className="btn-primary" disabled={!ready} onClick={() => window.print()}>
          Print
        </button>
      </div>
      {/* Focusable so keyboard users can scroll the A4 page on narrow screens. */}
      <div className="overflow-x-auto p-4 print:overflow-visible print:p-0" tabIndex={0} role="region" aria-label="Print preview">
        {/* Only this page prints landscape; the style element goes away with it. */}
        {landscape && <style>{'@media print { @page { size: A4 landscape; margin: 10mm; } }'}</style>}
        {/* 186mm = A4 width minus the 12mm @page margins (277mm landscape, 10mm margins). */}
        <article className={`mx-auto ${landscape ? 'min-h-[190mm] w-[277mm]' : 'min-h-[273mm] w-[186mm]'} bg-white p-[12mm] text-[11pt] text-slate-900 shadow print:min-h-0 print:w-auto print:p-0 print:shadow-none`}>
          {children}
        </article>
      </div>
    </main>
  )
}

export function Letterhead() {
  const s = useLiveQuery(getSettings)
  if (!s) return null
  const doctor = [s.doctorName, s.qualification].filter(Boolean).join(', ')
  const contact = [s.phone && `Ph: ${s.phone}`, s.email].filter(Boolean).join(' · ')
  return (
    <header className="flex items-start justify-between gap-6 border-b-2 border-brand-700 pb-3">
      <div>
        <div className="text-[18pt] font-bold leading-tight text-brand-800">{s.clinicName || 'Clinic'}</div>
        {doctor && <div className="mt-1 font-semibold">{doctor}</div>}
        {s.regNo && <div className="text-[9pt] text-slate-600">Reg. No. {s.regNo}</div>}
      </div>
      <div className="max-w-[45%] text-right text-[9pt] text-slate-700">
        {s.address && <div className="whitespace-pre-line">{s.address}</div>}
        {contact && <div className="mt-1">{contact}</div>}
      </div>
    </header>
  )
}
