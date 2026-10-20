import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ClinicDB, db as appDb } from '../db/db'
import { getSettings, newRecord, saveSettings } from '../db/repo'
import type { Attachment, Bill, Patient, Payment, StockItem, StockMove } from '../db/types'
import { createPatient } from '../features/patients/patientRepo'
import { sha256Hex } from '../lib/compress/hash'
import { NOTICES_KEY } from './apply'
import { blobName, ConflictError, dataName, MANIFEST, NeedPassphraseError, SyncEngine } from './engine'
import { FakeDrive } from './fakeDrive'
import { pendingCount, trackingSnapshot } from './tracking'
import type { Manifest, RenumberNotice } from './types'

const YEAR = new Date().getFullYear()
const op = (n: number) => `OP-${YEAR}-${String(n).padStart(5, '0')}`

let dbs: ClinicDB[] = []
function device(name: string) {
  const d = new ClinicDB(`test-${name}-${crypto.randomUUID()}`)
  dbs.push(d)
  return d
}

function engine(d: ClinicDB, drive: FakeDrive, id: string) {
  return new SyncEngine({ db: d, drive, deviceId: id, deviceName: () => `Device ${id}`, kdfIterations: 1000 })
}

function patient(opNo: string, name: string, over: Partial<Patient> = {}): Patient {
  return { ...newRecord<Patient>({ opNo, name }), ...over }
}

async function names(d: ClinicDB) {
  return (await d.patients.filter((p) => p.deleted === 0).toArray()).map((p) => p.name).sort()
}

function manifestOf(drive: FakeDrive): Manifest {
  return JSON.parse(drive.text(MANIFEST))
}

// Text of every file the manifest points at plus all blobs.
function driveText(drive: FakeDrive): string {
  return [...drive.files.values()].map((f) => new TextDecoder().decode(f.data)).join('\n')
}

async function addBlobAttachment(d: ClinicDB, patientId: string, text: string) {
  const blob = new Blob([text], { type: 'image/webp' })
  const hash = await sha256Hex(blob)
  const a = newRecord<Attachment>({
    patientId,
    kind: 'photo',
    mime: 'image/webp',
    fileName: 'x.webp',
    originalSize: text.length,
    size: text.length,
    blobHash: hash,
  })
  await d.transaction('rw', d.attachments, d.blobs, async () => {
    await d.blobs.add({ hash, blob, synced: 0 })
    await d.attachments.add(a)
  })
  return { a, hash }
}

beforeEach(() => {
  dbs = []
})

afterEach(async () => {
  for (const d of dbs) await d.delete()
})

