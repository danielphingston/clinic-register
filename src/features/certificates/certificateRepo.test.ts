import { describe, expect, it } from 'vitest'
import { db } from '../../db/db'
import { DEFAULT_SETTINGS } from '../../db/repo'
import type { Patient } from '../../db/types'
import { createPatient } from '../patients/patientRepo'
import { addCustomRemedy } from '../remedies/remedyRepo'
import { saveVisit } from '../visits/visitRepo'
import {
  cancelCertificate,
  certificateAge,
  certificatesForPatient,
  CertificateError,
  createCertificate,
  fillTemplate,
  medicinesFromVisit,
  updateCertificate,
  type CertificateInput,
} from './certificateRepo'

const base = (patientId: string, extra: Partial<CertificateInput> = {}): CertificateInput => ({
  kind: 'medical',
  patientId,
  date: '2026-02-22',
  title: 'Medical Certificate',
  body: 'Rest advised.',
  ...extra,
})

describe('certificate wording', () => {
  const patient = { name: 'Deepa K H', opNo: 'OP-2026-00012', age: 47, ageAsOf: '2026-01-01', sex: 'F' } as Patient

  it('fills placeholders and leaves blanks to write in', () => {
    const text = fillTemplate(DEFAULT_SETTINGS.certMedicalTemplate, patient, DEFAULT_SETTINGS, {
      date: '2026-02-22',
      condition: 'Intervertebral disc prolapse',
      restFrom: '2026-02-22',
    })
    expect(text).toBe(
      'This is to certify that Deepa K H (47 years, OP No. OP-2026-00012) was under my treatment for Intervertebral disc prolapse and was advised rest from 22 Feb 2026 to .........',
    )
  })

  it('keeps unknown placeholders visible', () => {
    expect(fillTemplate('{name} {nmae}', patient, DEFAULT_SETTINGS, { date: '2026-02-22' })).toBe('Deepa K H {nmae}')
  })

  it('gives infants an age in months', () => {
    expect(certificateAge({ dob: '2025-12-10', createdAt: 0 }, '2026-02-22')).toBe('2 months')
    expect(certificateAge({ age: 1, ageAsOf: '2026-01-01', createdAt: 0 }, '2026-02-22')).toBe('1 year')
  })
})

describe('certificateRepo', () => {
  it('numbers certificates per year and lists them newest first', async () => {
    const p = await createPatient({ name: 'Asha' })
    const a = await createCertificate(base(p.id))
    const b = await createCertificate(base(p.id, { date: '2026-03-01' }))
    const c = await createCertificate(base(p.id, { date: '2027-01-05' }))
    expect([a.certNo, b.certNo, c.certNo]).toEqual(['CERT-2026-00001', 'CERT-2026-00002', 'CERT-2027-00001'])
    expect((await certificatesForPatient(p.id)).map((x) => x.certNo)).toEqual(['CERT-2027-00001', 'CERT-2026-00002', 'CERT-2026-00001'])
  })

  it('validates the rest period and keeps only the fields for its kind', async () => {
    const p = await createPatient({ name: 'Asha' })
    await expect(createCertificate(base(p.id, { restFrom: '2026-02-22', restTo: '2026-02-01' }))).rejects.toThrow(CertificateError)
    await expect(createCertificate(base(p.id, { body: '  ' }))).rejects.toThrow('wording')
    const med = await createCertificate(base(p.id, { kind: 'medicine', medicines: ['Allium cepa 200C', ' ', ''], restFrom: '2026-02-22' }))
    expect(med.medicines).toEqual(['Allium cepa 200C'])
    expect(med.restFrom).toBeUndefined()
  })

  it('edits keep the number and clear removed fields; cancelled ones stay listed', async () => {
    const p = await createPatient({ name: 'Asha' })
    const c = await createCertificate(base(p.id, { place: 'Kochi', condition: 'IVDP' }))
    await updateCertificate(c.id, base(p.id, { body: 'Changed.' }))
    const after = await db.certificates.get(c.id)
    expect(after).toMatchObject({ certNo: c.certNo, body: 'Changed.' })
    expect(after?.place).toBeUndefined()
    expect(after?.condition).toBeUndefined()

    await cancelCertificate(c.id)
    expect((await certificatesForPatient(p.id))[0].deleted).toBe(1)
    await expect(updateCertificate(c.id, base(p.id))).rejects.toThrow('not found')
  })

  it('lists a visit’s remedies as medicine lines', async () => {
    const p = await createPatient({ name: 'Asha' })
    const r = await addCustomRemedy('Allium cepa')
    const visitId = await saveVisit({
      patientId: p.id,
      date: '2026-02-22',
      caseNotes: {},
      items: [{ remedyId: r.id, potency: '200C', repetition: 'TDS' }],
    })
    expect(await medicinesFromVisit(visitId)).toEqual(['Allium cepa 200C (TDS)'])
  })
})
