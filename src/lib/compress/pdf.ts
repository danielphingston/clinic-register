// Loaded only through dynamic import() so pdf.js and pdf-lib stay in their
// own lazy chunk.
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { PDFDocument } from 'pdf-lib'
import { encodeCanvas } from './image'
import {
  CompressError,
  PDF_JPEG_QUALITY,
  PDF_MAX_PAGES,
  isSmaller,
  keptOriginal,
  pdfPlan,
  pdfRenderScale,
  type CompressResult,
} from './logic'

GlobalWorkerOptions.workerSrc = workerUrl

// Decoders for JBIG2/JPEG 2000 scans; served by the pdfjsWasm plugin in vite.config.ts.
const WASM_URL = `${import.meta.env.BASE_URL}pdfjs-wasm/`

export async function pdfPageCount(file: Blob): Promise<number | undefined> {
  try {
    const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true, updateMetadata: false })
    return doc.getPageCount()
  } catch {
    return undefined
  }
}

export async function compressPdf(file: Blob): Promise<CompressResult> {
  const mime = 'application/pdf'
  if (pdfPlan(file.size) === 'keep-small') return keptOriginal(file, mime, undefined, await pdfPageCount(file))

  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()), wasmUrl: WASM_URL })
  let doc
  try {
    doc = await task.promise
  } catch (err) {
    const name = (err as Error)?.name
    if (name === 'PasswordException') return keptOriginal(file, mime, 'Password-protected PDF, original kept')
    throw new CompressError("Couldn't read this PDF. The file may be damaged.")
  }
  try {
    const pages = doc.numPages
    if (pdfPlan(file.size, pages) === 'too-many-pages') {
      return keptOriginal(file, mime, `More than ${PDF_MAX_PAGES} pages, original kept`, pages)
    }
    // No timestamps, so the same input rebuilds to identical bytes and dedupes.
    const out = await PDFDocument.create({ updateMetadata: false })
    const canvas = document.createElement('canvas')
    try {
      for (let n = 1; n <= pages; n++) {
        const page = await doc.getPage(n)
        // Includes the page's /Rotate, so sizes match how the page displays.
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: pdfRenderScale(base.width, base.height) })
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        await page.render({ canvas, viewport }).promise
        const jpeg = await encodeCanvas(canvas, 'image/jpeg', PDF_JPEG_QUALITY)
        const img = await out.embedJpg(new Uint8Array(await jpeg.arrayBuffer()))
        out.addPage([base.width, base.height]).drawImage(img, { x: 0, y: 0, width: base.width, height: base.height })
        page.cleanup()
      }
    } finally {
      canvas.width = 0
      canvas.height = 0
    }
    const bytes = await out.save()
    if (!isSmaller(bytes.byteLength, file.size)) return keptOriginal(file, mime, 'Already compact, original kept', pages)
    return {
      blob: new Blob([bytes as BlobPart], { type: mime }),
      mime,
      originalSize: file.size,
      size: bytes.byteLength,
      compressed: true,
      pages,
      note: 'Pages saved as images; text is no longer selectable',
    }
  } finally {
    await task.destroy()
  }
}