describe('two-device sync', () => {
  it('device A pushes everything; a fresh device B restores the same data', async () => {
    const drive = new FakeDrive()
    const A = device('a')
    const B = device('b')
    await A.patients.bulkAdd([patient(op(1), 'Asha'), patient(op(2), 'Bala')])
    await saveSettingsOn(A, 'Sunrise Clinic')

    const ra = await engine(A, drive, 'A').sync()
    expect(ra.firstDevice).toBe(true)
    expect(ra.pushed).toEqual(expect.arrayContaining(['patients', 'kv']))
    expect(drive.byName(MANIFEST)).toHaveLength(1)
    expect(manifestOf(drive).tables.patients?.rev).toBe(1)
    expect(pendingCount(A.name)).toBe(0)

    const rb = await engine(B, drive, 'B').sync()
    expect(rb.firstDevice).toBe(false)
    expect(rb.pulled).toEqual(expect.arrayContaining(['patients', 'kv']))
    expect(rb.pushed).toEqual([])
    expect(await names(B)).toEqual(['Asha', 'Bala'])
    expect(((await B.kv.get('settings'))?.value as { clinicName: string }).clinicName).toBe('Sunrise Clinic')
    // Pulled data isn't a local change.
    expect(pendingCount(B.name)).toBe(0)

    // Nothing changed: a second sync pulls and pushes nothing.
    const again = await engine(B, drive, 'B').sync()
    expect(again.pulled).toEqual([])
    expect(again.pushed).toEqual([])
  })

  it('keeps edits to different records from both devices', async () => {
    const drive = new FakeDrive()
    const A = device('a')
    const B = device('b')
    const p1 = patient(op(1), 'Asha')
    const p2 = patient(op(2), 'Bala')
    await A.patients.bulkAdd([p1, p2])
    const ea = engine(A, drive, 'A')
    const eb = engine(B, drive, 'B')
    await ea.sync()
    await eb.sync()

    await A.patients.update(p1.id, { name: 'Asha K', updatedAt: Date.now() + 1 })
    await B.patients.update(p2.id, { name: 'Bala R', updatedAt: Date.now() + 1 })
    await ea.sync()
    await eb.sync()
    await ea.sync()
    expect(await names(A)).toEqual(['Asha K', 'Bala R'])
    expect(await names(B)).toEqual(['Asha K', 'Bala R'])
  })

  it('the newer edit of the same record wins on both devices', async () => {
    const drive = new FakeDrive()
    const A = device('a')
    const B = device('b')
    const p = patient(op(1), 'Asha')
    await A.patients.add(p)
    const ea = engine(A, drive, 'A')
    const eb = engine(B, drive, 'B')
    await ea.sync()
    await eb.sync()

    await B.patients.update(p.id, { name: 'Newer (B)', updatedAt: p.updatedAt + 2000 })
    await A.patients.update(p.id, { name: 'Older (A)', updatedAt: p.updatedAt + 1000 })
    await ea.sync() // A pushes its older edit first
    await eb.sync()
    await ea.sync()
    expect(await names(A)).toEqual(['Newer (B)'])
    expect(await names(B)).toEqual(['Newer (B)'])
  })

  it('a delete beats an older edit from the other device', async () => {
    const drive = new FakeDrive()
    const A = device('a')
    const B = device('b')
    const p = patient(op(1), 'Asha')
    await A.patients.add(p)
    const ea = engine(A, drive, 'A')
    const eb = engine(B, drive, 'B')
    await ea.sync()
    await eb.sync()

    await B.patients.update(p.id, { name: 'edited', updatedAt: p.updatedAt + 1000 })
    await A.patients.update(p.id, { deleted: 1, updatedAt: p.updatedAt + 2000 })
    await eb.sync()
    await ea.sync()
    await eb.sync()
    expect((await A.patients.get(p.id))?.deleted).toBe(1)
    expect((await B.patients.get(p.id))?.deleted).toBe(1)
    // Tombstones are kept.
    expect(await B.patients.count()).toBe(1)
  })

  it('advances OP counters after a pull, so the next patient on B does not collide', async () => {
    const drive = new FakeDrive()
    const A = device('a')
    await A.patients.bulkAdd([patient(op(1), 'Asha'), patient(op(2), 'Bala'), patient(op(3), 'Chitra', { deleted: 1 })])
    await engine(A, drive, 'A').sync()

    // B is the app database, so the real createPatient/nextOpNo are used.
    await engine(appDb, drive, 'B').sync()
    const p = await createPatient({ name: 'Devi' })
    expect(p.opNo).toBe(op(4))
  })

  it('renumbers the newer of two patients that got the same OP number offline, and loses nothing', async () => {
    const drive = new FakeDrive()
    const A = device('a')
    const B = device('b')
    const ea = engine(A, drive, 'A')
    const eb = engine(B, drive, 'B')
    const older = patient(op(5), 'Older', { createdAt: 1000, updatedAt: 1000 })
    const newer = patient(op(5), 'Newer', { createdAt: 2000, updatedAt: 2000 })
    await A.patients.add(older)
    await B.patients.add(newer)
    await B.kv.put({ key: `seq:op:${YEAR}`, value: 5, updatedAt: 1 })

    await ea.sync()
    const rb = await eb.sync()
    expect(rb.renumbered).toEqual([expect.objectContaining({ table: 'patients', id: newer.id, from: op(5), to: op(6) })])
    await ea.sync()

    for (const d of [A, B]) {
      const all = await d.patients.toArray()
      expect(all).toHaveLength(2)
      expect(all.find((p) => p.id === older.id)?.opNo).toBe(op(5))
      expect(all.find((p) => p.id === newer.id)?.opNo).toBe(op(6))
    }
    const notices = (await B.kv.get(NOTICES_KEY))?.value as RenumberNotice[]
    expect(notices).toHaveLength(1)
    // The counter moved past the new number.
    expect((await B.kv.get(`seq:op:${YEAR}`))?.value).toBe(6)
  })

  it('renumbers duplicate bill numbers too', async () => {
    const drive = new FakeDrive()
    const A = device('a')
    const B = device('b')
    const bill = (createdAt: number): Bill => ({
      ...newRecord<Bill>({ billNo: `BILL-${YEAR}-00001`, patientId: 'p', date: `${YEAR}-01-01`, items: [], discount: 0, total: 100, paid: 0, balance: 100 }),
      createdAt,
      updatedAt: createdAt,
    })
    const b1 = bill(1000)
    const b2 = bill(2000)
    await A.bills.add(b1)
    await B.bills.add(b2)
    await engine(A, drive, 'A').sync()
    await engine(B, drive, 'B').sync()
    await engine(A, drive, 'A').sync()
    expect((await A.bills.get(b2.id))?.billNo).toBe(`BILL-${YEAR}-00002`)
    expect(await A.bills.count()).toBe(2)
  })

  it('recomputes stock qty and bill balances from the merged ledgers', async () => {
    const drive = new FakeDrive()
    const A = device('a')
    const B = device('b')
    const item: StockItem = { ...newRecord<StockItem>({ remedyId: 'r', potency: '30C', form: 'globules', qty: 999, unit: 'g', lowStockAt: 1, price: 1 }) }
    const move = (delta: number): StockMove => newRecord<StockMove>({ stockItemId: item.id, delta, reason: delta > 0 ? 'purchase' : 'dispense', date: `${YEAR}-01-01` })
    const billRec: Bill = newRecord<Bill>({ billNo: `BILL-${YEAR}-00001`, patientId: 'p', date: `${YEAR}-01-01`, items: [{ desc: 'x', amount: 500 }], discount: 0, total: 500, paid: 0, balance: 500 })
    const pay = (amount: number, n: number): Payment =>
      newRecord<Payment>({ billId: billRec.id, patientId: 'p', amount, mode: 'cash', date: `${YEAR}-01-02`, receiptNo: `RCPT-${YEAR}-0000${n}` })
    // A's cached qty (999) is deliberately wrong; the moves say 100 - 10.
    await A.stockItems.add(item)
    await A.stockMoves.bulkAdd([move(100), move(-10)])
    await A.bills.add(billRec)
    const ea = engine(A, drive, 'A')
    const eb = engine(B, drive, 'B')
    await ea.sync()
    await eb.sync()
    expect((await B.stockItems.get(item.id))?.qty).toBe(90)
    expect(await B.bills.get(billRec.id)).toMatchObject({ paid: 0, balance: 500 })

    // Both devices take a payment on the same bill while apart.
    await A.payments.add(pay(100, 1))
    await A.bills.update(billRec.id, { paid: 100, balance: 400, updatedAt: Date.now() })
    await B.payments.add(pay(150, 2))
    await B.bills.update(billRec.id, { paid: 150, balance: 350, updatedAt: Date.now() + 5 })
    await B.stockMoves.add(move(-5))
    await B.stockItems.update(item.id, { qty: 85, updatedAt: Date.now() })
    await ea.sync()
    await eb.sync()
    await ea.sync()
    for (const d of [A, B]) {
      expect(await d.bills.get(billRec.id)).toMatchObject({ paid: 250, balance: 250 })
      expect((await d.stockItems.get(item.id))?.qty).toBe(85)
    }
    // Receipt counters advanced past both numbers.
    expect((await A.kv.get(`seq:rcpt:${YEAR}`))?.value).toBe(2)
  })

  it('merges synced settings last-writer-wins but never per-device kv', async () => {
    const drive = new FakeDrive()
    const A = device('a')
    const B = device('b')
    await A.kv.put({ key: 'seq:op:2026', value: 42, updatedAt: 1 })
    await saveSettingsOn(A, 'Old name', 1000)
    await saveSettingsOn(B, 'New name', 2000)
    await engine(A, drive, 'A').sync()
    await engine(B, drive, 'B').sync()
    await engine(A, drive, 'A').sync()
    expect(((await A.kv.get('settings'))?.value as { clinicName: string }).clinicName).toBe('New name')
    expect(await B.kv.get('seq:op:2026')).toBeUndefined()
    expect(drive.text(MANIFEST)).not.toContain('seq:')
  })

  it('works with the app database helpers (settings saved through the repo)', async () => {
    const drive = new FakeDrive()
    const B = device('b')
    await saveSettings({ ...(await getSettings()), clinicName: 'Repo Clinic' })
    expect(trackingSnapshot(appDb.name).changes.kv).toBe(1)
    await engine(appDb, drive, 'A').sync()
    await engine(B, drive, 'B').sync()
    expect(((await B.kv.get('settings'))?.value as { clinicName: string }).clinicName).toBe('Repo Clinic')
  })
})

