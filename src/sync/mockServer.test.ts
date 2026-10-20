import { spawn, type ChildProcess } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ClinicDB } from '../db/db'
import { newRecord } from '../db/repo'
import type { Patient } from '../db/types'
import { createDriveClient } from './drive'
import { SyncEngine } from './engine'

// The real REST client and engine against scripts/mock-drive.mjs (small page
// size so pagination is exercised).
const PORT = 4300 + Math.floor(Math.random() * 500)
const BASE = `http://127.0.0.1:${PORT}`
let proc: ChildProcess

beforeAll(async () => {
  proc = spawn(process.execPath, ['scripts/mock-drive.mjs', '--port', String(PORT), '--page-size', '3'], { stdio: 'pipe' })
  await new Promise<void>((resolve, reject) => {
    proc.stdout!.on('data', (d) => String(d).includes('mock Drive') && resolve())
    proc.on('error', reject)
    setTimeout(() => reject(new Error('mock drive did not start')), 5000)
  })
})
afterAll(() => {
  proc?.kill()
})

const client = () =>
  createDriveClient({ getToken: async () => 'x', apiBase: `${BASE}/drive/v3`, uploadBase: `${BASE}/upload/drive/v3`, sleep: async () => {} })

describe('mock Drive server + REST client', () => {
  it('supports create, paginated list, download, update with version bump, and delete', async () => {
    const drive = client()
    const created: { id: string }[] = []
    for (let i = 0; i < 7; i++) created.push(await drive.create(`f${i}`, new Uint8Array([i, 0, 255])))
    const mine = async () => (await drive.list()).filter((f) => created.some((c) => c.id === f.id))
    expect((await mine()).length).toBe(7)
    expect(await drive.download(created[2].id)).toEqual(new Uint8Array([2, 0, 255]))
    const v1 = (await drive.getMeta(created[0].id)).version
    await drive.update(created[0].id, new TextEncoder().encode('new'))
    expect(Number((await drive.getMeta(created[0].id)).version)).toBe(Number(v1) + 1)
    expect((await drive.list({ name: 'f3' })).map((f) => f.id)).toEqual([created[3].id])
    for (const f of created) await drive.remove(f.id)
    expect(await mine()).toEqual([])
  })

  it('retries injected 503s', async () => {
    await fetch(`${BASE}/__admin/fail?status=503&count=2`, { method: 'POST' })
    expect(Array.isArray(await client().list())).toBe(true)
  })

  it('two devices sync through it', async () => {
    const A = new ClinicDB(`mock-a-${crypto.randomUUID()}`)
    const B = new ClinicDB(`mock-b-${crypto.randomUUID()}`)
    try {
      await A.patients.add(newRecord<Patient>({ opNo: 'OP-2026-00001', name: 'Via HTTP' }))
      await new SyncEngine({ db: A, drive: client(), deviceId: 'A' }).sync()
      await new SyncEngine({ db: B, drive: client(), deviceId: 'B' }).sync()
      expect((await B.patients.toArray()).map((p) => p.name)).toEqual(['Via HTTP'])
    } finally {
      await A.delete()
      await B.delete()
    }
  })
})
