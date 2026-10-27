import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { getSettings } from '../../db/repo'
import type { Patient } from '../../db/types'
import { templateLink, whatsappNumber } from '../../lib/whatsapp'

// Pick one of the clinic's WhatsApp templates and open it prefilled for the patient.
export function WhatsAppTemplateButton({ patient }: { patient: Pick<Patient, 'name' | 'opNo' | 'phone'> }) {
  const settings = useLiveQuery(getSettings, [])
  const [picked, setPicked] = useState('')
  const templates = (settings?.whatsappTemplates ?? []).filter((t) => t.name.trim() && t.body.trim())
  const hasMobile = !!whatsappNumber(patient.phone)
  const template = templates.find((t) => t.id === picked) ?? templates[0]
  const link = settings && template ? templateLink(patient, template.body, settings) : null

  if (!settings || templates.length === 0) return null

  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor="wa-template">
        WhatsApp message
      </label>
      <select id="wa-template" className="input w-auto" value={template?.id} onChange={(e) => setPicked(e.target.value)} disabled={!hasMobile}>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {link ? (
        <a href={link} target="_blank" rel="noreferrer" className="btn-ghost border border-slate-300">
          Send WhatsApp
        </a>
      ) : (
        <button type="button" className="btn-ghost border border-slate-300" disabled title="Add a valid mobile number to send WhatsApp messages">
          Send WhatsApp
        </button>
      )}
    </div>
  )
}
