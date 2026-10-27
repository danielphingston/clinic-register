import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { getSettings, saveSettings } from '../../db/repo'
import type { CandidateLine, CertificateKind, CertTypeSettings, ClinicSettings, LetterheadStyle } from '../../db/types'
import { RemediesSettings } from '../remedies/RemediesSettings'
import { StorageCard } from '../attachments/StorageCard'
import { SyncSettings } from '../sync/SyncSettings'
import { validateSessions } from '../appointments/clinicHours'
import { NotificationSettings } from '../reminders/NotificationSettings'
import { ExportAllCard } from '../reports/ExportAllCard'
import { NumberInput } from '../../app/NumberInput'
import { KIND_LABEL, PLACEHOLDERS } from '../certificates/certificateRepo'
import { BrandingSettings } from './BrandingSettings'
import { WhatsAppTemplatesEditor } from './WhatsAppTemplatesEditor'
import { PlaceholderTextarea } from './PlaceholderTextarea'
import { DUE_TOKENS } from '../../lib/whatsapp'

const FIELDS: { key: keyof ClinicSettings; label: string; multiline?: boolean }[] = [
  { key: 'clinicName', label: 'Clinic name' },
  { key: 'doctorName', label: 'Doctor name' },
  { key: 'qualification', label: 'Qualification (e.g. BHMS)' },
  { key: 'regNo', label: 'Registration no.' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'address', label: 'Address', multiline: true },
  { key: 'opPrefix', label: 'OP number prefix' },
]

// Sections shown one at a time; the active one lives in ?tab= so it survives reloads.
const TABS = [
  { id: 'clinic', label: 'Clinic' },
  { id: 'hours', label: 'Hours' },
  { id: 'billing', label: 'Billing' },
  { id: 'certificates', label: 'Certificates' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'branding', label: 'Branding' },
  { id: 'remedies', label: 'Remedies' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'data', label: 'Sync & storage' },
  { id: 'account', label: 'Account' },
] as const

type TabId = (typeof TABS)[number]['id']

// Sections edited through the one settings form (and its single Save button).
const FORM_TABS: TabId[] = ['clinic', 'hours', 'billing', 'certificates', 'whatsapp']

const LETTERHEAD_LABEL: Record<LetterheadStyle, string> = {
  classic: 'Classic: logo and name left, address right',
  centered: 'Centred: logo above a full-width name',
  logoLeft: 'Logo left: large serif name, contacts with icons',
  image: 'Uploaded letterhead image',
}

const CANDIDATE_LABEL: Record<CandidateLine, string> = {
  bottom: 'Bottom left',
  top: 'Top right, above the title',
  none: "Don't print",
}

const CERT_KINDS = Object.keys(KIND_LABEL) as CertificateKind[]

const WATERMARK_LABEL: Record<CertTypeSettings['watermark'], string> = {
  default: 'Same as above',
  on: 'On',
  off: 'Off',
}

