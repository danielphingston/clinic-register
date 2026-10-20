import { compressImage } from './image'
import { assertSupported, keptOriginal, mimeOf, type CompressResult } from './logic'

export { sha256Hex } from './hash'
export { CompressError, UNSUPPORTED_MESSAGE, categorize, renameForMime, type CompressResult } from './logic'

export interface CompressOptions {
  keepOriginal?: boolean
}

// Throws CompressError (with a user-facing message) for unsupported or
// unreadable files.
export async function compressFile(file: File, opts: CompressOptions = {}): Promise<CompressResult> {
  const category = assertSupported(file)
  if (category === 'pdf') {
    const { compressPdf, pdfPageCount } = await import('./pdf')
    if (opts.keepOriginal) return keptOriginal(file, 'application/pdf', 'Original kept', await pdfPageCount(file))
    return compressPdf(file)
  }
  if (opts.keepOriginal) return keptOriginal(file, mimeOf(file), 'Original kept')
  return compressImage(file, category === 'heic')
}
