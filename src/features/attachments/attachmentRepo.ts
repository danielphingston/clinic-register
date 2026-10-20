import { db, type ClinicDB } from '../../db/db'
import { newRecord, update, softDelete } from '../../db/repo'
import type { Attachment, AttachmentKind } from '../../db/types'
import { compressFile, renameForMime, sha256Hex, type CompressResult } from '../../lib/compress'

export const KIND_LABEL: Record<AttachmentKind, string> = { lab: 'Lab report', photo: 'Photo', other: 'Other' }
export const ATTACHMENT_KINDS = Object.keys(KIND_LABEL) as AttachmentKind[]

export class AttachmentError extends Error {}

export interface AddAttachmentInput {
  patientId: string
  visitId?: string
  kind: AttachmentKind
  file: File
  caption?: string
  keepOriginal?: boolean
}

export interface AddAttachmentResult {
  attachment: Attachment
  result: CompressResult
  // The same bytes were already stored, so no new blob was written.
  deduped: boolean
}

// Compression runs first: IndexedDB transactions auto-commit across the
// awaits a canvas/pdf.js pipeline needs, so only the writes share the tx.
export async function addAttachment(input: AddAttachmentInput): Promise<AddAttachmentResult> {
  const patient = await db.patients.get(input.patientId)
  if (!patient || patient.deleted) throw new AttachmentError('Patient not found')
  const result = await compressFile(input.file, { keepOriginal: input.keepOriginal })
  const hash = await sha256Hex(result.blob)
  const attachment = newRecord<Attachment>({
    patientId: input.patientId,
    ...(input.visitId ? { visitId: input.visitId } : {}),
    kind: input.kind,
    mime: result.mime,
    fileName: result.compressed ? renameForMime(input.file.name, result.mime) : input.file.name,
    originalSize: result.originalSize,
    size: result.size,
    blobHash: hash,
    ...(input.caption?.trim() ? { caption: input.caption.trim() } : {}),
    ...(result.pages ? { pages: result.pages } : {}),
  })
  let deduped = false
  await db.transaction('rw', db.attachments, db.blobs, async () => {
    // Blobs are write-once: an existing hash is never overwritten.
    if (await db.blobs.get(hash)) deduped = true
    else await db.blobs.add({ hash, blob: result.blob, synced: 0 })
    await db.attachments.add(attachment)
  })
  return { attachment, result, deduped }
}

export async function updateCaption(id: string, caption: string): Promise<void> {
  const trimmed = caption.trim()
  await update(db.attachments, id, { caption: trimmed || undefined })
}

// Soft delete only; the blob stays until Phase 7 garbage-collects
// unreferencedBlobHashes() (after sync, so other devices see the tombstone).
export async function deleteAttachment(id: string): Promise<void> {
  await softDelete(db.attachments, id)
}

const newestFirst = (a: Attachment, b: Attachment) => b.createdAt - a.createdAt

export async function attachmentsForPatient(patientId: string): Promise<Attachment[]> {
  const list = await db.attachments.where('patientId').equals(patientId).filter((a) => a.deleted === 0).toArray()
  return list.sort(newestFirst)
}

export async function attachmentsForVisit(visitId: string): Promise<Attachment[]> {
  const list = await db.attachments.where('visitId').equals(visitId).filter((a) => a.deleted === 0).toArray()
  return list.sort(newestFirst)
}

// undefined = not on this device yet (e.g. synced metadata whose file hasn't
// been downloaded from Drive).
export async function getBlob(hash: string): Promise<Blob | undefined> {
  return (await db.blobs.get(hash))?.blob
}

// The blob helpers take an optional db so the sync engine can run against
// another instance (tests simulate a second device with its own database).
async function liveHashes(d: ClinicDB = db): Promise<Set<string>> {
  const live = await d.attachments.where('deleted').equals(0).toArray()
  return new Set(live.map((a) => a.blobHash))
}

export async function unreferencedBlobHashes(d: ClinicDB = db): Promise<string[]> {
  const live = await liveHashes(d)
  const all = (await d.blobs.toCollection().primaryKeys()) as string[]
  return all.filter((h) => !live.has(h))
}

// ---- for Phase 7 (Drive sync) ----

export async function unsyncedBlobHashes(d: ClinicDB = db): Promise<string[]> {
  return (await d.blobs.where('synced').equals(0).primaryKeys()) as string[]
}

export async function markBlobSynced(hash: string, d: ClinicDB = db): Promise<void> {
  // get + put rather than update(): the stored Blob object is passed through
  // untouched instead of being cloned by Dexie's modify path.
  await d.transaction('rw', d.blobs, async () => {
    const row = await d.blobs.get(hash)
    if (row && !row.synced) await d.blobs.put({ ...row, synced: 1 })
  })
}

// Hashes referenced by live attachments but absent locally.
export async function missingBlobHashes(d: ClinicDB = db): Promise<string[]> {
  const live = [...(await liveHashes(d))]
  const have = await d.blobs.bulkGet(live)
  return live.filter((_, i) => !have[i])
}

// Stores a blob fetched from Drive after checking it matches its address.
export async function putDownloadedBlob(hash: string, blob: Blob, d: ClinicDB = db): Promise<void> {
  if ((await sha256Hex(blob)) !== hash) throw new AttachmentError('Downloaded file does not match its hash')
  await d.transaction('rw', d.blobs, async () => {
    if (!(await d.blobs.get(hash))) await d.blobs.add({ hash, blob, synced: 1 })
  })
}

export async function removeBlob(hash: string, d: ClinicDB = db): Promise<void> {
  await d.transaction('rw', d.attachments, d.blobs, async () => {
    const live = await liveHashes(d)
    if (live.has(hash)) throw new AttachmentError('Blob is still referenced')
    await d.blobs.delete(hash)
  })
}

export interface StorageUsage {
  count: number
  // Distinct stored bytes of live attachments (deduped files count once).
  totalSize: number
  originalSize: number
  usage?: number
  quota?: number
}

export async function storageUsage(): Promise<StorageUsage> {
  const live = await db.attachments.where('deleted').equals(0).toArray()
  const seen = new Set<string>()
  let totalSize = 0
  let originalSize = 0
  for (const a of live) {
    originalSize += a.originalSize
    if (seen.has(a.blobHash)) continue
    seen.add(a.blobHash)
    totalSize += a.size
  }
  let usage: number | undefined
  let quota: number | undefined
  try {
    const est = await navigator.storage?.estimate?.()
    usage = est?.usage
    quota = est?.quota
  } catch {
    // estimate() is unavailable in some private modes
  }
  return { count: live.length, totalSize, originalSize, usage, quota }
}
