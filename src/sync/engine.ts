import { SYNCED_TABLES, type ClinicDB } from '../db/db'
import type { KV } from '../db/types'
import {
  markBlobSynced,
  missingBlobHashes,
  putDownloadedBlob,
  removeBlob,
  unreferencedBlobHashes,
  unsyncedBlobHashes,
} from '../features/attachments/attachmentRepo'
import { addNotices, applyRecords, bumpCounters, newTouched, recomputeDerived } from './apply'
import { decrypt, deriveKey, encrypt, isEncrypted, KDF_ITERATIONS, makeKeyCheck, newKdfParams, verifyKeyCheck } from './crypto'
import { markPushed, SYNC_APPLY, SYNCED_KV_KEYS, trackingSnapshot, isDirty } from './tracking'
import { DriveError, type DriveClient, type DriveFile, type LockInfo, type Manifest, type RenumberNotice, type SyncTableName } from './types'

export const MANIFEST = 'manifest.json'
export const LOCK = 'lock.json'
export const SCHEMA = 1
export const ALL_TABLES: SyncTableName[] = [...SYNCED_TABLES, 'kv']
const STATE_KEY = 'sync:state'
export const SYNC_KEY_KV = 'sync:key'
const KEY_KEY = SYNC_KEY_KV
const BLOB_CONCURRENCY = 3

export const dataName = (t: SyncTableName) => `data-${t}.json`
export const blobName = (hash: string, gen: number) => (gen === 0 ? `blob-${hash}` : `blob-${hash}.g${gen}`)
const BLOB_RE = /^blob-([0-9a-f]{64})(?:\.g(\d+))?$/

export function parseBlobName(name: string): { hash: string; gen: number } | null {
  const m = BLOB_RE.exec(name)
  return m ? { hash: m[1], gen: m[2] ? Number(m[2]) : 0 } : null
}

export class NeedPassphraseError extends Error {
  constructor() {
    super('Enter the Drive backup passphrase to sync')
    this.name = 'NeedPassphraseError'
  }
}
export class ConflictError extends Error {
  constructor() {
    super('Drive changed during sync')
    this.name = 'ConflictError'
  }
}

interface SyncState {
  seen: Partial<Record<SyncTableName, string>>
  gen: number
  lastSyncAt?: number
}

interface StoredKey {
  key: CryptoKey
  salt: string
}

export interface SyncProgress {
  stage: 'manifest' | 'tables' | 'push' | 'done'
  done: number
  total: number
}

export interface SyncResult {
  firstDevice: boolean
  pulled: SyncTableName[]
  pushed: SyncTableName[]
  previousLock: LockInfo | null
  manifest: Manifest
  blobsUploaded: number
  renumbered: RenumberNotice[]
  lastSyncAt: number
}

export interface EngineOptions {
  db: ClinicDB
  drive: DriveClient
  deviceId: string
  deviceName?: () => string
  now?: () => number
  appVersion?: string
  kdfIterations?: number
  // Unreferenced files younger than this may belong to another device's
  // in-flight sync, so they are left alone.
  orphanGraceMs?: number
}

const enc = new TextEncoder()
const dec = new TextDecoder()
const fileAge = (f: DriveFile, now: number) => now - Date.parse(f.modifiedTime ?? f.createdTime ?? new Date(now).toISOString())

export class SyncEngine {
  readonly db: ClinicDB
  readonly drive: DriveClient
  readonly deviceId: string
  onProgress?: (p: SyncProgress) => void
  onBlobProgress?: (remaining: number) => void
  // Test hook to simulate a crash at a named point.
  failpoint?: (name: string) => void

  private deviceName: () => string
  private now: () => number
  private appVersion: string
  private kdfIterations: number
  private grace: number
  private chain: Promise<unknown> = Promise.resolve()
  private queued: Promise<SyncResult> | null = null
  private key: StoredKey | null = null
  private manifest: Manifest | null = null
  private listing: DriveFile[] | null = null
  private blobQueue: string[] = []
  private blobActive = new Set<string>()
  private blobFailed = new Set<string>()
  private blobWaiters = new Map<string, ((ok: boolean) => void)[]>()
  private blobRuns = new Set<Promise<unknown>>()
  private disposed = false

