import { db as appDb, type ClinicDB } from '../db/db'
import { sha256Hex } from '../lib/compress/hash'
import { addNotices, applyRecords, bumpCounters, newTouched, recomputeDerived } from './apply'
import { fromBase64, toBase64 } from './crypto'
import { ALL_TABLES } from './engine'
import { SYNCED_KV_KEYS } from './tracking'
import type { RenumberNotice, SyncTableName } from './types'

// A JSON backup file: the same record sets that sync to Drive, optionally
// with attachment files base64-encoded. Importing merges (never overwrites),
// using the sync merge rules, so it is safe to import an older backup.

export const BACKUP_FORMAT = 'clinic-register-backup'

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  schema: 1
  exportedAt: string
  tables: Partial<Record<SyncTableName, unknown[]>>
  blobs?: Record<string, { mime: string; data: string }>
}

export class BackupError extends Error {}

export interface ExportResult {
  json: string
  records: number
  files: number
  // Live attachments whose file isn't on this device (not downloaded yet).
  missingFiles: number
}

export async function exportBackup(opts: { includeAttachments: boolean }, d: ClinicDB = appDb): Promise<ExportResult> {
  const tables: BackupFile['tables'] = {}
  let records = 0
  for (const t of ALL_TABLES) {
    const rows = t === 'kv' ? (await d.kv.bulkGet(SYNCED_KV_KEYS)).filter(Boolean) : await d.table(t).toArray()
    tables[t] = rows
    records += rows.length
  }
  const out: BackupFile = { format: BACKUP_FORMAT, schema: 1, exportedAt: new Date().toISOString(), tables }
  let files = 0
  let missingFiles = 0
  if (opts.includeAttachments) {
    out.blobs = {}
    const live = await d.attachments.where('deleted').equals(0).toArray()
    for (const a of live) {
      if (out.blobs[a.blobHash]) continue
      const row = await d.blobs.get(a.blobHash)
      if (!row) {
        missingFiles++
        continue
      }
      out.blobs[a.blobHash] = { mime: a.mime, data: toBase64(new Uint8Array(await row.blob.arrayBuffer())) }
      files++
    }
  }
  return { json: JSON.stringify(out), records, files, missingFiles }
}

export interface ImportResult {
  written: number
  files: number
  renumbered: RenumberNotice[]
}

export async function importBackup(text: string, d: ClinicDB = appDb): Promise<ImportResult> {
  let parsed: BackupFile
  try {
    parsed = JSON.parse(text) as BackupFile
  } catch {
    throw new BackupError('This is not a backup file (it is not valid JSON).')
  }
  if (parsed?.format !== BACKUP_FORMAT || typeof parsed.tables !== 'object') {
    throw new BackupError('This is not a Clinic Register backup file.')
  }
  if (parsed.schema > 1) throw new BackupError('This backup was made by a newer version of the app.')

  const touched = newTouched()
  const notices: RenumberNotice[] = []
  const now = Date.now()
  let written = 0
  for (const t of ALL_TABLES) {
    const rows = parsed.tables[t]
    if (!Array.isArray(rows) || !rows.length) continue
    // Untagged: imported records are local changes and get pushed to Drive.
    const r = await applyRecords(d, t, rows, { tag: false, now, touched, notices })
    written += r.written
  }
  await recomputeDerived(d, touched)
  await bumpCounters(d)
  await addNotices(d, notices)

  let files = 0
  for (const [hash, b] of Object.entries(parsed.blobs ?? {})) {
    if (await d.blobs.get(hash)) continue
    let blob: Blob
    try {
      blob = new Blob([fromBase64(b.data)], { type: b.mime })
    } catch {
      continue
    }
    // A corrupt entry (hash mismatch) is skipped; the rest still import.
    if ((await sha256Hex(blob)) !== hash) continue
    // synced: 0 so the next Drive sync uploads it.
    await d.blobs.put({ hash, blob, synced: 0 })
    files++
  }
  return { written, files, renumbered: notices }
}
