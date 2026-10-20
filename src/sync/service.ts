import { useSyncExternalStore } from 'react'
import { db, SYNCED_TABLES, type ClinicDB } from '../db/db'
import { isConfigured } from '../auth/google'
import { createDriveClient, driveBases, isMockDrive } from './drive'
import { getDeviceId, getDeviceName } from './device'
import { NeedPassphraseError, SyncEngine, type SyncProgress, type SyncResult } from './engine'
import { onLocalChange, pendingCount, resetTracking } from './tracking'
import { DriveError, type DriveClient, type LockInfo, type Manifest } from './types'

// App-level sync controller: owns the engine for the app database, decides
// when to sync (start, back online, 30 s after edits, tab hidden, manual) and
// publishes a status for the header chip and Settings.

export const OWNER_KEY = 'sync:owner'
export const AUTO_SYNC_DELAY = 30_000
export const LOCK_FRESH_MS = 10 * 60_000
const APP_VERSION = '0.7.0'

export type SyncPhase = 'disabled' | 'idle' | 'syncing' | 'offline' | 'needs-auth' | 'needs-passphrase' | 'error'

export interface SyncStatus {
  phase: SyncPhase
  lastSyncAt?: number
  error?: string
  errorDetail?: string
  pending: number
  blobsPending: number
  encrypted?: boolean
  // Another device that was active recently (advisory banner).
  lock: LockInfo | null
  progress?: SyncProgress
}

export class AuthRequiredError extends Error {
  readonly reason: unknown
  constructor(reason?: unknown) {
    super('Sign in again to sync')
    this.name = 'AuthRequiredError'
    this.reason = reason
  }
}

export interface SyncAuth {
  sub: string
  getToken(opts?: { forceRefresh?: boolean }): Promise<string>
}

type DriveFactory = (getToken: (refresh?: boolean) => Promise<string>) => DriveClient | null

const defaultFactory: DriveFactory = (getToken) => {
  // Tests never reach a real Drive; they install a fake with setDriveFactory.
  if (import.meta.env.MODE === 'test') return null
  if (!isConfigured() && !isMockDrive()) return null
  return createDriveClient({ getToken, ...driveBases() })
}

function shortError(e: unknown): { error: string; detail: string } {
  const detail = e instanceof Error ? e.message : String(e)
  if (e instanceof DriveError) {
    if (e.status === 0) return { error: 'network', detail }
    if (e.status === 403) return { error: 'access denied', detail }
    if (e.status === 404) return { error: 'file missing', detail }
    if (e.status >= 500 || e.status === 429) return { error: 'Drive busy', detail }
    return { error: `Drive ${e.status}`, detail }
  }
  return { error: detail.length > 40 ? 'see details' : detail, detail }
}

const INITIAL_STATUS: SyncStatus = { phase: 'disabled', pending: 0, blobsPending: 0, lock: null }

export class SyncService {
  private status: SyncStatus = { ...INITIAL_STATUS }
  private listeners = new Set<() => void>()
  private engine: SyncEngine | null = null
  private auth: SyncAuth | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private detach: (() => void) | null = null
  private factory: DriveFactory = defaultFactory
  // Bumped by start/stop so a start() still awaiting can tell it's stale
  // (React StrictMode runs effects twice).
  private generation = 0
  private inflight = new Set<Promise<unknown>>()

  private readonly database: ClinicDB
  constructor(database: ClinicDB = db) {
    this.database = database
  }

  // ---- store ----
  getSnapshot = (): SyncStatus => this.status
  subscribe = (cb: () => void) => {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
  private set(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch }
    for (const l of this.listeners) l()
  }

  // ---- setup ----
  setDriveFactory(f: DriveFactory | null) {
    this.factory = f ?? defaultFactory
    this.dropEngine()
  }

  private dropEngine() {
    if (this.engine) this.track(this.engine.dispose())
    this.engine = null
  }

  private track<T>(p: Promise<T>): Promise<T> {
    this.inflight.add(p)
    void p.finally(() => this.inflight.delete(p)).catch(() => {})
    return p
  }

  get enabled(): boolean {
    return !!this.getEngine()
  }

  setAuth(auth: SyncAuth | null) {
    if (this.auth !== auth) this.dropEngine()
    this.auth = auth
    if (!auth) this.stop()
  }

  getEngine(): SyncEngine | null {
    if (this.engine) return this.engine
    if (!this.auth) return null
    const auth = this.auth
    const drive = this.factory(async (refresh) => {
      try {
        return await auth.getToken({ forceRefresh: refresh })
      } catch (e) {
        throw new AuthRequiredError(e)
      }
    })
    if (!drive) return null
    const engine = new SyncEngine({
      db: this.database,
      drive,
      deviceId: getDeviceId(),
      deviceName: getDeviceName,
      appVersion: APP_VERSION,
    })
    engine.onProgress = (progress) => this.set({ progress })
    engine.onBlobProgress = (blobsPending) => this.set({ blobsPending })
    this.engine = engine
    return engine
  }

  private refreshPending = () => this.set({ pending: pendingCount(this.database.name) })

  // Called once the app is signed in, the owner check passed and any
  // restore finished.
  start(): Promise<void> {
    return this.track(this.runStart())
  }

