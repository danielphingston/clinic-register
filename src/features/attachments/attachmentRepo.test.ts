import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/db'
import { createPatient } from '../patients/patientRepo'
import {
  addAttachment,
  attachmentsForPatient,
  attachmentsForVisit,
  deleteAttachment,
  getBlob,
  markBlobSynced,
  missingBlobHashes,
  putDownloadedBlob,
  storageUsage,
  unreferencedBlobHashes,
  unsyncedBlobHashes,
  updateCaption,
} from './attachmentRepo'
import { sha256Hex } from '../../lib/compress/hash'

vi.mock('../../lib/compress', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/compress')>()
  return {
    ...actual,
    // Halves the file to stand in for real compression (needs a browser).
    compressFile: vi.fn(async (file: File, opts: { keepOriginal?: boolean } = {}) => {
      if (!actual.categorize(file)) throw new actual.CompressError(actual.UNSUPPORTED_MESSAGE)
      if (opts.keepOriginal) return { blob: file, mime: file.type, originalSize: file.size, size: file.size, compressed: false }
      const bytes = new Uint8Array(await file.arrayBuffer()).slice(0, Math.ceil(file.size / 2))
      const blob = new Blob([bytes], { type: 'image/webp' })
      return { blob, mime: 'image/webp', originalSize: file.size, size: blob.size, compressed: true }
    }),
  }
})

const jpg = (content: string, name = 'photo.jpg') => new File([content], name, { type: 'image/jpeg' })

let patientId: string
beforeEach(async () => {
  patientId = (await createPatient({ name: 'Asha' })).id
})