async function saveSettingsOn(d: ClinicDB, clinicName: string, updatedAt = Date.now()) {
  await d.kv.put({ key: 'settings', value: { clinicName }, updatedAt })
}

describe('blobs', () => {
  it('uploads once, downloads on demand, and is collected only after the tombstone syncs', async () => {
    const drive = new FakeDrive()
    const A = device('a')
    const B = device('b')
    const p = patient(op(1), 'Asha')
    await A.patients.add(p)
    const { a, hash } = await addBlobAttachment(A, p.id, 'photo-bytes')
    const ea = engine(A, drive, 'A')
    const eb = engine(B, drive, 'B')

    expect((await ea.sync()).blobsUploaded).toBe(1)
    expect(drive.byName(blobName(hash, 0))).toHaveLength(1)
    expect((await A.blobs.get(hash))?.synced).toBe(1)
    expect((await ea.sync()).blobsUploaded).toBe(0)

    // B gets the metadata; the file downloads on demand.
    await B.patients.put({ ...p }) // irrelevant local row; same id merges
    eb.queueMissingBlobs = async () => 0 // keep the background queue out of this check
    await eb.sync()
    expect(await B.attachments.get(a.id)).toBeTruthy()
    expect(await B.blobs.get(hash)).toBeUndefined()
    expect(await eb.requestBlob(hash)).toBe(true)
    const got = await B.blobs.get(hash)
    expect(await got!.blob.text()).toBe('photo-bytes')
    expect(got!.blob.type).toBe('image/webp')

    // Delete on A, but the push fails before the manifest is written: the
    // blob must survive (the tombstone isn't on Drive yet).
    await A.attachments.update(a.id, { deleted: 1, updatedAt: Date.now() + 10 })
    ea.failpoint = (n) => {
      if (n === 'before-manifest') throw new Error('crash')
    }
    await expect(ea.sync()).rejects.toThrow('crash')
    expect(drive.byName(blobName(hash, 0))).toHaveLength(1)
    expect(await A.blobs.get(hash)).toBeTruthy()

    ea.failpoint = undefined
    await ea.sync()
    expect(drive.byName(blobName(hash, 0))).toHaveLength(0)
    expect(await A.blobs.get(hash)).toBeUndefined()

    await eb.sync()
    expect((await B.attachments.get(a.id))?.deleted).toBe(1)
    expect(await B.blobs.get(hash)).toBeUndefined()
  })

  it('downloads missing blobs in the background after a restore', async () => {
    const drive = new FakeDrive()
    const A = device('a')
    const B = device('b')
    const p = patient(op(1), 'Asha')
    await A.patients.add(p)
    const hashes = []
    for (let i = 0; i < 5; i++) hashes.push((await addBlobAttachment(A, p.id, `file-${i}`)).hash)
    await engine(A, drive, 'A').sync()
    const eb = engine(B, drive, 'B')
    let maxActive = 0
    eb.onBlobProgress = () => {
      maxActive = Math.max(maxActive, (eb as unknown as { blobActive: Set<string> }).blobActive.size)
    }
    await eb.sync()
    await waitFor(async () => (await B.blobs.count()) === 5)
    expect(maxActive).toBeLessThanOrEqual(3)
    expect(eb.blobsPending).toBe(0)
  })

  it('re-uploads a live blob that Drive lost', async () => {
    const drive = new FakeDrive()
    const A = device('a')
    const p = patient(op(1), 'Asha')
    await A.patients.add(p)
    const { hash } = await addBlobAttachment(A, p.id, 'keep me')
    const ea = engine(A, drive, 'A')
    await ea.sync()
    await drive.remove(drive.byName(blobName(hash, 0))[0].id)
    expect((await ea.sync()).blobsUploaded).toBe(1)
    expect(drive.byName(blobName(hash, 0))).toHaveLength(1)
  })
})

