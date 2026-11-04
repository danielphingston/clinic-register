import { describe, expect, it } from 'vitest'
import { db } from './db'
import { getSettings, insert, nextOpNo, saveSettings, softDelete, update } from './repo'
import type { Patient } from './types'

describe('repo', () => {
  it('generates sequential OP numbers in the configured format', async () => {
    const year = new Date().getFullYear()
    const yy = String(year % 100).padStart(2, '0')
    expect(await nextOpNo()).toBe(`OP-${year}-00001`)
    expect(await nextOpNo()).toBe(`OP-${year}-00002`)

    await saveSettings({ ...(await getSettings()), opFormat: 'HC-{YYYY}-{N:5}' })
    expect(await nextOpNo()).toBe(`HC-${year}-00001`)

    // No prefix at all: the 183rd case of the year.
    await saveSettings({ ...(await getSettings()), opFormat: '{YY}{N:4}' })
    expect(await nextOpNo()).toBe(`${yy}0001`)
  })

  it('carries on from the last patient number, whichever device made it', async () => {
    const yy = String(new Date().getFullYear() % 100).padStart(2, '0')
    await saveSettings({ ...(await getSettings()), opFormat: '{YY}{N:4}' })
    await insert<Patient>(db.patients, { opNo: `${yy}0183`, name: 'Asha' })
    await insert<Patient>(db.patients, { opNo: `${Number(yy) - 1}0500`, name: 'Last year' })
    expect(await nextOpNo()).toBe(`${yy}0184`)
  })

  it('honours the "Next OP number" setting only in its scope and only upward', async () => {
    const yy = String(new Date().getFullYear() % 100).padStart(2, '0')
    await saveSettings({ ...(await getSettings()), opFormat: '{YY}{N:4}', opNextFloor: { scope: `${yy}{N:4}`, n: 184 } })
    expect(await nextOpNo()).toBe(`${yy}0184`)
    expect(await nextOpNo()).toBe(`${yy}0185`)
    await saveSettings({ ...(await getSettings()), opNextFloor: { scope: `${yy}{N:4}`, n: 10 } })
    expect(await nextOpNo()).toBe(`${yy}0186`)
    await saveSettings({ ...(await getSettings()), opNextFloor: { scope: `00{N:4}`, n: 900 } })
    expect(await nextOpNo()).toBe(`${yy}0187`)
  })

  it('reads settings saved with the old OP prefix as a format', async () => {
    await db.kv.put({ key: 'settings', value: { opPrefix: 'HC' }, updatedAt: 1 })
    const s = await getSettings()
    expect(s.opFormat).toBe('HC-{YYYY}-{N:5}')
    expect('opPrefix' in s).toBe(false)
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
