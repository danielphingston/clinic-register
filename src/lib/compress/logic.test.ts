import { describe, expect, it } from 'vitest'
import { formatBytes } from '../format'
import { sha256Hex } from './hash'
import {
  CompressError,
  PDF_KEEP_UNDER,
  PDF_MAX_PAGES,
  assertSupported,
  categorize,
  isSmaller,
  mimeOf,
  pdfPlan,
  pdfRenderScale,
  renameForMime,
  targetSize,
} from './logic'

describe('targetSize', () => {
  it('scales the long edge to 1600 keeping the aspect ratio', () => {
    expect(targetSize(3000, 4000)).toEqual({ width: 1200, height: 1600 })
    expect(targetSize(4032, 3024)).toEqual({ width: 1600, height: 1200 })
    expect(targetSize(5000, 1000)).toEqual({ width: 1600, height: 320 })
  })
  it('never upscales', () => {
    expect(targetSize(800, 600)).toEqual({ width: 800, height: 600 })
    expect(targetSize(1600, 1600)).toEqual({ width: 1600, height: 1600 })
  })
  it('keeps at least one pixel', () => {
    expect(targetSize(100000, 10)).toEqual({ width: 1600, height: 1 })
  })
})

describe('keep-original rule', () => {
  it('only uses the result when strictly smaller', () => {
    expect(isSmaller(99, 100)).toBe(true)
    expect(isSmaller(100, 100)).toBe(false)
    expect(isSmaller(120, 100)).toBe(false)
  })
})

describe('pdfPlan', () => {
  it('keeps PDFs under 1 MB', () => {
    expect(pdfPlan(PDF_KEEP_UNDER - 1)).toBe('keep-small')
    expect(pdfPlan(PDF_KEEP_UNDER)).toBe('compress')
  })
  it('caps the page count', () => {
    expect(pdfPlan(5e6, PDF_MAX_PAGES)).toBe('compress')
    expect(pdfPlan(5e6, PDF_MAX_PAGES + 1)).toBe('too-many-pages')
    expect(pdfPlan(5e5, 100)).toBe('keep-small')
  })
  it('renders at ~150 DPI, reduced for huge pages', () => {
    expect(pdfRenderScale(595, 842)).toBeCloseTo(150 / 72)
    const s = pdfRenderScale(2384, 3370) // A0
    expect(3370 * s).toBeCloseTo(3000)
  })
})

describe('file allow-list', () => {
  const f = (name: string, type: string) => ({ name, type })
  it('accepts images and PDFs by mime or extension', () => {
    expect(categorize(f('a.jpg', 'image/jpeg'))).toBe('image')
    expect(categorize(f('a.png', 'image/png'))).toBe('image')
    expect(categorize(f('a.webp', 'image/webp'))).toBe('image')
    expect(categorize(f('a.pdf', 'application/pdf'))).toBe('pdf')
    expect(categorize(f('IMG_1.HEIC', ''))).toBe('heic')
    expect(categorize(f('IMG_1.heic', 'image/heic'))).toBe('heic')
    expect(categorize(f('scan.PDF', 'application/octet-stream'))).toBe('pdf')
  })
  it('rejects everything else with a clear message', () => {
    expect(categorize(f('notes.txt', 'text/plain'))).toBeNull()
    expect(categorize(f('a.gif', 'image/gif'))).toBeNull()
    expect(categorize(f('x.docx', ''))).toBeNull()
    expect(categorize(f('fake.pdf', 'text/plain'))).toBeNull()
    expect(() => assertSupported(f('notes.txt', 'text/plain'))).toThrow(CompressError)
    expect(() => assertSupported(f('notes.txt', 'text/plain'))).toThrow(/images.*PDFs/)
  })
  it('derives a mime from the extension when the browser gives none', () => {
    expect(mimeOf(f('IMG.HEIC', ''))).toBe('image/heic')
    expect(mimeOf(f('a.png', 'image/png'))).toBe('image/png')
  })
  it('renames converted files', () => {
    expect(renameForMime('IMG_0001.JPG', 'image/webp')).toBe('IMG_0001.webp')
    expect(renameForMime('report', 'image/jpeg')).toBe('report.jpg')
  })
})

describe('sha256Hex', () => {
  it('hashes blob bytes to lowercase hex', async () => {
    expect(await sha256Hex(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await sha256Hex(new Blob([]))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})

describe('formatBytes', () => {
  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(317440)).toBe('310 KB')
    expect(formatBytes(4.2 * 1024 * 1024)).toBe('4.2 MB')
    expect(formatBytes(15 * 1024 * 1024)).toBe('15 MB')
  })
})
