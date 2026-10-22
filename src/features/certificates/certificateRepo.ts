import { db } from '../../db/db'
import { newRecord, nextSequence, softDelete, update } from '../../db/repo'
import type { Certificate, CertificateKind, ClinicSettings, LetterheadStyle, Patient } from '../../db/types'
import { currentAge } from '../../lib/age'
import { formatDate, parseISODate } from '../../lib/format'
import { remedyMap } from '../remedies/remedyRepo'
import { rxDetails } from '../visits/rxFormat'
import { itemsForVisit } from '../visits/visitRepo'

export class CertificateError extends Error {}

export const KIND_LABEL: Record<CertificateKind, string> = {
  medicine: 'Medicine certificate',
  medical: 'Medical certificate (rest)',
}

// Letterhead and watermark for a type: its own choice, or the clinic's.
export function certLayout(settings: ClinicSettings, kind: CertificateKind): { letterhead: LetterheadStyle; watermark: boolean } {
  const t = settings.certTypes[kind]
  return {
    letterhead: t.letterheadStyle === 'default' ? settings.letterheadStyle : t.letterheadStyle,
    watermark: t.watermark === 'default' ? settings.certWatermark : t.watermark === 'on',
  }
}

export const PLACEHOLDERS = '{name} {age} {sex} {opNo} {condition} {from} {to} {date} {doctor} {clinic}'

const SEX_WORD = { M: 'male', F: 'female', O: 'other' } as const

// "47 years", "1 year", "8 months".
export function certificateAge(p: Pick<Patient, 'dob' | 'age' | 'ageAsOf' | 'createdAt'>, on: string): string {
  const years = currentAge(p, on)
  if (years == null) return ''
  if (years === 0 && p.dob) {
    const b = parseISODate(p.dob)
    const t = parseISODate(on)
    const months = Math.max(0, (t.getFullYear() - b.getFullYear()) * 12 + t.getMonth() - b.getMonth() - (t.getDate() < b.getDate() ? 1 : 0))
    return `${months} month${months === 1 ? '' : 's'}`
  }
  return `${years} year${years === 1 ? '' : 's'}`
}

export interface WordingInput {
  date: string
  condition?: string
  restFrom?: string
  restTo?: string
}

// Fills {placeholders}; unknown ones are left as typed so a typo shows up on
// the preview instead of vanishing. Empty values leave a dotted blank to
// write in by hand.
export function fillTemplate(template: string, patient: Patient, settings: ClinicSettings, input: WordingInput): string {
  const blank = '........'
  const values: Record<string, string> = {
    name: patient.name,
    age: certificateAge(patient, input.date) || blank,
    sex: patient.sex ? SEX_WORD[patient.sex] : blank,
    opNo: patient.opNo,
    condition: input.condition?.trim() || blank,
    from: input.restFrom ? formatDate(input.restFrom) : blank,
    to: input.restTo ? formatDate(input.restTo) : blank,
    date: formatDate(input.date),
    doctor: settings.doctorName || blank,
    clinic: settings.clinicName || blank,
  }
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in values ? values[key] : m))
}

// One line per prescribed remedy, e.g. "Allium cepa 200C (4 pills · TDS)".
export async function medicinesFromVisit(visitId: string): Promise<string[]> {
  const [items, remedies] = await Promise.all([itemsForVisit(visitId), remedyMap()])
  return items.map((i) => {
    const details = rxDetails(i)
    return `${remedies.get(i.remedyId)?.name ?? ''} ${i.potency}`.trim() + (details ? ` (${details})` : '')
  })
}

export interface CertificateInput {
  kind: CertificateKind
  patientId: string
  visitId?: string
  date: string
  place?: string
  title: string
  body: string
  condition?: string
  restFrom?: string
  restTo?: string
  medicines?: string[]
}

type CertificateFields = Omit<Certificate, 'id' | 'createdAt' | 'updatedAt' | 'deleted' | 'certNo'>

function clean(input: CertificateInput): CertificateFields {
  if (!input.date) throw new CertificateError('Enter the date of issue')
  if (!input.title.trim()) throw new CertificateError('Enter a title')
  if (!input.body.trim()) throw new CertificateError('Enter the wording of the certificate')
  const out: CertificateFields = {
    kind: input.kind,
    patientId: input.patientId,
    date: input.date,
    title: input.title.trim(),
    body: input.body.trim(),
  }
  if (input.visitId) out.visitId = input.visitId
  if (input.place?.trim()) out.place = input.place.trim()
  if (input.condition?.trim()) out.condition = input.condition.trim()
  if (input.kind === 'medical') {
    if (input.restFrom && input.restTo && input.restTo < input.restFrom)
      throw new CertificateError('The rest period ends before it starts')
    if (input.restFrom) out.restFrom = input.restFrom
    if (input.restTo) out.restTo = input.restTo
  } else {
    const lines = (input.medicines ?? []).map((l) => l.trim()).filter(Boolean)
    if (lines.length) out.medicines = lines
  }
  return out
}

export async function createCertificate(input: CertificateInput): Promise<Certificate> {
  const fields = clean(input)
  return db.transaction('rw', [db.certificates, db.patients, db.kv], async () => {
    const patient = await db.patients.get(input.patientId)
    if (!patient || patient.deleted) throw new CertificateError('Patient not found')
    const n = await nextSequence(`cert:${input.date.slice(0, 4)}`)
    const cert = newRecord<Certificate>({ ...fields, certNo: `CERT-${input.date.slice(0, 4)}-${String(n).padStart(5, '0')}` })
    await db.certificates.add(cert)
    return cert
  })
}

// The number stays; optional fields cleared in the form are removed.
export async function updateCertificate(id: string, input: CertificateInput): Promise<void> {
  const fields = clean(input)
  await db.transaction('rw', db.certificates, async () => {
    const cur = await db.certificates.get(id)
    if (!cur || cur.deleted) throw new CertificateError('Certificate not found')
    const cleared = Object.fromEntries(
      (['visitId', 'place', 'condition', 'restFrom', 'restTo', 'medicines'] as const).map((k) => [k, undefined]),
    )
    await update(db.certificates, id, { ...cleared, ...fields })
  })
}

// Kept as a tombstone, so the number is never reused and the record remains.
export async function cancelCertificate(id: string): Promise<void> {
  await softDelete(db.certificates, id)
}

// Cancelled ones included: the list doubles as the patient's register.
export async function certificatesForPatient(patientId: string): Promise<Certificate[]> {
  const list = await db.certificates.where('patientId').equals(patientId).toArray()
  return list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
}
