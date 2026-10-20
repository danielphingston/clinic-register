import { describe, expect, it } from 'vitest'
import { db } from './db'
import { getSettings, insert, nextOpNo, saveSettings, softDelete, update } from './repo'
import type { Patient } from './types'

describe('repo', () => {
  it('generates sequential OP numbers with the configured prefix', async () => {
    const year = new Date().getFullYear()
    expect(await nextOpNo()).toBe(`OP-${year}-00001`)
    expect(await nextOpNo()).toBe(`OP-${year}-00002`)

    await saveSettings({ ...(await getSettings()), opPrefix: 'HC' })
    expect(await nextOpNo()).toBe(`HC-${year}-00003`)
  })

  it('does not hand out duplicate OP numbers under concurrency', async () => {
    const nums = await Promise.all(Array.from({ length: 20 }, () => nextOpNo()))
    expect(new Set(nums).size).toBe(20)
  })

  it('inserts, updates and soft-deletes with sync metadata', async () => {
    const p = await insert<Patient>(db.patients, { opNo: 'OP-1', name: 'Asha' })
    expect(p.deleted).toBe(0)
    expect(p.createdAt).toBe(p.updatedAt)

    await new Promise((r) => setTimeout(r, 2))
    await update<Patient>(db.patients, p.id, { phone: '9876543210' })
    const updated = await db.patients.get(p.id)
    expect(updated?.phone).toBe('9876543210')
    expect(updated!.updatedAt).toBeGreaterThan(p.updatedAt)

    await softDelete(db.patients, p.id)
    expect(await db.patients.where('deleted').equals(0).count()).toBe(0)
    expect(await db.patients.count()).toBe(1)
  })

  it('rejects duplicate OP numbers at the index level', async () => {
    await insert<Patient>(db.patients, { opNo: 'OP-1', name: 'A' })
    await expect(insert<Patient>(db.patients, { opNo: 'OP-1', name: 'B' })).rejects.toThrow()
  })
})
