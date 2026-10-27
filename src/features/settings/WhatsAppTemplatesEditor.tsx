import type { ClinicSettings, WhatsAppTemplate } from '../../db/types'
import { fillTemplate, TEMPLATE_PLACEHOLDERS, TEMPLATE_TOKENS } from '../../lib/whatsapp'
import { PlaceholderTextarea } from './PlaceholderTextarea'

const SAMPLE_PATIENT = { name: 'Asha Menon', opNo: 'OP-2026-00001' }

// Part of the settings form: edits whatsappTemplates in the parent's state and
// is saved with the single Save button.
export function WhatsAppTemplatesEditor({
  settings,
  templates,
  onChange,
}: {
  settings: ClinicSettings
  templates: WhatsAppTemplate[]
  onChange: (next: WhatsAppTemplate[]) => void
}) {
  const update = (id: string, patch: Partial<WhatsAppTemplate>) => onChange(templates.map((t) => (t.id === id ? { ...t, ...patch } : t)))

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">
        Ready-made messages you can send from a patient's page. Placeholders: {TEMPLATE_PLACEHOLDERS}. WhatsApp opens with the text
        filled in; you still press Send.
      </p>
      {templates.length === 0 && <p className="text-sm text-slate-500">No templates yet.</p>}
      <ul className="space-y-3">
        {templates.map((t, i) => (
          <li key={t.id} className="space-y-2 rounded-md border border-slate-200 p-3" aria-label={`WhatsApp template ${i + 1}`}>
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <label className="label" htmlFor={`tpl-${t.id}-name`}>
                  Template {i + 1} name
                </label>
                <input id={`tpl-${t.id}-name`} className="input" value={t.name} onChange={(e) => update(t.id, { name: e.target.value })} />
              </div>
              <button
                type="button"
                className="btn-ghost shrink-0 px-2 text-red-700"
                aria-label={`Delete template ${i + 1}`}
                title="Delete"
                onClick={() => onChange(templates.filter((x) => x.id !== t.id))}
              >
                ✕
              </button>
            </div>
            <div>
              <label className="label" htmlFor={`tpl-${t.id}-body`}>
                Template {i + 1} message
              </label>
              <PlaceholderTextarea
                id={`tpl-${t.id}-body`}
                rows={3}
                value={t.body}
                onChange={(body) => update(t.id, { body })}
                tokens={TEMPLATE_TOKENS}
              />
            </div>
            <p className="whitespace-pre-line rounded-md bg-slate-50 p-2 text-sm text-slate-700" aria-label={`Preview of template ${i + 1}`}>
              {fillTemplate(t.body, SAMPLE_PATIENT, settings) || 'Preview appears here'}
            </p>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="btn-ghost border border-dashed border-slate-300"
        onClick={() => onChange([...templates, { id: crypto.randomUUID(), name: '', body: '' }])}
      >
        + Add template
      </button>
    </div>
  )
}
