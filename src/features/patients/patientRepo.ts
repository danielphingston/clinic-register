import { db } from '../../db/db'
import { insert, nextOpNo, softDelete, update } from '../../db/repo'
import type { Patient } from '../../db/types'
import { todayISO } from '../../lib/format'

// opNo is optional: left blank, a new patient gets the next number in sequence
// and an edited one keeps the number it has.
export type PatientInput = Omit<Patient, 'id' | 'createdAt' | 'updatedAt' | 'deleted' | 'opNo'> & { opNo?: string }

// Accepts "98765 43210", "+91 98765-43210" or "098765..." and returns the bare
// 10-digit number, or null if it isn't a valid Indian mobile number.
export function normalizeIndianMobile(raw: string): string | null {
  let digits = raw.replace(/[\s\-()]/g, '')
  if (digits.startsWith('+91')) digits = digits.slice(3)
  else if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  return /^[6-9]\d{9}$/.test(digits) ? digits : null
}

// The patient (deleted ones included, as the unique index covers them) that
// already holds this OP number, ignoring case and the patient being edited.
export async function opNoHolder(opNo: string, exceptId?: string): Promise<Patient | undefined> {
  const matches = await db.patients.where('opNo').equalsIgnoreCase(opNo.trim()).toArray()
  return matches.find((p) => p.id !== exceptId)
}

async function assertOpNoFree(opNo: string, exceptId?: string): Promise<void> {
  if (await opNoHolder(opNo, exceptId)) throw new Error(`OP no ${opNo} is already in use`)
}

// Skips numbers already taken by hand, so an entered number that matches the
// sequence never blocks the next new patient.
async function autoOpNo(): Promise<string> {
  for (;;) {
    const opNo = await nextOpNo()
    if (!(await opNoHolder(opNo))) return opNo
  }
}

// Trims, drops blanks and removes case-insensitive duplicates (first spelling wins).
export function normalizeDiagnoses(list: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    const d = raw.trim().replace(/\s+/g, ' ')
    const key = d.toLowerCase()
    if (d && !seen.has(key)) {
      seen.add(key)
      out.push(d)
    }
  }
  return out
}

function clean(input: PatientInput): Omit<PatientInput, 'opNo'> {
  const out: Omit<PatientInput, 'opNo'> = { name: input.name.trim() }
  if (input.dob) out.dob = input.dob
  else if (input.age != null && !Number.isNaN(input.age)) {
    out.age = input.age
    out.ageAsOf = input.ageAsOf ?? todayISO()
  }
  if (input.sex) out.sex = input.sex
  for (const k of ['phone', 'address', 'notes'] as const) {
    const v = input[k]?.trim()
    if (v) out[k] = v
  }
  const diagnoses = input.diagnoses && normalizeDiagnoses(input.diagnoses)
  if (diagnoses?.length) out.diagnoses = diagnoses
  return out
}

export async function createPatient(input: PatientInput): Promise<Patient> {
  if (!input.name.trim()) throw new Error('Name is required')
  const entered = input.opNo?.trim()
  if (entered) await assertOpNoFree(entered)
  const opNo = entered || (await autoOpNo())
  return insert<Patient>(db.patients, { ...clean(input), opNo })
}

export async function updatePatient(id: string, input: PatientInput): Promise<void> {
  if (!input.name.trim()) throw new Error('Name is required')
  const c: Partial<Patient> = clean(input)
  const opNo = input.opNo?.trim()
  if (opNo) {
    await assertOpNoFree(opNo, id)
    c.opNo = opNo
  }
  // Explicit undefined clears fields the user emptied.
  await update<Patient>(db.patients, id, {
    dob: undefined,
    age: undefined,
    ageAsOf: undefined,
    sex: undefined,
    phone: undefined,
    address: undefined,
    notes: undefined,
    ...c,
  })
}

// Replaces the patient's diagnoses; an empty list removes the field.
export async function setDiagnoses(id: string, diagnoses: string[]): Promise<void> {
  const list = normalizeDiagnoses(diagnoses)
  await update<Patient>(db.patients, id, { diagnoses: list.length ? list : undefined })
}

// Every diagnosis used on a live patient, de-duplicated and sorted, for suggestions.
export async function knownDiagnoses(): Promise<string[]> {
  const rows = await db.patients.where('deleted').equals(0).toArray()
  return normalizeDiagnoses(rows.flatMap((p) => p.diagnoses ?? [])).sort((a, b) => a.localeCompare(b))
}

export function deletePatient(id: string): Promise<void> {
  return softDelete(db.patients, id)
}

// Newest first. Matches name, phone or OP no, case-insensitively.
export async function searchPatients(query: string, limit = 200): Promise<Patient[]> {
  const q = query.trim().toLowerCase()
  const digits = q.replace(/\D/g, '')
  const rows = await db.patients
    .where('deleted')
    .equals(0)
    .filter((p) => {
      if (!q) return true
      if (p.name.toLowerCase().includes(q)) return true
      if (p.opNo.toLowerCase().includes(q)) return true
      return digits.length >= 3 && !!p.phone && p.phone.includes(digits)
    })
    .toArray()
  rows.sort((a, b) => b.createdAt - a.createdAt)
  return rows.slice(0, limit)
}
