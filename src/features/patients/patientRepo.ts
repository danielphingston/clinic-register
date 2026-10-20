import { db } from '../../db/db'
import { insert, nextOpNo, softDelete, update } from '../../db/repo'
import type { Patient } from '../../db/types'
import { todayISO } from '../../lib/format'

export type PatientInput = Omit<Patient, 'id' | 'createdAt' | 'updatedAt' | 'deleted' | 'opNo'>

// Accepts "98765 43210", "+91 98765-43210" or "098765..." and returns the bare
// 10-digit number, or null if it isn't a valid Indian mobile number.
export function normalizeIndianMobile(raw: string): string | null {
  let digits = raw.replace(/[\s\-()]/g, '')
  if (digits.startsWith('+91')) digits = digits.slice(3)
  else if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  return /^[6-9]\d{9}$/.test(digits) ? digits : null
}

function clean(input: PatientInput): PatientInput {
  const out: PatientInput = { name: input.name.trim() }
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
  return out
}

export async function createPatient(input: PatientInput): Promise<Patient> {
  if (!input.name.trim()) throw new Error('Name is required')
  const opNo = await nextOpNo()
  return insert<Patient>(db.patients, { ...clean(input), opNo })
}

export async function updatePatient(id: string, input: PatientInput): Promise<void> {
  if (!input.name.trim()) throw new Error('Name is required')
  const c = clean(input)
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
