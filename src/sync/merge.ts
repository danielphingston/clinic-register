// Record-level last-writer-wins merge. Pure functions; the engine applies the
// result to Dexie.

export interface SyncRecord {
  updatedAt: number
  deleted?: 0 | 1
  [k: string]: unknown
}

// JSON with sorted keys, so two copies of a record compare equal no matter
// how their keys were ordered (and `undefined` fields are ignored, as JSON
// drops them).
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : stableStringify(x))).join(',')}]`
  const obj = v as Record<string, unknown>
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

export function sameRecord(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b)
}

// Newer updatedAt wins. On a tie a tombstone wins (a delete is never undone
// by a concurrent edit stamped the same millisecond); otherwise the larger
// canonical JSON wins, so every device picks the same record.
export function pickWinner<T extends SyncRecord>(a: T, b: T): T {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b
  const ad = a.deleted === 1
  const bd = b.deleted === 1
  if (ad !== bd) return ad ? a : b
  return stableStringify(a) >= stableStringify(b) ? a : b
}

export function mergeRecords<T extends SyncRecord>(local: T[], remote: T[], idOf: (r: T) => string = (r) => r.id as string): T[] {
  const out = new Map<string, T>()
  for (const r of [...local, ...remote]) {
    const id = idOf(r)
    const cur = out.get(id)
    out.set(id, cur ? pickWinner(cur, r) : r)
  }
  return [...out.values()]
}

export interface MergeDiff<T> {
  // Records to write locally: remote winners that differ from the local copy.
  toWrite: T[]
  // Local has something the remote set lacks (a local-only record, or a local
  // winner that differs from the remote copy), so the table must be pushed.
  localNewer: boolean
}

export function diffMerge<T extends SyncRecord>(local: T[], remote: T[], idOf: (r: T) => string = (r) => r.id as string): MergeDiff<T> {
  const localById = new Map(local.map((r) => [idOf(r), r]))
  // Collapse duplicates inside the remote set first (several remote files can
  // be merged at once).
  const remoteById = new Map<string, T>()
  for (const r of remote) {
    const id = idOf(r)
    const cur = remoteById.get(id)
    remoteById.set(id, cur ? pickWinner(cur, r) : r)
  }
  const toWrite: T[] = []
  let localNewer = false
  for (const [id, r] of remoteById) {
    const l = localById.get(id)
    if (!l) {
      toWrite.push(r)
      continue
    }
    if (sameRecord(l, r)) continue
    const w = pickWinner(l, r)
    if (w === l) localNewer = true
    else toWrite.push(r)
  }
  if (!localNewer) for (const id of localById.keys()) if (!remoteById.has(id)) localNewer = true
  return { toWrite, localNewer }
}
