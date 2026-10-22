import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { getBranding, getSettings } from '../db/repo'
import type { LetterheadStyle } from '../db/types'

export function PrintShell({
  title,
  children,
  ready,
  landscape = false,
  toolbar,
}: {
  title: string
  children: ReactNode
  ready: boolean
  landscape?: boolean
  // Extra screen-only controls beside the Print button.
  toolbar?: ReactNode
}) {
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
        <div className="flex flex-wrap items-center justify-end gap-3">
          {toolbar}
          <button className="btn-primary" disabled={!ready} onClick={() => window.print()}>
            Print
          </button>
        </div>
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

// `style` overrides the clinic's letterhead style (certificate types can).
export function Letterhead({ style: override }: { style?: LetterheadStyle } = {}) {
  const s = useLiveQuery(getSettings)
  const branding = useLiveQuery(getBranding)
  if (!s || !branding) return null
  const { logo, header } = branding
  const doctor = [s.doctorName, s.qualification].filter(Boolean).join(', ')
  const contact = [s.phone && `Ph: ${s.phone}`, s.email].filter(Boolean).join(' · ')
  // Without an uploaded image the image style falls back to classic.
  const chosen = override ?? s.letterheadStyle
  const style = chosen === 'image' && !header ? 'classic' : chosen

  if (style === 'image') {
    return (
      <header className="pb-2">
        <img src={header} alt={s.clinicName || 'Letterhead'} className="w-full object-contain" />
      </header>
    )
  }

  if (style === 'centered') {
    return (
      <header className="border-b-2 border-slate-800 pb-3 text-center">
        {logo && <img src={logo} alt="" className="mx-auto mb-2 max-h-[24mm] max-w-[60mm] object-contain" />}
        <div className="text-[17pt] font-bold uppercase leading-tight tracking-wide">{s.clinicName || 'Clinic'}</div>
        {doctor && <div className="mt-0.5 font-semibold">{doctor}</div>}
        {s.address && <div className="mt-0.5 text-[9.5pt] text-slate-700">{s.address.replace(/\s*\n\s*/g, ', ')}</div>}
        {(s.phone || s.email) && (
          <div className="text-[9.5pt] text-slate-700">{[s.phone && `Tel: ${s.phone}`, s.email].filter(Boolean).join(' · ')}</div>
        )}
      </header>
    )
  }

  if (style === 'logoLeft') {
    return (
      <header className="border-b-2 border-slate-700 pb-3">
        <div className="flex items-center gap-5">
          {logo && <img src={logo} alt="" className="max-h-[26mm] max-w-[45mm] object-contain" />}
          <div className="min-w-0 flex-1">
            <div className="font-serif text-[22pt] font-bold uppercase leading-tight text-slate-800">{s.clinicName || 'Clinic'}</div>
            {doctor && <div className="mt-0.5 font-semibold">{doctor}</div>}
            {s.regNo && <div className="text-[9pt] text-slate-600">Reg. No. {s.regNo}</div>}
          </div>
          <div className="space-y-0.5 text-[9.5pt] text-slate-700">
            {s.phone && (
              <div className="flex items-center gap-1.5">
                <PhoneIcon /> {s.phone}
              </div>
            )}
            {s.email && (
              <div className="flex items-center gap-1.5">
                <MailIcon /> {s.email}
              </div>
            )}
          </div>
        </div>
        {s.address && <div className="mt-1 text-right text-[9pt] text-slate-600">{s.address.replace(/\s*\n\s*/g, ', ')}</div>}
      </header>
    )
  }

  return (
    <header className="flex items-start justify-between gap-6 border-b-2 border-brand-700 pb-3">
      <div className="flex items-center gap-4">
        {logo && <img src={logo} alt="" className="max-h-[22mm] max-w-[40mm] object-contain" />}
        <div>
          <div className="text-[18pt] font-bold leading-tight text-brand-800">{s.clinicName || 'Clinic'}</div>
          {doctor && <div className="mt-1 font-semibold">{doctor}</div>}
          {s.regNo && <div className="text-[9pt] text-slate-600">Reg. No. {s.regNo}</div>}
        </div>
      </div>
      <div className="max-w-[45%] text-right text-[9pt] text-slate-700">
        {s.address && <div className="whitespace-pre-line">{s.address}</div>}
        {contact && <div className="mt-1">{contact}</div>}
      </div>
    </header>
  )
}

const iconProps = {
  width: 12,
  height: 12,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

function PhoneIcon() {
  return (
    <svg {...iconProps}>
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
    </svg>
  )
}

function MailIcon() {
  return (
    <svg {...iconProps}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-10 6L2 7" />
    </svg>
  )
}
