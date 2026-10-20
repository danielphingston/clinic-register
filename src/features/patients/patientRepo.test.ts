import { describe, expect, it } from 'vitest'
import { db } from '../../db/db'
import { createPatient, deletePatient, normalizeIndianMobile, searchPatients, updatePatient } from './patientRepo'

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
})
