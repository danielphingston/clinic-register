import { describe, expect, it } from 'vitest'
import { db } from '../../db/db'
import {
  createPatient,
  deletePatient,
  knownDiagnoses,
  normalizeIndianMobile,
  opNoHolder,
  searchPatients,
  setDiagnoses,
  updatePatient,
} from './patientRepo'

const year = new Date().getFullYear()

describe('patients', () => {
  it('assigns sequential OP numbers on create', async () => {
    const a = await createPatient({ name: ' Asha ' })
    const b = await createPatient({ name: 'Ravi', age: 40 })
    expect(a.opNo).toBe(`OP-${year}-00001`)
    expect(b.opNo).toBe(`OP-${year}-00002`)
    expect(a.name).toBe('Asha')
    expect(b.ageAsOf).toBeTruthy()
    await expect(createPatient({ name: '  ' })).rejects.toThrow()
  })

  it('validates and normalises Indian mobile numbers', () => {
    expect(normalizeIndianMobile('98765 43210')).toBe('9876543210')
    expect(normalizeIndianMobile('+91-98765-43210')).toBe('9876543210')
    expect(normalizeIndianMobile('919876543210')).toBe('9876543210')
    expect(normalizeIndianMobile('09876543210')).toBe('9876543210')
    expect(normalizeIndianMobile('1234567890')).toBeNull()
    expect(normalizeIndianMobile('98765')).toBeNull()
  })

  it('searches by name, phone and OP no, newest first, excluding deleted', async () => {
    const asha = await createPatient({ name: 'Asha Menon', phone: '9876543210' })
    await new Promise((r) => setTimeout(r, 2))
    const ravi = await createPatient({ name: 'Ravi Kumar', phone: '9123456780' })
    await new Promise((r) => setTimeout(r, 2))
    const ash = await createPatient({ name: 'Ashwin' })

    expect((await searchPatients('')).map((p) => p.id)).toEqual([ash.id, ravi.id, asha.id])
    expect((await searchPatients('ash')).map((p) => p.id)).toEqual([ash.id, asha.id])
    expect((await searchPatients('91234')).map((p) => p.id)).toEqual([ravi.id])
    expect((await searchPatients(ravi.opNo.toLowerCase())).map((p) => p.id)).toEqual([ravi.id])
    expect((await searchPatients('00001')).map((p) => p.id)).toEqual([asha.id])

    await deletePatient(ash.id)
    expect((await searchPatients('ash')).map((p) => p.id)).toEqual([asha.id])
    expect((await db.patients.get(ash.id))?.deleted).toBe(1)
  })

  it('clears fields emptied on edit and prefers DOB over age', async () => {
    const p = await createPatient({ name: 'A', age: 30, phone: '9876543210', address: 'x' })
    await updatePatient(p.id, { name: 'A', dob: '1990-01-01', age: 30, phone: '', address: '' })
    const u = await db.patients.get(p.id)
    expect(u).toMatchObject({ dob: '1990-01-01', opNo: p.opNo })
    expect(u?.age).toBeUndefined()
    expect(u?.phone).toBeUndefined()
    expect(u?.address).toBeUndefined()
  })

  it('accepts an entered OP number and skips it in the sequence', async () => {
    const a = await createPatient({ name: 'Asha', opNo: ' 1234 ' })
    expect(a.opNo).toBe('1234')
    await createPatient({ name: 'Bala', opNo: `OP-${year}-00001` })
    // The next automatic number steps over the one taken by hand.
    expect((await createPatient({ name: 'Chitra' })).opNo).toBe(`OP-${year}-00002`)
    await expect(createPatient({ name: 'Devi', opNo: 'op-' + year + '-00002' })).rejects.toThrow(/already in use/)
  })

  it('edits the OP number, keeping it unique and unchanged when left blank', async () => {
    const a = await createPatient({ name: 'Asha' })
    const b = await createPatient({ name: 'Bala' })
    await updatePatient(a.id, { name: 'Asha', opNo: 'REG-77' })
    expect((await db.patients.get(a.id))?.opNo).toBe('REG-77')
    // Saving with its own number is fine.
    await updatePatient(a.id, { name: 'Asha', opNo: 'REG-77' })
    await updatePatient(a.id, { name: 'Asha M' })
    expect((await db.patients.get(a.id))?.opNo).toBe('REG-77')
    await expect(updatePatient(b.id, { name: 'Bala', opNo: 'reg-77' })).rejects.toThrow(/already in use/)
    expect((await db.patients.get(b.id))?.opNo).toBe(`OP-${year}-00002`)

    // Deleted patients still hold their number.
    await deletePatient(a.id)
    expect((await opNoHolder('REG-77'))?.id).toBe(a.id)
    expect(await opNoHolder('REG-77', a.id)).toBeUndefined()
  })
})

describe('diagnoses', () => {
  it('trims, dedupes case-insensitively and ignores blanks', async () => {
    const p = await createPatient({ name: 'Asha', diagnoses: [' Migraine ', 'migraine', '', 'PCOS'] })
    expect(p.diagnoses).toEqual(['Migraine', 'PCOS'])
    await setDiagnoses(p.id, [...(p.diagnoses ?? []), 'pcos', '  Asthma  '])
    expect((await db.patients.get(p.id))?.diagnoses).toEqual(['Migraine', 'PCOS', 'Asthma'])
  })

  it('leaves old records without the field working, and survives a profile edit', async () => {
    const old = await createPatient({ name: 'Ravi' })
    expect(old.diagnoses).toBeUndefined()
    await setDiagnoses(old.id, ['Gout'])
    await updatePatient(old.id, { name: 'Ravi K' })
    expect((await db.patients.get(old.id))?.diagnoses).toEqual(['Gout'])
    await setDiagnoses(old.id, [])
    expect((await db.patients.get(old.id))?.diagnoses).toBeUndefined()
  })

  it('bumps updatedAt so the change syncs', async () => {
    const p = await createPatient({ name: 'Bala' })
    await new Promise((r) => setTimeout(r, 2))
    await setDiagnoses(p.id, ['Eczema'])
    expect((await db.patients.get(p.id))!.updatedAt).toBeGreaterThan(p.updatedAt)
  })

  it('lists known diagnoses from live patients only', async () => {
    await createPatient({ name: 'A', diagnoses: ['Gout', 'Asthma'] })
    const b = await createPatient({ name: 'B', diagnoses: ['gout', 'Zoster'] })
    await deletePatient(b.id)
    expect(await knownDiagnoses()).toEqual(['Asthma', 'Gout'])
  })
})