  constructor(o: EngineOptions) {
    this.db = o.db
    this.drive = o.drive
    this.deviceId = o.deviceId
    this.deviceName = o.deviceName ?? (() => 'Unknown device')
    this.now = o.now ?? Date.now
    this.appVersion = o.appVersion ?? '0'
    this.kdfIterations = o.kdfIterations ?? KDF_ITERATIONS
    this.grace = o.orphanGraceMs ?? 3600_000
  }

  get lastManifest(): Manifest | null {
    return this.manifest
  }

  // Single flight: calls made while a sync is waiting to start share it; a
  // call made while one is running queues exactly one follow-up run.
  sync(): Promise<SyncResult> {
    if (this.queued) return this.queued
    const p = this.chain.then(() => {
      this.queued = null
      return this.syncWithRetry()
    })
    this.queued = p
    this.chain = p.catch(() => {})
    return p
  }

  // Stops background blob downloads and resolves once queued work has
  // settled (sign-out, tests closing the database).
  async dispose(): Promise<void> {
    this.disposed = true
    this.blobQueue = []
    await this.idle()
  }

  async idle(): Promise<void> {
    for (;;) {
      const chain = this.chain
      await chain
      await Promise.allSettled([...this.blobRuns])
      if (chain === this.chain && this.blobRuns.size === 0) return
    }
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn)
    this.chain = p.catch(() => {})
    return p
  }

  private async syncWithRetry(): Promise<SyncResult> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.attempt()
      } catch (e) {
        if (e instanceof ConflictError && attempt < 4) continue
        throw e
      }
    }
  }

  // ---- state ----

  private async getState(): Promise<SyncState> {
    return ((await this.db.kv.get(STATE_KEY))?.value as SyncState | undefined) ?? { seen: {}, gen: 0 }
  }

  private async setState(s: SyncState) {
    await this.db.kv.put({ key: STATE_KEY, value: s, updatedAt: this.now() })
  }

  async lastSyncAt(): Promise<number | undefined> {
    return (await this.getState()).lastSyncAt
  }

  private progress(stage: SyncProgress['stage'], done = 0, total = 0) {
    this.onProgress?.({ stage, done, total })
  }

  // ---- encryption keys ----

  private async requireKey(m: Manifest): Promise<CryptoKey> {
    if (!m.kdf || !m.keyCheck) throw new Error('Drive manifest is missing its encryption details')
    if (this.key && this.key.salt === m.kdf.salt) return this.key.key
    const stored = (await this.db.kv.get(KEY_KEY))?.value as StoredKey | undefined
    if (stored && stored.salt === m.kdf.salt && (await verifyKeyCheck(stored.key, m.keyCheck))) {
      this.key = stored
      return stored.key
    }
    throw new NeedPassphraseError()
  }

  private async storeKey(key: CryptoKey, salt: string) {
    this.key = { key, salt }
    await this.db.kv.put({ key: KEY_KEY, value: { key, salt }, updatedAt: this.now() } as KV)
  }

  async forgetKey(): Promise<void> {
    this.key = null
    await this.db.kv.delete(KEY_KEY)
  }

  async hasStoredKey(): Promise<boolean> {
    return !!(await this.db.kv.get(KEY_KEY))
  }

  // Checks a passphrase against the manifest's keyCheck and remembers the
  // key on this device. Returns false for a wrong passphrase.
  unlock(passphrase: string): Promise<boolean> {
    return this.exclusive(async () => {
      const { manifest } = await this.readCanonicalManifest()
      if (!manifest?.encrypted || !manifest.kdf || !manifest.keyCheck) return true
      const key = await deriveKey(passphrase, manifest.kdf)
      if (!(await verifyKeyCheck(key, manifest.keyCheck))) return false
      await this.storeKey(key, manifest.kdf.salt)
      this.manifest = manifest
      return true
    })
  }

  // ---- Drive file helpers ----

  private async readJSON<T>(id: string): Promise<T> {
    return JSON.parse(dec.decode(await this.drive.download(id))) as T
  }

  private async readCanonicalManifest(files?: DriveFile[]) {
    const list = files ?? (await this.drive.list({ name: MANIFEST }))
    const manifests = list.filter((f) => f.name === MANIFEST).sort((a, b) => (a.createdTime ?? '').localeCompare(b.createdTime ?? '') || a.id.localeCompare(b.id))
    const file = manifests[0]
    const manifest = file ? await this.readJSON<Manifest>(file.id) : null
    if (manifest && manifest.schema > SCHEMA) {
      throw new Error('Drive data was saved by a newer version of the app. Update the app on this device first.')
    }
    return { file, manifest, extras: manifests.slice(1) }
  }

  // Lightweight check used before the restore screen.
  async remoteInfo(): Promise<{ exists: boolean; encrypted: boolean }> {
    const { manifest } = await this.readCanonicalManifest()
    if (manifest) this.manifest = manifest
    return { exists: !!manifest, encrypted: !!manifest?.encrypted }
  }

  async readLock(): Promise<LockInfo | null> {
    const files = await this.drive.list({ name: LOCK })
    if (!files[0]) return null
    try {
      return await this.readJSON<LockInfo>(files[0].id)
    } catch {
      return null
    }
  }

  private async decode(bytes: Uint8Array, key: CryptoKey | null): Promise<Uint8Array> {
    if (!isEncrypted(bytes)) return bytes
    if (!key) throw new NeedPassphraseError()
    return decrypt(key, bytes)
  }

  private async readTableFile(id: string, key: CryptoKey | null): Promise<unknown[]> {
    const raw = await this.decode(await this.drive.download(id), key)
    const parsed = JSON.parse(dec.decode(raw)) as { records?: unknown }
    if (!Array.isArray(parsed.records)) throw new Error('Drive data file is damaged')
    return parsed.records
  }

  async dumpTable(t: SyncTableName): Promise<unknown[]> {
    if (t === 'kv') return (await this.db.kv.bulkGet(SYNCED_KV_KEYS)).filter(Boolean)
    return this.db.table(t).toArray()
  }

  private async encodeTable(t: SyncTableName, key: CryptoKey | null): Promise<Uint8Array> {
    const bytes = enc.encode(JSON.stringify({ schema: SCHEMA, table: t, records: await this.dumpTable(t) }))
    return key ? encrypt(key, bytes) : bytes
  }

  private async writeManifest(file: DriveFile | undefined, m: Manifest) {
    const bytes = enc.encode(JSON.stringify(m, null, 1))
    if (file) {
      // Drive v3 has no reliable If-Match, so compare versions right before
      // writing; a mismatch means another device wrote in between.
      let meta: DriveFile
      try {
        meta = await this.drive.getMeta(file.id)
      } catch (e) {
        if (e instanceof DriveError && e.status === 404) throw new ConflictError()
        throw e
      }
      if (meta.version !== file.version) throw new ConflictError()
      await this.drive.update(file.id, bytes, 'application/json')
    } else {
      if ((await this.drive.list({ name: MANIFEST })).length) throw new ConflictError()
      await this.drive.create(MANIFEST, bytes, 'application/json')
    }
  }

  private async hasLocal(t: SyncTableName): Promise<boolean> {
    if (t === 'kv') return (await this.dumpTable('kv')).length > 0
    return (await this.db.table(t).count()) > 0
  }

  private async liveAttachmentHashes(): Promise<{ live: Set<string>; dead: Set<string>; mime: Map<string, string> }> {
    const all = await this.db.attachments.toArray()
    const live = new Set<string>()
    const dead = new Set<string>()
    const mime = new Map<string, string>()
    for (const a of all) {
      if (a.deleted) dead.add(a.blobHash)
      else {
        live.add(a.blobHash)
        mime.set(a.blobHash, a.mime)
      }
    }
    return { live, dead, mime }
  }

  // ---- the sync itself ----

  private async attempt(): Promise<SyncResult> {
    const { db, drive } = this
    const now = this.now()
    const snap = trackingSnapshot(db.name)
    this.progress('manifest')

    const files = await drive.list()
    this.listing = files
    const { file: mFile, manifest, extras } = await this.readCanonicalManifest(files)
    const key = manifest?.encrypted ? await this.requireKey(manifest) : null
    this.manifest = manifest
    const gen = manifest?.gen ?? 0
    const state = await this.getState()
    const genChanged = !!manifest && state.gen !== manifest.gen

    // Two devices that both started as "first device" leave two manifests;
    // merge the extra ones in and let the earliest-created one win.
    const extraManifests: Manifest[] = []
    let extrasMerged = true
    for (const f of extras) {
      try {
        extraManifests.push(await this.readJSON<Manifest>(f.id))
      } catch {
        extrasMerged = false
      }
    }

    const sources = new Map<SyncTableName, string[]>()
    const pushNeeded = new Set<SyncTableName>()
    for (const t of ALL_TABLES) {
      const ids: string[] = []
      const e = manifest?.tables[t]
      if (e && (genChanged || state.seen[t] !== e.fileId)) ids.push(e.fileId)
      for (const x of extraManifests) {
        const xe = x.tables[t]
        if (xe) {
          ids.push(xe.fileId)
          pushNeeded.add(t)
        }
      }
      if (ids.length) sources.set(t, ids)
    }

    const touched = newTouched()
    const notices: RenumberNotice[] = []
    const pulled: SyncTableName[] = []
    let done = 0
    this.progress('tables', 0, sources.size)
    for (const [t, ids] of sources) {
      const records: unknown[] = []
      for (const id of ids) {
        try {
          records.push(...(await this.readTableFile(id, key)))
        } catch (e) {
          // A file the manifest points at is gone (e.g. swept after a race).
          // Our full copy gets pushed in its place.
          if (e instanceof DriveError && e.status === 404) {
            pushNeeded.add(t)
            if (id !== manifest?.tables[t]?.fileId) extrasMerged = false
            continue
          }
          if (id !== manifest?.tables[t]?.fileId) {
            extrasMerged = false
            continue
          }
          throw e
        }
      }
      const r = await applyRecords(db, t, records, { tag: true, now, touched, notices })
      if (r.localNewer) pushNeeded.add(t)
      pulled.push(t)
      this.progress('tables', ++done, sources.size)
    }
    if (pulled.length) {
      await recomputeDerived(db, touched)
      await bumpCounters(db)
      await addNotices(db, notices)
    }

    const toPush: SyncTableName[] = []
    for (const t of ALL_TABLES) {
      let push: boolean
      if (pushNeeded.has(t)) push = true
      else if (pulled.includes(t)) push = false
      else if (!manifest?.tables[t]) push = await this.hasLocal(t)
      else push = !snap.tracked || isDirty(snap, t)
      if (push) toPush.push(t)
    }

    this.progress('push', 0, toPush.length)
    // Blobs go up before the records that reference them.
    const blobsUploaded = await this.uploadBlobs(files, gen, key)

    const created: string[] = []
    let newManifest: Manifest = manifest as Manifest
    try {
      const entries: Manifest['tables'] = {}
      for (const t of toPush) {
        const f = await drive.create(dataName(t), await this.encodeTable(t, key), key ? 'application/octet-stream' : 'application/json')
        created.push(f.id)
        entries[t] = { rev: (manifest?.tables[t]?.rev ?? 0) + 1, updatedAt: now, fileId: f.id }
      }
      if (!manifest || toPush.length || extraManifests.length) {
        newManifest = {
          schema: SCHEMA,
          appVersion: this.appVersion,
          encrypted: manifest?.encrypted ?? false,
          gen,
          ...(manifest?.kdf ? { kdf: manifest.kdf, keyCheck: manifest.keyCheck } : {}),
          tables: { ...manifest?.tables, ...entries },
          lastWriter: { deviceId: this.deviceId, deviceName: this.deviceName(), at: now },
        }
        this.failpoint?.('before-manifest')
        await this.writeManifest(mFile, newManifest)
      }
    } catch (e) {
      await Promise.all(created.map((id) => drive.remove(id).catch(() => {})))
      throw e
    }

    const seen: SyncState['seen'] = {}
    for (const t of ALL_TABLES) {
      const id = newManifest.tables[t]?.fileId
      if (id) seen[t] = id
    }
    await this.setState({ seen, gen, lastSyncAt: now })
    markPushed(db.name, snap.changes)
    this.manifest = newManifest

    try {
      if (extraManifests.length && extrasMerged) for (const f of extras) await drive.remove(f.id)
      await this.sweep(files, newManifest, now)
      // GC only once the tombstones that freed a blob are on Drive: i.e. the
      // attachments table is fully pushed and wasn't edited during the sync.
      const nowSnap = trackingSnapshot(db.name)
      if (!isDirty(nowSnap, 'attachments')) await this.gcBlobs(files, gen, now)
    } catch (e) {
      console.warn('Sync cleanup failed', e)
    }

    const previousLock = await this.writeLock(files, now)
    this.progress('done')
    const queued: Promise<unknown> = this.queueMissingBlobs()
      .catch(() => {})
      .finally(() => this.blobRuns.delete(queued))
    this.blobRuns.add(queued)
    return {
      firstDevice: !manifest,
      pulled,
      pushed: toPush,
      previousLock,
      manifest: newManifest,
      blobsUploaded,
      renumbered: notices,
      lastSyncAt: now,
    }
  }

  private async uploadBlobs(files: DriveFile[], gen: number, key: CryptoKey | null): Promise<number> {
    const onDrive = new Set(files.map((f) => parseBlobName(f.name)).filter((b) => b && b.gen === gen).map((b) => b!.hash))
    const { live } = await this.liveAttachmentHashes()
    // Unsynced blobs, plus any live one Drive lost (e.g. GC'd by another
    // device while this one re-used the same file): self-healing.
    const candidates = new Set(await unsyncedBlobHashes(this.db))
    for (const h of live) if (!onDrive.has(h)) candidates.add(h)
    let n = 0
    for (const hash of candidates) {
      if (!live.has(hash)) continue
      const row = await this.db.blobs.get(hash)
      if (!row) continue
      if (!onDrive.has(hash)) {
        const bytes = new Uint8Array(await row.blob.arrayBuffer())
        await this.drive.create(blobName(hash, gen), key ? await encrypt(key, bytes) : bytes)
        n++
      }
      if (!row.synced) await markBlobSynced(hash, this.db)
    }
    return n
  }

  private async sweep(files: DriveFile[], m: Manifest, now: number) {
    const referenced = new Set(Object.values(m.tables).map((e) => e!.fileId))
    for (const f of files) {
      if (f.name.startsWith('data-')) {
        if (!referenced.has(f.id) && fileAge(f, now) > this.grace) await this.drive.remove(f.id)
        continue
      }
      const b = parseBlobName(f.name)
      if (!b) continue
      // Older generations are superseded; newer ones are leftovers of an
      // interrupted re-encryption (or one in progress elsewhere: hence grace).
      if (b.gen < m.gen || (b.gen > m.gen && fileAge(f, now) > this.grace)) await this.drive.remove(f.id)
    }
  }

  private async gcBlobs(files: DriveFile[], gen: number, now: number) {
    const { live, dead } = await this.liveAttachmentHashes()
    for (const h of await unreferencedBlobHashes(this.db)) await removeBlob(h, this.db).catch(() => {})
    for (const f of files) {
      const b = parseBlobName(f.name)
      if (!b || b.gen !== gen || live.has(b.hash)) continue
      // A blob nobody references yet may be another device's upload whose
      // records haven't landed; only tombstoned ones (or very old) go.
      if (dead.has(b.hash) || fileAge(f, now) > this.grace) await this.drive.remove(f.id)
    }
  }

  private async writeLock(files: DriveFile[], now: number): Promise<LockInfo | null> {
    const lockFile = files.find((f) => f.name === LOCK)
    let prev: LockInfo | null = null
    if (lockFile) prev = await this.readJSON<LockInfo>(lockFile.id).catch(() => null)
    const lock: LockInfo = {
      deviceId: this.deviceId,
      deviceName: this.deviceName(),
      since: prev?.deviceId === this.deviceId ? prev.since : now,
      heartbeat: now,
    }
    const bytes = enc.encode(JSON.stringify(lock))
    try {
      if (lockFile) await this.drive.update(lockFile.id, bytes, 'application/json')
      else await this.drive.create(LOCK, bytes, 'application/json')
    } catch (e) {
      console.warn('Could not update lock', e)
    }
    return prev
  }

  // ---- blob downloads (background, max 3 at a time; viewer requests jump the queue) ----

  async queueMissingBlobs(): Promise<number> {
    if (this.disposed) return 0
    const missing = (await missingBlobHashes(this.db)).filter((h) => !this.blobFailed.has(h))
    for (const h of missing) if (!this.blobQueue.includes(h) && !this.blobActive.has(h)) this.blobQueue.push(h)
    this.pumpBlobs()
    return missing.length
  }

  get blobsPending(): number {
    return this.blobQueue.length + this.blobActive.size
  }

  // Fetches one blob now (ahead of the background queue). Resolves true once
  // it is stored locally.
  requestBlob(hash: string): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false)
    this.blobFailed.delete(hash)
    return new Promise((resolve) => {
      this.blobWaiters.set(hash, [...(this.blobWaiters.get(hash) ?? []), resolve])
      if (!this.blobActive.has(hash)) {
        this.blobQueue = [hash, ...this.blobQueue.filter((h) => h !== hash)]
      }
      this.pumpBlobs()
    })
  }

  private pumpBlobs() {
    while (!this.disposed && this.blobActive.size < BLOB_CONCURRENCY && this.blobQueue.length) {
      const hash = this.blobQueue.shift()!
      this.blobActive.add(hash)
      const run: Promise<unknown> = this.downloadBlob(hash)
        .catch((e) => {
          console.warn('Blob download failed', hash, e)
          this.blobFailed.add(hash)
          return false
        })
        .then((ok) => {
          this.blobActive.delete(hash)
          for (const w of this.blobWaiters.get(hash) ?? []) w(ok)
          this.blobWaiters.delete(hash)
          this.onBlobProgress?.(this.blobsPending)
          this.pumpBlobs()
        })
        .finally(() => this.blobRuns.delete(run))
      this.blobRuns.add(run)
    }
    this.onBlobProgress?.(this.blobsPending)
  }

  async downloadBlob(hash: string): Promise<boolean> {
    if (await this.db.blobs.get(hash)) return true
    const manifest = this.manifest ?? (await this.readCanonicalManifest()).manifest
    if (!manifest) return false
    const name = blobName(hash, manifest.gen)
    let file = this.listing?.find((f) => f.name === name)
    if (!file) file = (await this.drive.list({ name }))[0]
    if (!file) return false
    let bytes: Uint8Array
    try {
      bytes = await this.drive.download(file.id)
    } catch (e) {
      if (!(e instanceof DriveError && e.status === 404)) throw e
      const again = (await this.drive.list({ name }))[0]
      if (!again) return false
      bytes = await this.drive.download(again.id)
    }
    const key = isEncrypted(bytes) ? await this.requireKey(manifest) : null
    const plain = await this.decode(bytes, key)
    const att = await this.db.attachments.where('blobHash').equals(hash).first()
    await putDownloadedBlob(hash, new Blob([plain as Uint8Array<ArrayBuffer>], { type: att?.mime ?? '' }), this.db)
    return true
  }

  // ---- encryption on/off and passphrase change ----

  // passphrase = null turns encryption off. Everything is first synced, then
  // rewritten under a new generation: new files, then the manifest switch,
  // then the old files are deleted. A crash at any point leaves the manifest
  // pointing at one complete, readable set.
  setEncryption(passphrase: string | null): Promise<Manifest> {
    return this.exclusive(async () => {
      for (let attempt = 0; ; attempt++) {
        await this.syncWithRetry()
        try {
          return await this.rewrite(passphrase)
        } catch (e) {
          if (e instanceof ConflictError && attempt < 2) continue
          throw e
        }
      }
    })
  }

  private async rewrite(passphrase: string | null): Promise<Manifest> {
    const { db, drive } = this
    const now = this.now()
    const snap = trackingSnapshot(db.name)
    const files = await drive.list()
    const { file: mFile, manifest } = await this.readCanonicalManifest(files)
    if (!manifest || !mFile) throw new Error('Sync with Drive first')
    const oldKey = manifest.encrypted ? await this.requireKey(manifest) : null

    let newKey: CryptoKey | null = null
    let kdf: Manifest['kdf']
    let keyCheck: string | undefined
    if (passphrase !== null) {
      kdf = newKdfParams(this.kdfIterations)
      newKey = await deriveKey(passphrase, kdf)
      keyCheck = await makeKeyCheck(newKey)
    }
    let maxGen = manifest.gen
    for (const f of files) {
      const b = parseBlobName(f.name)
      if (b) maxGen = Math.max(maxGen, b.gen)
    }
    const newGen = maxGen + 1

    const created: string[] = []
    const entries: Manifest['tables'] = {}
    let newManifest: Manifest
    try {
      for (const t of ALL_TABLES) {
        if (!manifest.tables[t] && !(await this.hasLocal(t))) continue
        const f = await drive.create(dataName(t), await this.encodeTable(t, newKey))
        created.push(f.id)
        entries[t] = { rev: (manifest.tables[t]?.rev ?? 0) + 1, updatedAt: now, fileId: f.id }
        this.failpoint?.(`rewrite-table-${t}`)
      }
      const { live, mime } = await this.liveAttachmentHashes()
      for (const hash of live) {
        let bytes: Uint8Array
        const row = await db.blobs.get(hash)
        if (row) bytes = new Uint8Array(await row.blob.arrayBuffer())
        else {
          const old = files.find((f) => f.name === blobName(hash, manifest.gen))
          if (!old) continue
          bytes = await this.decode(await drive.download(old.id), oldKey)
          await putDownloadedBlob(hash, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime.get(hash) ?? '' }), db)
        }
        const f = await drive.create(blobName(hash, newGen), newKey ? await encrypt(newKey, bytes) : bytes)
        created.push(f.id)
        this.failpoint?.('rewrite-blob')
      }
      newManifest = {
        schema: SCHEMA,
        appVersion: this.appVersion,
        encrypted: !!newKey,
        gen: newGen,
        ...(newKey ? { kdf, keyCheck } : {}),
        tables: entries,
        lastWriter: { deviceId: this.deviceId, deviceName: this.deviceName(), at: now },
      }
      this.failpoint?.('rewrite-before-manifest')
      await this.writeManifest(mFile, newManifest)
    } catch (e) {
      await Promise.all(created.map((id) => drive.remove(id).catch(() => {})))
      throw e
    }

    if (newKey && kdf) await this.storeKey(newKey, kdf.salt)
    else await this.forgetKey()
    const seen: SyncState['seen'] = {}
    for (const [t, e] of Object.entries(entries)) seen[t as SyncTableName] = e!.fileId
    await this.setState({ seen, gen: newGen, lastSyncAt: now })
    markPushed(db.name, snap.changes)
    const { live } = await this.liveAttachmentHashes()
    for (const b of await unsyncedBlobHashes(db)) if (live.has(b)) await markBlobSynced(b, db)
    this.manifest = newManifest

    // Old set: best effort; the sweep in later syncs finishes the job.
    try {
      this.failpoint?.('rewrite-before-delete')
      // Every data file not in the new set goes, including superseded ones
      // still within the sweep's grace period: after turning encryption on,
      // no plaintext copy may linger.
      const keep = new Set(Object.values(entries).map((e) => e!.fileId))
      for (const f of await drive.list()) {
        const b = parseBlobName(f.name)
        if ((f.name.startsWith('data-') && !keep.has(f.id)) || (b && b.gen < newGen)) await drive.remove(f.id)
      }
    } catch (e) {
      console.warn('Could not delete the old Drive files', e)
    }
    return newManifest
  }

  // ---- local erase (switching Google accounts) ----

  async eraseLocal(): Promise<void> {
    const { db } = this
    await db.transaction('rw', db.tables, async (tx) => {
      ;(tx as unknown as Record<string, unknown>)[SYNC_APPLY] = true
      for (const t of db.tables) await t.clear()
    })
    this.key = null
    this.manifest = null
    this.listing = null
    this.blobQueue = []
  }
}
