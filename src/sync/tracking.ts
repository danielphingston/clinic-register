import type Dexie from 'dexie'

// Local change tracking for sync. Every write to a synced table bumps a
// per-table counter in localStorage (synchronously, from Dexie hooks, so it
// can't be lost to a crash). A push records the counters it covered; a table
// is dirty while its counter is ahead of the pushed value.
//
// Writes made by the sync engine itself (applying remote data) run in a
// transaction tagged with SYNC_APPLY and are not counted, otherwise every pull
// would trigger a push and two devices would ping-pong forever.

export const SYNC_APPLY = '__syncApply'
export const KV_TABLE = 'kv'
// The kv entries that sync; the rest (sequence counters, sync state, the
// cached key, owner) are per device.
export const SYNCED_KV_KEYS = ['settings', 'branding']

export type Counts = Record<string, number>

const listeners = new Set<(dbName: string) => void>()

const changesKey = (dbName: string) => `sync:changes:${dbName}`
const pushedKey = (dbName: string) => `sync:pushed:${dbName}`

function read(key: string): Counts | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as Counts) : null
  } catch {
    return null
  }
}

function write(key: string, value: Counts) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage full or blocked: the "tracking missing" path pushes everything.
  }
}

export function markChange(dbName: string, table: string) {
  const c = read(changesKey(dbName)) ?? {}
  c[table] = (c[table] ?? 0) + 1
  write(changesKey(dbName), c)
  for (const l of listeners) l(dbName)
}

type HookTx = Record<string, unknown> | undefined

export function installChangeTracking(db: Dexie, tables: readonly string[]) {
  for (const name of tables) {
    const table = db.table(name)
    const on = (tx: unknown) => {
      if ((tx as HookTx)?.[SYNC_APPLY]) return
      markChange(db.name, name)
    }
    table.hook('creating', function (_pk, _obj, tx) {
      on(tx)
    })
    table.hook('updating', function (_mods, _pk, _obj, tx) {
      on(tx)
    })
    table.hook('deleting', function (_pk, _obj, tx) {
      on(tx)
    })
  }
  const kv = db.table(KV_TABLE)
  const onKv = (key: unknown, tx: unknown) => {
    if ((tx as HookTx)?.[SYNC_APPLY]) return
    if (SYNCED_KV_KEYS.includes(key as string)) markChange(db.name, KV_TABLE)
  }
  kv.hook('creating', function (pk, _obj, tx) {
    onKv(pk, tx)
  })
  kv.hook('updating', function (_mods, pk, _obj, tx) {
    onKv(pk, tx)
  })
  kv.hook('deleting', function (pk, _obj, tx) {
    onKv(pk, tx)
  })
}

export interface TrackingSnapshot {
  changes: Counts
  pushed: Counts
  // False when the counters are missing (first run, or localStorage was
  // cleared while IndexedDB survived); the engine then pushes every table.
  tracked: boolean
}

export function trackingSnapshot(dbName: string): TrackingSnapshot {
  const changes = read(changesKey(dbName))
  return { changes: changes ?? {}, pushed: read(pushedKey(dbName)) ?? {}, tracked: changes !== null }
}

export function isDirty(s: TrackingSnapshot, table: string): boolean {
  return (s.changes[table] ?? 0) > (s.pushed[table] ?? 0)
}

export function pendingCount(dbName: string): number {
  const s = trackingSnapshot(dbName)
  let n = 0
  for (const [t, c] of Object.entries(s.changes)) n += Math.max(0, c - (s.pushed[t] ?? 0))
  return n
}

// Records that everything counted in `changes` is now on Drive. Counters that
// moved on since the snapshot stay dirty.
export function markPushed(dbName: string, changes: Counts) {
  const pushed = read(pushedKey(dbName)) ?? {}
  for (const [t, c] of Object.entries(changes)) pushed[t] = Math.max(pushed[t] ?? 0, c)
  write(pushedKey(dbName), pushed)
  // Initialise the changes record so "tracking missing" no longer applies.
  if (!read(changesKey(dbName))) write(changesKey(dbName), { ...changes })
  for (const l of listeners) l(dbName)
}

export function resetTracking(dbName: string) {
  try {
    localStorage.removeItem(changesKey(dbName))
    localStorage.removeItem(pushedKey(dbName))
  } catch {
    /* ignore */
  }
}

export function onLocalChange(cb: (dbName: string) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
