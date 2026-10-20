import { db } from '../../db/db'
import { insert, softDelete, update } from '../../db/repo'
import type { Remedy } from '../../db/types'
import seed from '../../data/remedies.json'

export const REMEDY_SEED_FLAG = 'seed:remedies:v1'

// Seeded remedies get deterministic ids so two devices seeding independently
// produce the same records instead of duplicates once sync merges them.
export function seedRemedyId(name: string): string {
  return 'rem-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export async function seedRemedies(): Promise<number> {
  return db.transaction('rw', db.remedies, db.kv, async () => {
    if (await db.kv.get(REMEDY_SEED_FLAG)) return 0
    const now = Date.now()
    const existing = new Set((await db.remedies.toCollection().primaryKeys()) as string[])
    const rows: Remedy[] = (seed as { name: string; abbrev?: string }[])
      .map((r) => ({
        id: seedRemedyId(r.name),
        name: r.name,
        abbrev: r.abbrev,
        isCustom: 0 as const,
        createdAt: now,
        // 0, not now: a seed must never win a sync merge against a real edit
        // (e.g. a device that seeded offline before restoring from Drive).
        updatedAt: 0,
        deleted: 0 as const,
      }))
      .filter((r) => !existing.has(r.id))
    await db.remedies.bulkAdd(rows)
    await db.kv.put({ key: REMEDY_SEED_FLAG, value: true, updatedAt: now })
    return rows.length
  })
}

// Prefix matches (name or abbreviation) first, then word-prefix matches inside
// the name, then any substring. Ties sort alphabetically.
export function searchRemedies(remedies: Remedy[], query: string, limit = 20): Remedy[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const scored: { r: Remedy; score: number }[] = []
  for (const r of remedies) {
    if (r.deleted) continue
    const name = r.name.toLowerCase()
    const abbrev = (r.abbrev ?? '').toLowerCase()
    let score = -1
    if (name.startsWith(q) || abbrev.startsWith(q)) score = 0
    else if (name.split(/[\s-]+/).some((w) => w.startsWith(q))) score = 1
    else if (name.includes(q) || abbrev.includes(q)) score = 2
    if (score >= 0) scored.push({ r, score })
  }
  scored.sort((a, b) => a.score - b.score || a.r.name.localeCompare(b.r.name))
  return scored.slice(0, limit).map((s) => s.r)
}

export function remedyLabel(r?: Pick<Remedy, 'name' | 'abbrev'>): string {
  if (!r) return ''
  return r.abbrev ? `${r.name} (${r.abbrev})` : r.name
}

export async function listRemedies(): Promise<Remedy[]> {
  const all = await db.remedies.where('deleted').equals(0).toArray()
  return all.sort((a, b) => a.name.localeCompare(b.name))
}

// Includes deleted remedies so old prescriptions still show their names.
export async function remedyMap(): Promise<Map<string, Remedy>> {
  return new Map((await db.remedies.toArray()).map((r) => [r.id, r]))
}

async function assertUniqueName(name: string, exceptId?: string) {
  const lower = name.toLowerCase()
  const clash = await db.remedies
    .where('deleted')
    .equals(0)
    .filter((r) => r.id !== exceptId && r.name.toLowerCase() === lower)
    .first()
  if (clash) throw new Error(`"${clash.name}" already exists`)
}

export async function addCustomRemedy(name: string, abbrev?: string): Promise<Remedy> {
  const n = name.trim()
  if (!n) throw new Error('Name is required')
  await assertUniqueName(n)
  return insert<Remedy>(db.remedies, { name: n, abbrev: abbrev?.trim() || undefined, isCustom: 1 })
}

export async function editRemedy(id: string, name: string, abbrev?: string): Promise<void> {
  const n = name.trim()
  if (!n) throw new Error('Name is required')
  await assertUniqueName(n, id)
  await update<Remedy>(db.remedies, id, { name: n, abbrev: abbrev?.trim() || undefined })
}

export function deleteRemedy(id: string): Promise<void> {
  return softDelete(db.remedies, id)
}