  private async runStart(): Promise<void> {
    this.stop()
    const gen = this.generation
    const engine = this.getEngine()
    this.refreshPending()
    const lastSyncAt = engine ? await engine.lastSyncAt() : undefined
    if (gen !== this.generation) return
    this.set({ phase: engine ? (navigator.onLine ? 'idle' : 'offline') : 'disabled', lastSyncAt })
    if (!engine) return

    const offChange = onLocalChange((name) => {
      if (name !== this.database.name) return
      this.refreshPending()
      this.schedule()
    })
    const onOnline = () => {
      this.set({ phase: 'idle' })
      void this.syncNow()
    }
    const onOffline = () => this.set({ phase: 'offline' })
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void this.syncNow()
      else if (!this.status.lastSyncAt || Date.now() - this.status.lastSyncAt > 2 * 60_000) void this.syncNow()
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisibility)
    this.detach = () => {
      offChange()
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisibility)
    }

    if (navigator.onLine) {
      await this.checkLock()
      if (gen !== this.generation) return
      await this.syncNow()
    }
  }

  // Stops timers and listeners and waits for any running sync or blob
  // download to finish, so nothing touches the database afterwards.
  async shutdown(): Promise<void> {
    this.stop()
    this.dropEngine()
    while (this.inflight.size) await Promise.allSettled([...this.inflight])
    this.set({ ...INITIAL_STATUS })
  }

  stop() {
    this.generation++
    this.detach?.()
    this.detach = null
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.syncNow()
    }, AUTO_SYNC_DELAY)
  }

  private async checkLock() {
    const engine = this.getEngine()
    if (!engine) return
    try {
      const lock = await engine.readLock()
      if (lock && lock.deviceId !== engine.deviceId && Date.now() - lock.heartbeat < LOCK_FRESH_MS) this.set({ lock })
    } catch {
      // Advisory only.
    }
  }

  dismissLock() {
    this.set({ lock: null })
  }

  private async ownerOk(): Promise<boolean> {
    const owner = (await this.database.kv.get(OWNER_KEY))?.value
    return !!this.auth && owner === this.auth.sub
  }

  syncNow(): Promise<SyncResult | null> {
    return this.track(this.runSync())
  }

  private async runSync(): Promise<SyncResult | null> {
    const engine = this.getEngine()
    if (!engine) {
      this.set({ phase: 'disabled' })
      return null
    }
    if (!navigator.onLine) {
      this.set({ phase: 'offline' })
      return null
    }
    // Never sync data that belongs to another Google account.
    if (!(await this.ownerOk())) {
      this.set({ phase: 'error', error: 'account mismatch', errorDetail: 'Local data belongs to another Google account.' })
      return null
    }
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.set({ phase: 'syncing', error: undefined, errorDetail: undefined })
    try {
      const r = await engine.sync()
      this.set({ phase: 'idle', lastSyncAt: r.lastSyncAt, encrypted: r.manifest.encrypted, progress: undefined })
      this.refreshPending()
      return r
    } catch (e) {
      this.fail(e)
      return null
    } finally {
      this.refreshPending()
    }
  }

  private fail(e: unknown) {
    if (e instanceof NeedPassphraseError) {
      this.set({ phase: 'needs-passphrase', encrypted: true, progress: undefined })
    } else if (e instanceof AuthRequiredError) {
      this.set({ phase: 'needs-auth', progress: undefined })
    } else if (!navigator.onLine) {
      this.set({ phase: 'offline', progress: undefined })
    } else {
      console.warn('Sync failed', e)
      this.set({ phase: 'error', ...shortError(e), errorDetail: shortError(e).detail, progress: undefined })
    }
  }

  // Restore on a fresh device: returns whether Drive had data.
  async remoteInfo(): Promise<{ exists: boolean; encrypted: boolean }> {
    const engine = this.getEngine()
    if (!engine) return { exists: false, encrypted: false }
    return engine.remoteInfo()
  }

  async unlock(passphrase: string): Promise<boolean> {
    const engine = this.getEngine()
    if (!engine) return false
    const ok = await engine.unlock(passphrase)
    if (ok) this.set({ phase: 'idle' })
    return ok
  }

  async setEncryption(passphrase: string | null): Promise<Manifest> {
    const engine = this.getEngine()
    if (!engine) throw new Error('Sync is not set up')
    this.set({ phase: 'syncing' })
    try {
      const m = await engine.setEncryption(passphrase)
      this.set({ phase: 'idle', encrypted: m.encrypted, lastSyncAt: Date.now() })
      return m
    } catch (e) {
      this.fail(e)
      throw e
    } finally {
      this.refreshPending()
    }
  }

  async forgetKey() {
    await this.getEngine()?.forgetKey()
    if (this.status.encrypted) this.set({ phase: 'needs-passphrase' })
  }

  async hasStoredKey(): Promise<boolean> {
    return (await this.getEngine()?.hasStoredKey()) ?? false
  }

  requestBlob(hash: string): Promise<boolean> {
    const engine = this.getEngine()
    if (!engine || !navigator.onLine) return Promise.resolve(false)
    return engine.requestBlob(hash)
  }

  // Wipes this device's data (switching to another Google account).
  async eraseLocal(newOwner: string) {
    this.stop()
    const engine = this.getEngine()
    if (engine) await engine.eraseLocal()
    else await this.database.transaction('rw', this.database.tables, async () => {
      for (const t of this.database.tables) await t.clear()
    })
    resetTracking(this.database.name)
    await this.database.kv.put({ key: OWNER_KEY, value: newOwner, updatedAt: Date.now() })
    this.set({ lastSyncAt: undefined, pending: 0, encrypted: undefined, lock: null })
  }
}

export const syncService = new SyncService()

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(syncService.subscribe, syncService.getSnapshot)
}

// Whether this device holds clinic data (seeded remedies don't count).
export async function hasLocalData(d: ClinicDB = db): Promise<boolean> {
  for (const t of SYNCED_TABLES) {
    if (t === 'remedies') {
      if ((await d.remedies.filter((r) => r.isCustom === 1).count()) > 0) return true
      continue
    }
    if ((await d.table(t).count()) > 0) return true
  }
  return !!(await d.kv.get('settings'))
}
