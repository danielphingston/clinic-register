import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { db } from '../../db/db'
import type { Patient, Sex } from '../../db/types'
import { ageFromDob, currentAge, dobFromAge } from '../../lib/age'
import { todayISO } from '../../lib/format'
import { createPatient, deletePatient, normalizeIndianMobile, opNoHolder, updatePatient } from './patientRepo'

interface FormState {
  name: string
  opNo: string
  dob: string
  age: string
  sex: Sex | ''
  phone: string
  address: string
  notes: string
}

const EMPTY: FormState = { name: '', opNo: '', dob: '', age: '', sex: '', phone: '', address: '', notes: '' }

function fromPatient(p: Patient): FormState {
  const age = currentAge(p, todayISO())
  return {
    name: p.name,
    opNo: p.opNo,
    dob: p.dob ?? '',
    age: age == null ? '' : String(age),
    sex: p.sex ?? '',
    phone: p.phone ?? '',
    address: p.address ?? '',
    notes: p.notes ?? '',
  }
}

// Keyed by route params so switching records never carries over form state.
export function PatientForm() {
  const p = useParams()
  return <PatientFormInner key={p.id ?? 'new'} />
}

function PatientFormInner() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [form, setForm] = useState<FormState | null>(id ? null : EMPTY)
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [saving, setSaving] = useState(false)
  const today = todayISO()

  useEffect(() => {
    if (!id) return
    db.patients.get(id).then((p) => {
      if (!p || p.deleted) navigate('/patients', { replace: true })
      else setForm(fromPatient(p))
    })
  }, [id, navigate])

  if (!form) return null

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }

  function onDob(dob: string) {
    setForm((f) => (f ? { ...f, dob, age: dob && dob <= today ? String(ageFromDob(dob, today)) : f.age } : f))
    setErrors((e) => ({ ...e, dob: undefined }))
  }

  function onAge(age: string) {
    // Typing an age means the DOB is unknown.
    setForm((f) => (f ? { ...f, age, dob: '' } : f))
    setErrors((e) => ({ ...e, age: undefined }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    const errs: typeof errors = {}
    if (!form.name.trim()) errs.name = 'Name is required'
    const opNo = form.opNo.trim()
    if (opNo) {
      const holder = await opNoHolder(opNo, id)
      if (holder) errs.opNo = holder.deleted ? 'OP no is used by a deleted patient' : `OP no is already used by ${holder.name}`
    } else if (id) errs.opNo = 'OP no is required'
    let phone = ''
    if (form.phone.trim()) {
      const n = normalizeIndianMobile(form.phone)
      if (!n) errs.phone = 'Enter a 10-digit Indian mobile number'
      else phone = n
    }
    if (form.dob && form.dob > today) errs.dob = 'Date of birth cannot be in the future'
    const age = form.age.trim() === '' ? undefined : Number(form.age)
    if (!form.dob && age != null && (!Number.isInteger(age) || age < 0 || age > 130)) errs.age = 'Enter age in years'
    setErrors(errs)
    const first = (['name', 'opNo', 'dob', 'age', 'phone'] as const).find((k) => errs[k])
    if (first) {
      document.getElementById(`p-${first}`)?.focus()
      return
    }

    const input = {
      name: form.name,
      opNo: opNo || undefined,
      dob: form.dob || undefined,
      age: form.dob ? undefined : age,
      sex: form.sex || undefined,
      phone,
      address: form.address,
      notes: form.notes,
    }
    setSaving(true)
    try {
      if (id) {
        await updatePatient(id, input)
        navigate(`/patients/${id}`)
      } else {
        const p = await createPatient(input)
        navigate(`/patients/${p.id}`)
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!id) return
    await deletePatient(id)
    navigate('/patients', { replace: true })
  }

  const approxYear = !form.dob && form.age.trim() !== '' && Number(form.age) >= 0 ? dobFromAge(Number(form.age), today).slice(0, 4) : ''

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold">{id ? 'Edit patient' : 'New patient'}</h1>

      <form onSubmit={handleSubmit} className="card mt-4 space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="p-name">
              Name *
            </label>
            <input
              id="p-name"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? 'p-name-error' : undefined}
              className="input"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              autoFocus
            />
            {errors.name && (
              <p id="p-name-error" className="mt-1 text-sm text-red-600">
                {errors.name}
              </p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="p-opNo">
              OP / Reg. no{id ? ' *' : ''}
            </label>
            <input
              id="p-opNo"
              aria-invalid={errors.opNo ? true : undefined}
              aria-describedby={errors.opNo ? 'p-opNo-error' : id ? undefined : 'p-opNo-hint'}
              className="input font-mono"
              placeholder={id ? undefined : 'Automatic'}
              value={form.opNo}
              onChange={(e) => set('opNo', e.target.value)}
            />
            {errors.opNo ? (
              <p id="p-opNo-error" className="mt-1 text-sm text-red-600">
                {errors.opNo}
              </p>
            ) : (
              !id && (
                <p id="p-opNo-hint" className="mt-1 text-xs text-slate-500">
                  Leave blank for the next number
                </p>
              )
            )}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="p-dob">
              Date of birth
            </label>
            <input
              id="p-dob"
              aria-invalid={errors.dob ? true : undefined}
              aria-describedby={errors.dob ? 'p-dob-error' : undefined}
              type="date"
              max={today}
              className="input"
              value={form.dob}
              onChange={(e) => onDob(e.target.value)}
            />
            {errors.dob && (
              <p id="p-dob-error" className="mt-1 text-sm text-red-600">
                {errors.dob}
              </p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="p-age">
              Age (years)
            </label>
            <input
              id="p-age"
              aria-invalid={errors.age ? true : undefined}
              aria-describedby={errors.age ? 'p-age-error' : undefined}
              type="number"
              inputMode="numeric"
              min={0}
              max={130}
              className="input"
              value={form.age}
              onChange={(e) => onAge(e.target.value)}
            />
            {errors.age && (
              <p id="p-age-error" className="mt-1 text-sm text-red-600">
                {errors.age}
              </p>
            )}
            {approxYear && <p className="mt-1 text-xs text-slate-500">Born around {approxYear}</p>}
          </div>
          <div>
            <label className="label" htmlFor="p-sex">
              Sex
            </label>
            <select id="p-sex" className="input" value={form.sex} onChange={(e) => set('sex', e.target.value as Sex | '')}>
              <option value="">—</option>
              <option value="M">Male</option>
              <option value="F">Female</option>
              <option value="O">Other</option>
            </select>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="p-phone">
            Phone
          </label>
          <input
            id="p-phone"
            aria-invalid={errors.phone ? true : undefined}
            aria-describedby={errors.phone ? 'p-phone-error' : undefined}
            type="tel"
            inputMode="tel"
            className="input"
            placeholder="10-digit mobile"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
          />
          {errors.phone && (
            <p id="p-phone-error" className="mt-1 text-sm text-red-600">
              {errors.phone}
            </p>
          )}
        </div>

        <div>
          <label className="label" htmlFor="p-address">
            Address
          </label>
          <textarea id="p-address" rows={2} className="input" value={form.address} onChange={(e) => set('address', e.target.value)} />
        </div>

        <div>
          <label className="label" htmlFor="p-notes">
            Notes
          </label>
          <textarea id="p-notes" rows={2} className="input" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>

        <div className="flex flex-wrap gap-3">
          <button type="submit" className="btn-primary" disabled={saving}>
            {id ? 'Save changes' : 'Save patient'}
          </button>
          <Link to={id ? `/patients/${id}` : '/patients'} className="btn-ghost border border-slate-300">
            Cancel
          </Link>
        </div>
      </form>

      {id && (
        <div className="card mt-4 border-red-200">
          <h2 className="font-semibold text-red-700">Delete patient</h2>
          {confirmDelete ? (
            <div className="mt-2 space-y-3 text-sm">
              <p>
                Delete <span className="font-medium">{form.name}</span>? They will be hidden from lists and search. Visit records are kept.
              </p>
              <div className="flex flex-wrap gap-3">
                <button className="btn bg-red-600 text-white hover:bg-red-700" onClick={handleDelete}>
                  Yes, delete patient
                </button>
                <button className="btn-ghost border border-slate-300" onClick={() => setConfirmDelete(false)}>
                  Keep patient
                </button>
              </div>
            </div>
          ) : (
            <button className="btn-ghost mt-2 border border-red-300 text-red-700" onClick={() => setConfirmDelete(true)}>
              Delete patient…
            </button>
          )}
        </div>
      )}
    </div>
  )
}
