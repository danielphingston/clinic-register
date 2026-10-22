import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { getSettings, saveSettings } from '../../db/repo'
import type { ClinicSettings } from '../../db/types'
import { RemediesSettings } from '../remedies/RemediesSettings'
import { StorageCard } from '../attachments/StorageCard'
import { SyncSettings } from '../sync/SyncSettings'
import { validateSessions } from '../appointments/clinicHours'
import { NotificationSettings } from '../reminders/NotificationSettings'
import { ExportAllCard } from '../reports/ExportAllCard'
import { NumberInput } from '../../app/NumberInput'

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

export function Settings() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    const sessionError = validateSessions(form.sessions)
    if (sessionError) return setError(sessionError)
    if (!(form.slotMinutes >= 5 && form.slotMinutes <= 120)) return setError('Slot length must be 5–120 minutes')
    if (!(form.consultationFee >= 0)) return setError('Enter a consultation fee of 0 or more')
    if (!(Number.isInteger(form.defaultDueDays) && form.defaultDueDays >= 1 && form.defaultDueDays <= 365))
      return setError('Default due days must be 1–365')
    if (!form.whatsappDueTemplate.trim()) return setError('Enter a WhatsApp reminder message')
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
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <form onSubmit={handleSubmit} className="card mt-4 space-y-4">
        <h2 className="font-semibold">Clinic profile</h2>
        <p className="text-sm text-slate-500">Shown on prescriptions, receipts and OP slips.</p>
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

        <h2 className="border-t border-slate-100 pt-4 font-semibold">Clinic hours</h2>
        <p className="text-sm text-slate-500">Sessions are shaded as working hours on the calendar.</p>
        <ul className="space-y-2">
          {form.sessions.map((s, i) => (
            <li key={i} className="flex flex-wrap items-end gap-2" aria-label={`Session ${i + 1}`}>
              <div>
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
              <div>
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
                className="btn-ghost text-red-700"
                aria-label={`Remove session ${i + 1}`}
                onClick={() => set('sessions', form.sessions.filter((_, n) => n !== i))}
              >
                Remove
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
        <h2 className="border-t border-slate-100 pt-4 font-semibold">Billing</h2>
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
          <div className="sm:col-span-2">
            <label className="label" htmlFor="whatsappDueTemplate">
              WhatsApp due reminder
            </label>
            <textarea
              id="whatsappDueTemplate"
              rows={3}
              className="input"
              value={form.whatsappDueTemplate}
              onChange={(e) => set('whatsappDueTemplate', e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-500">
              Placeholders: {'{name} {balance} {clinic} {opNo} {dueDate}'}. The balance is filled in as ₹ with the amount.
            </p>
          </div>
        </div>

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

      <RemediesSettings />

      <SyncSettings />

      <ExportAllCard />

      <NotificationSettings />

      <StorageCard />

      <div className="card mt-4 space-y-3">
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
    </div>
  )
}