async function waitFor(cond: () => Promise<boolean>, ms = 2000) {
  const end = Date.now() + ms
  while (!(await cond())) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('concurrency', () => {
  it('retries when another device writes the manifest mid-sync, losing nothing', async () => {
    const drive = new FakeDrive()
    const A = device('a')
    const B = device('b')
    const ea = engine(A, drive, 'A')
    const eb = engine(B, drive, 'B')
    await A.patients.add(patient(op(1), 'Seed'))
    await ea.sync()
    await eb.sync()

    await A.patients.add(patient(op(2), 'From A'))
    await B.patients.add(patient(op(3), 'From B'))
    let interfered = false
    drive.hook = async (o) => {
      // Right before A checks the manifest version, B completes a sync.
      if (o === 'getMeta' && !interfered) {
        interfered = true
        drive.hook = undefined
        await eb.sync()
      }
    }
    await ea.sync()
    expect(interfered).toBe(true)
    await eb.sync()
    expect(await names(A)).toEqual(['From A', 'From B', 'Seed'])
    expect(await names(B)).toEqual(['From A', 'From B', 'Seed'])
    // Every live manifest entry points at an existing file.
    for (const e of Object.values(manifestOf(drive).tables)) expect(drive.files.has(e!.fileId)).toBe(true)
  })

  it('self-heals if a racing device overwrote the manifest after our version check', async () => {
    const drive = new FakeDrive()
    const A = device('a')
    const B = device('b')
    const ea = engine(A, drive, 'A')
    const eb = engine(B, drive, 'B')
    await A.patients.add(patient(op(1), 'Seed'))
    await ea.sync()
    await eb.sync()
    await A.patients.add(patient(op(2), 'From A'))
    await B.patients.add(patient(op(3), 'From B'))
    // Both pass the version check, then both write: B's write lands last and
    // its manifest lacks A's records.
    let aChecked = false
    drive.hook = async (o, arg) => {
      if (o === 'update' && arg === drive.byName(MANIFEST)[0].id && !aChecked) {
        aChecked = true
        const m = drive.byName(MANIFEST)[0]
        const saved = drive.hook
        drive.hook = undefined
        const v = m.version
        await eb.sync()
        m.version = v // pretend B's write wasn't visible to A's check
        drive.hook = saved
      }
    }
    await ea.sync()
    drive.hook = undefined
    // A's next sync notices its records are missing from Drive and pushes.
    await ea.sync()
    await eb.sync()
    expect(await names(B)).toEqual(['From A', 'From B', 'Seed'])
  })

  it('coalesces overlapping sync calls', async () => {
    const drive = new FakeDrive()
    const A = device('a')
    const ea = engine(A, drive, 'A')
    await A.patients.add(patient(op(1), 'x'))
    const [r1, r2, r3] = await Promise.all([ea.sync(), ea.sync(), ea.sync()])
    expect(r1).toBe(r2)
    expect(r2).toBe(r3)
    expect(r1.pushed).toContain('patients')
    expect(drive.calls.filter((c) => c.op === 'list' && !c.arg).length).toBe(1)

    // A call made while a sync runs queues exactly one follow-up.
    let release!: () => void
    drive.hook = (o) => (o === 'list' ? new Promise<void>((r) => (release = r)) : undefined)
    const running = ea.sync()
    await new Promise((r) => setTimeout(r, 0))
    await A.patients.add(patient(op(2), 'during'))
    const f1 = ea.sync()
    const f2 = ea.sync()
    expect(f1).toBe(f2)
    drive.hook = undefined
    release()
    await running
    expect((await f1).pushed).toContain('patients')
  })

  it('gives up after repeated conflicts', async () => {
    const drive = new FakeDrive()
    const A = device('a')
    const ea = engine(A, drive, 'A')
    await A.patients.add(patient(op(1), 'x'))
    await ea.sync()
    await A.patients.add(patient(op(2), 'y'))
    drive.hook = (o) => {
      if (o === 'getMeta') drive.byName(MANIFEST)[0].version = String(Math.random())
    }
    await expect(ea.sync()).rejects.toBeInstanceOf(ConflictError)
    // The data files written for the failed attempts were cleaned up.
    drive.hook = undefined
    expect(drive.byName(dataName('patients'))).toHaveLength(1)
    expect(pendingCount(A.name)).toBe(1)
  })

  it('merges a duplicate manifest left by two "first" devices', async () => {
    const drive = new FakeDrive()
    const A = device('a')
    const B = device('b')
    await A.patients.add(patient(op(1), 'From A'))
    await B.patients.add(patient(op(1), 'From B'))
    // Both see an empty Drive and create a manifest.
    await engine(A, drive, 'A').sync()
    const m = drive.byName(MANIFEST)[0]
    m.name = 'hidden'
    await engine(B, drive, 'B').sync()
    m.name = MANIFEST
    expect(drive.byName(MANIFEST)).toHaveLength(2)
    await engine(A, drive, 'A').sync()
    expect(drive.byName(MANIFEST)).toHaveLength(1)
    await engine(B, drive, 'B').sync()
    expect(await names(A)).toEqual(['From A', 'From B'])
    expect(await names(B)).toEqual(['From A', 'From B'])
    expect(new Set((await B.patients.toArray()).map((p) => p.opNo)).size).toBe(2)
  })
})

describe('encryption', () => {
  async function setup() {
    const drive = new FakeDrive()
    const A = device('a')
    const p = patient(op(1), 'Ramesh Secretname')
    await A.patients.add(p)
    const { hash } = await addBlobAttachment(A, p.id, 'PHOTO-PLAINTEXT-BYTES')
    const ea = engine(A, drive, 'A')
    await ea.sync()
    await A.patients.update(p.id, { notes: 'second push', updatedAt: Date.now() + 1 })
    await ea.sync()
    expect(drive.byName(dataName('patients'))).toHaveLength(2) // superseded copy within grace
    return { drive, A, ea, hash }
  }

  it('encrypts every data file and blob, verifies the passphrase on another device', async () => {
    const { drive, A, ea, hash } = await setup()
    const m = await ea.setEncryption('correct horse')
    expect(m).toMatchObject({ encrypted: true, gen: 1 })
    const man = manifestOf(drive)
    expect(man.kdf?.iterations).toBe(1000)
    expect(man.keyCheck).toBeTruthy()
    for (const f of drive.files.values()) {
      if (f.name === MANIFEST || f.name === 'lock.json') continue
      expect(new TextDecoder().decode(f.data.slice(0, 4))).toBe('CRE1')
    }
    expect(driveText(drive)).not.toContain('Secretname')
    expect(driveText(drive)).not.toContain('PHOTO-PLAINTEXT')
    expect(drive.byName(blobName(hash, 0))).toHaveLength(0)
    expect(drive.byName(blobName(hash, 1))).toHaveLength(1)
    // Every plaintext data file is gone, superseded ones included.
    expect(drive.byName(dataName('patients'))).toHaveLength(1)

    const B = device('b')
    const eb = engine(B, drive, 'B')
    await expect(eb.sync()).rejects.toBeInstanceOf(NeedPassphraseError)
    expect(await eb.unlock('wrong horse')).toBe(false)
    expect(await eb.unlock('correct horse')).toBe(true)
    await eb.sync()
    expect(await names(B)).toEqual(['Ramesh Secretname'])
    expect(await eb.requestBlob(hash)).toBe(true)
    expect(await (await B.blobs.get(hash))!.blob.text()).toBe('PHOTO-PLAINTEXT-BYTES')

    // The key is remembered: a new engine on B syncs without asking.
    await B.patients.add(patient(op(2), 'From B'))
    await engine(B, drive, 'B').sync()
    await ea.sync()
    expect(await names(A)).toEqual(['From B', 'Ramesh Secretname'])
    // Forgetting the key pauses sync again.
    const eb2 = engine(B, drive, 'B')
    await eb2.forgetKey()
    await expect(eb2.sync()).rejects.toBeInstanceOf(NeedPassphraseError)
  })

  it('turning encryption off restores plaintext and other devices keep working', async () => {
    const { drive, A, ea, hash } = await setup()
    await ea.setEncryption('pass-one-1')
    const B = device('b')
    const eb = engine(B, drive, 'B')
    await eb.unlock('pass-one-1')
    await eb.sync()

    const m = await ea.setEncryption(null)
    expect(m).toMatchObject({ encrypted: false, gen: 2 })
    expect(m.kdf).toBeUndefined()
    expect(driveText(drive)).toContain('Secretname')
    expect(drive.byName(blobName(hash, 2))).toHaveLength(1)
    expect(new TextDecoder().decode(drive.byName(blobName(hash, 2))[0].data)).toBe('PHOTO-PLAINTEXT-BYTES')
    expect(await A.kv.get('sync:key')).toBeUndefined()

    await B.patients.add(patient(op(2), 'After off'))
    await eb.sync()
    await ea.sync()
    expect(await names(A)).toEqual(['After off', 'Ramesh Secretname'])
  })

  it('changing the passphrase makes other devices ask again', async () => {
    const { drive, ea } = await setup()
    await ea.setEncryption('first-pass')
    const B = device('b')
    const eb = engine(B, drive, 'B')
    await eb.unlock('first-pass')
    await eb.sync()
    await ea.setEncryption('second-pass')
    await expect(eb.sync()).rejects.toBeInstanceOf(NeedPassphraseError)
    expect(await eb.unlock('first-pass')).toBe(false)
    expect(await eb.unlock('second-pass')).toBe(true)
    await eb.sync()
  })

  it('an interrupted re-upload leaves Drive consistent and readable, and a retry finishes', async () => {
    const { drive, ea, hash } = await setup()
    // Crash midway through uploading the new generation, with no chance to
    // clean up (removes fail too).
    ea.failpoint = (n) => {
      if (n === 'rewrite-blob') throw new Error('power cut')
    }
    const realRemove = drive.remove.bind(drive)
    drive.remove = async () => {
      throw new Error('offline')
    }
    await expect(ea.setEncryption('secret-pass')).rejects.toThrow('power cut')
    drive.remove = realRemove
    ea.failpoint = undefined

    // Manifest still plaintext gen 0; a fresh device restores everything.
    expect(manifestOf(drive)).toMatchObject({ encrypted: false, gen: 0 })
    expect(drive.byName(blobName(hash, 1))).toHaveLength(1) // orphan
    const C = device('c')
    const ec = engine(C, drive, 'C')
    await ec.sync()
    expect(await names(C)).toEqual(['Ramesh Secretname'])
    expect(await ec.requestBlob(hash)).toBe(true)

    // Without a retry, the next sync sweeps the orphans once they're old.
    const orphanData = () => {
      const refs = new Set(Object.values(manifestOf(drive).tables).map((e) => e!.fileId))
      return [...drive.files.values()].filter((f) => f.name.startsWith('data-') && !refs.has(f.id))
    }
    expect(orphanData().length).toBeGreaterThan(0)
    await ea.sync()
    expect(drive.byName(blobName(hash, 1))).toHaveLength(1) // still within grace
    drive.age(2 * 3600_000)
    await ea.sync()
    expect(orphanData()).toHaveLength(0)
    expect(drive.byName(blobName(hash, 1))).toHaveLength(0)

    // The orphans are gone, so the retry can reuse generation 1.
    const m = await ea.setEncryption('secret-pass')
    expect(m.gen).toBe(1)
    const unreferenced = () => {
      const refs = new Set(Object.values(manifestOf(drive).tables).map((e) => e!.fileId))
      return [...drive.files.values()].filter((f) => f.name.startsWith('data-') && !refs.has(f.id))
    }
    // The successful rewrite removes the crashed attempt's leftovers too.
    expect(unreferenced()).toHaveLength(0)
    drive.age(2 * 3600_000)
    await ea.sync()
    expect(unreferenced()).toHaveLength(0)
    expect(drive.byName(blobName(hash, 0))).toHaveLength(0)
    expect(drive.byName(blobName(hash, 1))).toHaveLength(1)
    expect(driveText(drive)).not.toContain('Secretname')
    expect(await ec.unlock('secret-pass')).toBe(true)
    await ec.sync()
  })

  it('an immediate retry after a crash skips past the orphaned generation', async () => {
    const { drive, ea, hash } = await setup()
    ea.failpoint = (n) => {
      if (n === 'rewrite-before-manifest') throw new Error('crash')
    }
    const realRemove = drive.remove.bind(drive)
    drive.remove = async () => {
      throw new Error('offline')
    }
    await expect(ea.setEncryption('secret-pass')).rejects.toThrow('crash')
    drive.remove = realRemove
    ea.failpoint = undefined
    expect(drive.byName(blobName(hash, 1))).toHaveLength(1)
    const m = await ea.setEncryption('secret-pass')
    expect(m.gen).toBe(2)
    expect(drive.byName(blobName(hash, 1))).toHaveLength(0)
    expect(drive.byName(blobName(hash, 2))).toHaveLength(1)
  })

  it('a crash after the manifest switch leaves the old set for the sweep', async () => {
    const { drive, ea, hash } = await setup()
    ea.failpoint = (n) => {
      if (n === 'rewrite-before-delete') throw new Error('crash')
    }
    await ea.setEncryption('secret-pass')
    ea.failpoint = undefined
    expect(manifestOf(drive).encrypted).toBe(true)
    expect(drive.byName(blobName(hash, 0))).toHaveLength(1)
    await ea.sync()
    expect(drive.byName(blobName(hash, 0))).toHaveLength(0)
    drive.age(2 * 3600_000)
    await ea.sync()
    expect(driveText(drive)).not.toContain('Secretname')
  })
})
