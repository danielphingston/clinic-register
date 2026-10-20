import { afterEach, describe, expect, it } from 'vitest'
import { ClinicDB, db } from '../db/db'
import { newRecord } from '../db/repo'
import type { Attachment, Bill, Patient, Payment } from '../db/types'
import { sha256Hex } from '../lib/compress/hash'
import { BackupError, exportBackup, importBackup } from './backup'
import { pendingCount } from './tracking'

const YEAR = new Date().getFullYear()
let extra: ClinicDB[] = []
afterEach(async () => {
  for (const d of extra) await d.delete()
  extra = []
})
function fresh() {
  const d = new ClinicDB(`backup-${crypto.randomUUID()}`)
  extra.push(d)
  return d
}

async function seed() {
  const p = newRecord<Patient>({ opNo: `OP-${YEAR}-00003`, name: 'Asha' })
  await db.patients.add(p)
  const bill = newRecord<Bill>({ billNo: `BILL-${YEAR}-00001`, patientId: p.id, date: `${YEAR}-02-01`, items: [{ desc: 'C', amount: 300 }], discount: 0, total: 300, paid: 100, balance: 200 })
  await db.bills.add(bill)
  await db.payments.add(newRecord<Payment>({ billId: bill.id, patientId: p.id, amount: 100, mode: 'cash', date: `${YEAR}-02-01`, receiptNo: `RCPT-${YEAR}-00004` }))
  const blob = new Blob(['photo'], { type: 'image/webp' })
  const hash = await sha256Hex(blob)
  await db.blobs.add({ hash, blob, synced: 1 })
  await db.attachments.add(newRecord<Attachment>({ patientId: p.id, kind: 'photo', mime: 'image/webp', fileName: 'a.webp', originalSize: 5, size: 5, blobHash: hash }))
  await db.kv.put({ key: 'settings', value: { clinicName: 'Sunrise' }, updatedAt: 5 })
  await db.kv.put({ key: 'seq:op:2026', value: 3, updatedAt: 5 })
  return { p, bill, hash }
}

describe('JSON backup', () => {
  it('round-trips into a fresh database, with counters and balances rebuilt', async () => {
    const { p, bill } = await seed()
    const r = await exportBackup({ includeAttachments: false })
    expect(r.files).toBe(0)
    const parsed = JSON.parse(r.json)
    expect(parsed.blobs).toBeUndefined()
    expect(parsed.tables.kv).toEqual([expect.objectContaining({ key: 'settings' })])

    const d = fresh()
    const res = await importBackup(r.json, d)
    expect(res.written).toBeGreaterThan(0)
    expect((await d.patients.get(p.id))?.name).toBe('Asha')
    expect(await d.bills.get(bill.id)).toMatchObject({ paid: 100, balance: 200 })
    expect((await d.kv.get(`seq:op:${YEAR}`))?.value).toBe(3)
    expect((await d.kv.get(`seq:rcpt:${YEAR}`))?.value).toBe(4)
    expect(((await d.kv.get('settings'))?.value as { clinicName: string }).clinicName).toBe('Sunrise')
    // Attachment metadata comes along; the file doesn't.
    expect(await d.attachments.count()).toBe(1)
    expect(await d.blobs.count()).toBe(0)
    // Imported data counts as local changes, to be pushed to Drive.
    expect(pendingCount(d.name)).toBeGreaterThan(0)
  })

  it('includes attachments as base64 when asked, verified by hash on import', async () => {
    const { hash } = await seed()
    const r = await exportBackup({ includeAttachments: true })
    expect(r.files).toBe(1)
    const d = fresh()
    const res = await importBackup(r.json, d)
    expect(res.files).toBe(1)
    const row = await d.blobs.get(hash)
    expect(await row!.blob.text()).toBe('photo')
    expect(row!.synced).toBe(0)

    // A tampered file entry is skipped, the rest still imports.
    const bad = JSON.parse(r.json)
    bad.blobs[hash].data = btoa('tampered')
    const d2 = fresh()
    expect((await importBackup(JSON.stringify(bad), d2)).files).toBe(0)
    expect(await d2.patients.count()).toBe(1)
  })

  it('merges instead of overwriting: newer local edits survive an older backup', async () => {
    const { p } = await seed()
    const old = (await exportBackup({ includeAttachments: false })).json
    await db.patients.update(p.id, { name: 'Asha (edited later)', updatedAt: Date.now() + 1000 })
    const other = newRecord<Patient>({ opNo: `OP-${YEAR}-00009`, name: 'Only here' })
    await db.patients.add(other)
    await importBackup(old)
    expect((await db.patients.get(p.id))?.name).toBe('Asha (edited later)')
    expect(await db.patients.get(other.id)).toBeTruthy()
  })

  it('renumbers a clashing OP number from the backup instead of failing', async () => {
    await seed()
    const json = (await exportBackup({ includeAttachments: false })).json
    const d = fresh()
    await d.patients.add({ ...newRecord<Patient>({ opNo: `OP-${YEAR}-00003`, name: 'Clash' }), createdAt: Date.now() + 5000 })
    const res = await importBackup(json, d)
    expect(res.renumbered).toHaveLength(1)
    expect(new Set((await d.patients.toArray()).map((x) => x.opNo)).size).toBe(2)
  })

  it('rejects files that are not backups', async () => {
    await expect(importBackup('nope')).rejects.toBeInstanceOf(BackupError)
    await expect(importBackup('{"a":1}')).rejects.toThrow('not a Clinic Register backup')
  })
})
