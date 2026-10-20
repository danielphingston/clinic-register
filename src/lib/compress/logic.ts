// Pure decisions for attachment compression, kept apart from the browser
// codecs so they can be unit tested.

export const MAX_IMAGE_EDGE = 1600
export const WEBP_QUALITY = 0.75
export const JPEG_QUALITY = 0.8
export const PDF_KEEP_UNDER = 1024 * 1024
export const PDF_MAX_PAGES = 30
export const PDF_DPI = 150
export const PDF_JPEG_QUALITY = 0.7
// Guards against huge page sizes (posters, A0 scans) blowing up canvas memory.
export const PDF_MAX_PAGE_PX = 3000

export interface CompressResult {
  blob: Blob
  mime: string
  originalSize: number
  size: number
  compressed: boolean
  note?: string
  pages?: number
}

export class CompressError extends Error {}

export type FileCategory = 'image' | 'heic' | 'pdf'

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp']
const HEIC_MIMES = ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']
const EXT_CATEGORY: Record<string, FileCategory> = {
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  webp: 'image',
  heic: 'heic',
  heif: 'heic',
  pdf: 'pdf',
}
const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
}

function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name)
  return m ? m[1].toLowerCase() : ''
}

// Some platforms (notably for HEIC) hand over an empty or generic type, so
// the extension is the fallback.
export function categorize(file: { name: string; type: string }): FileCategory | null {
  const type = file.type.toLowerCase()
  if (IMAGE_MIMES.includes(type)) return 'image'
  if (HEIC_MIMES.includes(type)) return 'heic'
  if (type === 'application/pdf') return 'pdf'
  if (type && type !== 'application/octet-stream') return null
  return EXT_CATEGORY[extOf(file.name)] ?? null
}

export function mimeOf(file: { name: string; type: string }): string {
  const t = file.type.toLowerCase()
  return t && t !== 'application/octet-stream' ? t : (EXT_MIME[extOf(file.name)] ?? 'application/octet-stream')
}

export const UNSUPPORTED_MESSAGE = 'Only images (JPEG, PNG, WebP, HEIC) and PDFs can be attached.'

export function assertSupported(file: { name: string; type: string }): FileCategory {
  const c = categorize(file)
  if (!c) throw new CompressError(UNSUPPORTED_MESSAGE)
  return c
}

// Scales so the long edge is at most `max`, keeping the aspect ratio. Never upscales.
export function targetSize(width: number, height: number, max = MAX_IMAGE_EDGE): { width: number; height: number } {
  const long = Math.max(width, height)
  if (long <= max) return { width, height }
  const scale = max / long
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export function isSmaller(candidateSize: number, originalSize: number): boolean {
  return candidateSize < originalSize
}

export type PdfPlan = 'keep-small' | 'too-many-pages' | 'compress'

export function pdfPlan(size: number, pages?: number): PdfPlan {
  if (size < PDF_KEEP_UNDER) return 'keep-small'
  if (pages !== undefined && pages > PDF_MAX_PAGES) return 'too-many-pages'
  return 'compress'
}

// Render scale (pdf.js units are 72 per inch) for ~150 DPI, reduced if the
// page would exceed the pixel cap.
export function pdfRenderScale(pageWidthPt: number, pageHeightPt: number, dpi = PDF_DPI, maxPx = PDF_MAX_PAGE_PX): number {
  const scale = dpi / 72
  const long = Math.max(pageWidthPt, pageHeightPt) * scale
  return long > maxPx ? (scale * maxPx) / long : scale
}

// "scan.jpg" stored as WebP should download as "scan.webp".
export function renameForMime(name: string, mime: string): string {
  const ext = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' }[mime]
  if (!ext) return name
  const base = name.replace(/\.[a-z0-9]+$/i, '') || 'file'
  return `${base}.${ext}`
}

export function keptOriginal(file: Blob, mime: string, note?: string, pages?: number): CompressResult {
  return { blob: file, mime, originalSize: file.size, size: file.size, compressed: false, note, pages }
}