function CertTypeFields({ kind, value, onChange }: { kind: CertificateKind; value: CertTypeSettings; onChange: (v: CertTypeSettings) => void }) {
  const id = (f: string) => `cert-${kind}-${f}`
  const put = <K extends keyof CertTypeSettings>(key: K, v: CertTypeSettings[K]) => onChange({ ...value, [key]: v })
  return (
    <fieldset className="space-y-3 rounded-md border border-slate-200 p-3" aria-label={KIND_LABEL[kind]}>
      <legend className="px-1 text-sm font-semibold">{KIND_LABEL[kind]}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor={id('title')}>
            Title
          </label>
          <input id={id('title')} className="input" value={value.title} onChange={(e) => put('title', e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor={id('letterhead')}>
            Letterhead
          </label>
          <select
            id={id('letterhead')}
            className="input"
            value={value.letterheadStyle}
            onChange={(e) => put('letterheadStyle', e.target.value as CertTypeSettings['letterheadStyle'])}
          >
            <option value="default">Same as the clinic letterhead style</option>
            {(Object.keys(LETTERHEAD_LABEL) as LetterheadStyle[]).map((k) => (
              <option key={k} value={k}>
                {LETTERHEAD_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor={id('watermark')}>
            Watermark
          </label>
          <select
            id={id('watermark')}
            className="input"
            value={value.watermark}
            onChange={(e) => put('watermark', e.target.value as CertTypeSettings['watermark'])}
          >
            {(Object.keys(WATERMARK_LABEL) as CertTypeSettings['watermark'][]).map((k) => (
              <option key={k} value={k}>
                {WATERMARK_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor={id('candidate')}>
            "Signature of the candidate" line
          </label>
          <select
            id={id('candidate')}
            className="input"
            value={value.candidateLine}
            onChange={(e) => put('candidateLine', e.target.value as CandidateLine)}
          >
            {(Object.keys(CANDIDATE_LABEL) as CandidateLine[]).map((k) => (
              <option key={k} value={k}>
                {CANDIDATE_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor={id('template')}>
            Wording
          </label>
          <textarea id={id('template')} rows={4} className="input" value={value.template} onChange={(e) => put('template', e.target.value)} />
          {kind === 'medicine' && <p className="mt-1 text-xs text-slate-500">The list of medicines is printed below this text.</p>}
        </div>
      </div>
    </fieldset>
  )
}

export function Settings() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab')
  const tab: TabId = TABS.find((t) => t.id === requested)?.id ?? 'clinic'
  const [form, setForm] = useState<ClinicSettings | null>(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getSettings().then(setForm)
  }, [])

  if (!form) return null

  function set<K extends keyof ClinicSettings>(key: K, value: ClinicSettings[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f))
    setSaved(false)
  }

  function setSession(i: number, field: 'start' | 'end', value: string) {
    if (!form) return
    set('sessions', form.sessions.map((s, n) => (n === i ? { ...s, [field]: value } : s)))
  }

  function showTab(id: TabId) {
    setParams({ tab: id }, { replace: true })
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    // Fail on the first problem in any section and jump to that section.
    const fail = (id: TabId, message: string) => {
      showTab(id)
      setError(message)
    }
    const sessionError = validateSessions(form.sessions)
    if (sessionError) return fail('hours', sessionError)
    if (!(form.slotMinutes >= 5 && form.slotMinutes <= 120)) return fail('hours', 'Slot length must be 5–120 minutes')
    if (!(form.consultationFee >= 0)) return fail('billing', 'Enter a consultation fee of 0 or more')
    if (!(Number.isInteger(form.defaultDueDays) && form.defaultDueDays >= 1 && form.defaultDueDays <= 365))
      return fail('billing', 'Default due days must be 1–365')
    if (!form.whatsappDueTemplate.trim()) return fail('whatsapp', 'Enter a WhatsApp reminder message')
    if ((form.whatsappTemplates ?? []).some((t) => !t.name.trim() || !t.body.trim()))
      return fail('whatsapp', 'Enter a name and message for every WhatsApp template')
    for (const k of CERT_KINDS) {
      if (!form.certTypes[k].title.trim() || !form.certTypes[k].template.trim())
        return fail('certificates', `Enter a title and wording for the ${KIND_LABEL[k].toLowerCase()}`)
    }
    setError('')
    const normalized = {
      ...form,
      opPrefix: form.opPrefix.trim() || 'OP',
      sessions: [...form.sessions].sort((a, b) => a.start.localeCompare(b.start)),
    }
    await saveSettings(normalized)
    setForm(normalized)
    setSaved(true)
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-start">
        <nav
          aria-label="Settings sections"
          className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 md:sticky md:top-20 md:mx-0 md:w-48 md:shrink-0 md:flex-col md:overflow-visible md:px-0 md:pb-0"
        >
          {TABS.map((t) => (
            <Link
              key={t.id}
              to={{ search: `?tab=${t.id}` }}
              replace
              aria-current={tab === t.id ? 'page' : undefined}
              className={`shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                tab === t.id ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        <div className="min-w-0 max-w-2xl flex-1">
          {FORM_TABS.includes(tab) && (
            <form onSubmit={handleSubmit} className="card space-y-4">
              {tab === 'clinic' && (
                <>
        <h2 className="font-semibold">Clinic profile</h2>
        <p className="text-sm text-slate-500">Shown on prescriptions, receipts, OP slips and certificates.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f.key} className={f.multiline ? 'sm:col-span-2' : ''}>
              <label className="label" htmlFor={f.key}>
                {f.label}
              </label>
              {f.multiline ? (
                <textarea
                  id={f.key}
                  className="input"
                  rows={3}
                  value={form[f.key] as string}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              ) : (
                <input
                  id={f.key}
                  className="input"
                  value={form[f.key] as string}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              )}
            </div>
          ))}
        </div>

        <div className="max-w-md">
          <label className="label" htmlFor="letterheadStyle">
            Letterhead style
          </label>
          <select
            id="letterheadStyle"
            className="input"
            value={form.letterheadStyle}
            onChange={(e) => set('letterheadStyle', e.target.value as LetterheadStyle)}
          >
            {(Object.keys(LETTERHEAD_LABEL) as LetterheadStyle[]).map((k) => (
              <option key={k} value={k}>
                {LETTERHEAD_LABEL[k]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            {form.letterheadStyle === 'image'
              ? 'Upload the image under "Letterhead image" below. Until then the classic style is used.'
              : 'Used on every printout. The logo is uploaded below.'}
          </p>
        </div>

                </>
              )}
              {tab === 'hours' && (
                <>
        <h2 className="font-semibold">Clinic hours</h2>
        <p className="text-sm text-slate-500">Sessions are shaded as working hours on the calendar.</p>
        <ul className="space-y-2">
          {form.sessions.map((s, i) => (
            <li key={i} className="flex items-end gap-2" aria-label={`Session ${i + 1}`}>
              <div className="min-w-0 flex-1 sm:flex-none">
                <label className="label" htmlFor={`session-${i}-start`}>
                  Session {i + 1} from
                </label>
                <input
                  id={`session-${i}-start`}
                  type="time"
                  className="input"
                  value={s.start}
                  onChange={(e) => setSession(i, 'start', e.target.value)}
                />
              </div>
              <div className="min-w-0 flex-1 sm:flex-none">
                <label className="label" htmlFor={`session-${i}-end`}>
                  to
                </label>
                <input
                  id={`session-${i}-end`}
                  type="time"
                  className="input"
                  value={s.end}
                  onChange={(e) => setSession(i, 'end', e.target.value)}
                />
              </div>
              <button
                type="button"
                className="btn-ghost shrink-0 px-2 text-red-700"
                aria-label={`Remove session ${i + 1}`}
                title="Remove"
                onClick={() => set('sessions', form.sessions.filter((_, n) => n !== i))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="btn-ghost border border-dashed border-slate-300"
          onClick={() => set('sessions', [...form.sessions, { start: '10:00', end: '12:00' }])}
        >
          + Add session
        </button>
        <div className="max-w-[12rem]">
          <label className="label" htmlFor="slotMinutes">
            Default slot (minutes)
          </label>
          <NumberInput
            id="slotMinutes"
            min={5}
            max={120}
            step={5}
            className="input"
            value={form.slotMinutes}
            onChange={(n) => set('slotMinutes', n)}
          />
        </div>
                </>
              )}
              {tab === 'billing' && (
                <>
        <h2 className="font-semibold">Billing</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="consultationFee">
              Consultation fee (₹)
            </label>
            <NumberInput
              id="consultationFee"
              min={0}
              inputMode="decimal"
              className="input"
              value={form.consultationFee}
              onChange={(n) => set('consultationFee', n)}
            />
            <p className="mt-1 text-xs text-slate-500">Prefilled on bills made from a visit.</p>
          </div>
          <div>
            <label className="label" htmlFor="defaultDueDays">
              Default due period (days)
            </label>
            <NumberInput
              id="defaultDueDays"
              min={1}
              max={365}
              className="input"
              value={form.defaultDueDays}
              onChange={(n) => set('defaultDueDays', n)}
            />
          </div>
        </div>
                </>
              )}
              {tab === 'certificates' && (
                <>
        <h2 className="font-semibold">Certificates</h2>
        <div className="grid gap-4">
          <div className="max-w-xs">
            <label className="label" htmlFor="certPlace">
              Default place
            </label>
            <input id="certPlace" className="input" value={form.certPlace} onChange={(e) => set('certPlace', e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.certWatermark} onChange={(e) => set('certWatermark', e.target.checked)} />
            Faint logo watermark in the middle of the page
          </label>
          <p className="text-xs text-slate-500">
            Each type below can use its own letterhead style and watermark instead. Placeholders for the wording: {PLACEHOLDERS}.
            Each certificate's wording can still be edited before printing.
          </p>
          {CERT_KINDS.map((k) => (
            <CertTypeFields key={k} kind={k} value={form.certTypes[k]} onChange={(v) => set('certTypes', { ...form.certTypes, [k]: v })} />
          ))}
        </div>

                </>
              )}
              {tab === 'whatsapp' && (
                <>
                  <h2 className="font-semibold">WhatsApp</h2>
                  <div>
                    <label className="label" htmlFor="whatsappDueTemplate">
                      WhatsApp due reminder
                    </label>
                    <PlaceholderTextarea
                      id="whatsappDueTemplate"
                      rows={3}
                      value={form.whatsappDueTemplate}
                      onChange={(v) => set('whatsappDueTemplate', v)}
                      tokens={DUE_TOKENS}
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Placeholders: {'{name} {balance} {clinic} {opNo} {dueDate}'}. The balance is filled in as ₹ with the amount.
                    </p>
                  </div>
                  <h3 className="border-t border-slate-100 pt-4 font-semibold">Message templates</h3>
                  <WhatsAppTemplatesEditor
                    settings={form}
                    templates={form.whatsappTemplates ?? []}
                    onChange={(next) => set('whatsappTemplates', next)}
                  />
                </>
              )}

              {error && (
                <p role="alert" className="text-sm text-red-700">
                  {error}
                </p>
              )}

              <div className="flex items-center gap-3">
                <button type="submit" className="btn-primary">
                  Save
                </button>
                {saved && <span className="text-sm text-brand-700">Saved</span>}
              </div>
            </form>
          )}

          {tab === 'branding' && <BrandingSettings />}
          {tab === 'remedies' && <RemediesSettings />}
          {tab === 'notifications' && <NotificationSettings />}
          {tab === 'data' && (
            <div className="space-y-4">
              <SyncSettings />
              <ExportAllCard />
              <StorageCard />
            </div>
          )}
          {tab === 'account' && (
      <div className="card space-y-3">
        <h2 className="font-semibold">Account</h2>
        {profile && (
          <p className="text-sm text-slate-600">
            Signed in as <span className="font-medium">{profile.email}</span>
          </p>
        )}
        <p className="text-sm text-slate-500">
          Signing out does not delete data on this device. Signing in with a different Google account later asks before
          anything is erased; two accounts' data is never mixed.
        </p>
        <button className="btn-ghost border border-slate-300" onClick={() => signOut().then(() => navigate('/', { replace: true }))}>
          Sign out
        </button>
      </div>
          )}
        </div>
      </div>
    </div>
  )
}