describe('attachmentRepo', () => {
  it('stores a compressed blob and its metadata', async () => {
    const { attachment, deduped } = await addAttachment({ patientId, kind: 'lab', file: jpg('x'.repeat(100)), caption: ' CBC ' })
    expect(deduped).toBe(false)
    expect(attachment).toMatchObject({ kind: 'lab', mime: 'image/webp', fileName: 'photo.webp', originalSize: 100, size: 50, caption: 'CBC', deleted: 0 })
    const blob = await getBlob(attachment.blobHash)
    expect(blob?.size).toBe(50)
    expect(attachment.blobHash).toBe(await sha256Hex(blob!))
    expect((await db.blobs.get(attachment.blobHash))?.synced).toBe(0)
  })

  it('dedupes identical files to one blob', async () => {
    const a = await addAttachment({ patientId, kind: 'photo', file: jpg('same-bytes') })
    const b = await addAttachment({ patientId, kind: 'photo', file: jpg('same-bytes', 'copy.jpg') })
    expect(b.deduped).toBe(true)
    expect(a.attachment.blobHash).toBe(b.attachment.blobHash)
    expect(await db.blobs.count()).toBe(1)
    expect(await db.attachments.count()).toBe(2)
    expect((await storageUsage()).totalSize).toBe(a.attachment.size)
  })

  it('keeps the original when asked', async () => {
    const { attachment } = await addAttachment({ patientId, kind: 'photo', file: jpg('abcdef'), keepOriginal: true })
    expect(attachment).toMatchObject({ fileName: 'photo.jpg', mime: 'image/jpeg', size: 6, originalSize: 6 })
  })

  it('rejects unsupported files without writing anything', async () => {
    const txt = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    await expect(addAttachment({ patientId, kind: 'other', file: txt })).rejects.toThrow(/images.*PDFs/)
    expect(await db.attachments.count()).toBe(0)
    expect(await db.blobs.count()).toBe(0)
  })

  it('rejects unknown patients', async () => {
    await expect(addAttachment({ patientId: 'nope', kind: 'lab', file: jpg('a') })).rejects.toThrow('Patient not found')
  })

  it('queries per patient and per visit, newest first, skipping deleted', async () => {
    const other = await createPatient({ name: 'Ravi' })
    const a = await addAttachment({ patientId, kind: 'lab', file: jpg('a') })
    await new Promise((r) => setTimeout(r, 2))
    const b = await addAttachment({ patientId, visitId: 'v1', kind: 'photo', file: jpg('b') })
    await new Promise((r) => setTimeout(r, 2))
    const c = await addAttachment({ patientId, visitId: 'v1', kind: 'photo', file: jpg('c') })
    await addAttachment({ patientId: other.id, visitId: 'v2', kind: 'lab', file: jpg('d') })
    expect((await attachmentsForPatient(patientId)).map((x) => x.id)).toEqual([c.attachment.id, b.attachment.id, a.attachment.id])
    expect((await attachmentsForVisit('v1')).map((x) => x.id)).toEqual([c.attachment.id, b.attachment.id])
    await deleteAttachment(c.attachment.id)
    expect((await attachmentsForVisit('v1')).map((x) => x.id)).toEqual([b.attachment.id])
    expect(await attachmentsForPatient(patientId)).toHaveLength(2)
  })

  it('soft deletes and reports unreferenced blobs', async () => {
    const a = await addAttachment({ patientId, kind: 'lab', file: jpg('one') })
    const b = await addAttachment({ patientId, kind: 'lab', file: jpg('two') })
    const dup = await addAttachment({ patientId, kind: 'lab', file: jpg('two') })
    await deleteAttachment(a.attachment.id)
    await deleteAttachment(b.attachment.id)
    const rec = await db.attachments.get(a.attachment.id)
    expect(rec?.deleted).toBe(1)
    expect(await getBlob(a.attachment.blobHash)).toBeDefined()
    // "two" is still used by the duplicate attachment.
    expect(await unreferencedBlobHashes()).toEqual([a.attachment.blobHash])
    await deleteAttachment(dup.attachment.id)
    expect((await unreferencedBlobHashes()).sort()).toEqual([a.attachment.blobHash, b.attachment.blobHash].sort())
    expect(await storageUsage()).toMatchObject({ count: 0, totalSize: 0 })
  })

  it('edits captions', async () => {
    const { attachment } = await addAttachment({ patientId, kind: 'lab', file: jpg('a'), caption: 'old' })
    await updateCaption(attachment.id, '  Thyroid profile ')
    expect((await db.attachments.get(attachment.id))?.caption).toBe('Thyroid profile')
    await updateCaption(attachment.id, '')
    expect((await db.attachments.get(attachment.id))?.caption).toBeUndefined()
  })

  it('returns undefined for blobs not on this device and lists them as missing', async () => {
    const { attachment } = await addAttachment({ patientId, kind: 'lab', file: jpg('remote') })
    await db.blobs.delete(attachment.blobHash)
    expect(await getBlob(attachment.blobHash)).toBeUndefined()
    expect(await missingBlobHashes()).toEqual([attachment.blobHash])
    const blob = new Blob(['rem'], { type: 'image/webp' })
    await expect(putDownloadedBlob('bad', blob)).rejects.toThrow('does not match')
    await putDownloadedBlob(attachment.blobHash, blob)
    expect(await missingBlobHashes()).toEqual([])
    expect(await unsyncedBlobHashes()).toEqual([])
  })

  it('tracks the upload flag for sync', async () => {
    const { attachment } = await addAttachment({ patientId, kind: 'lab', file: jpg('up') })
    expect(await unsyncedBlobHashes()).toEqual([attachment.blobHash])
    await markBlobSynced(attachment.blobHash)
    expect(await unsyncedBlobHashes()).toEqual([])
  })

  it('reports storage usage', async () => {
    await addAttachment({ patientId, kind: 'lab', file: jpg('x'.repeat(40)) })
    await addAttachment({ patientId, kind: 'lab', file: jpg('y'.repeat(20)) })
    expect(await storageUsage()).toMatchObject({ count: 2, totalSize: 30, originalSize: 60 })
  })
})
