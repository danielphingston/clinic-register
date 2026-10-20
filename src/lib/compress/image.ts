import {
  CompressError,
  JPEG_QUALITY,
  WEBP_QUALITY,
  isSmaller,
  keptOriginal,
  mimeOf,
  targetSize,
  type CompressResult,
} from './logic'

const HEIC_MESSAGE =
  "This browser can't read HEIC photos. On iPhone, pick the photo from the Photos library (it converts to JPEG automatically) or set Camera › Formats to Most Compatible."

async function decode(file: Blob, heic: boolean): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new CompressError(heic ? HEIC_MESSAGE : "Couldn't read this image. The file may be damaged.")
  }
}

type Canvas = OffscreenCanvas | HTMLCanvasElement

function makeCanvas(width: number, height: number): Canvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  return c
}

export async function encodeCanvas(canvas: Canvas, type: string, quality: number): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality })
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new CompressError("Couldn't encode the image."))), type, quality),
  )
}

// Browsers that can't encode WebP (older Safari) silently return PNG, so the
// result type is checked rather than trusted.
async function encodeSmallest(canvas: Canvas): Promise<Blob> {
  const webp = await encodeCanvas(canvas, 'image/webp', WEBP_QUALITY)
  if (webp.type === 'image/webp') return webp
  return encodeCanvas(canvas, 'image/jpeg', JPEG_QUALITY)
}

export async function compressImage(file: Blob, heic = false): Promise<CompressResult> {
  const originalMime = mimeOf(file as File)
  const bitmap = await decode(file, heic)
  const { width, height } = targetSize(bitmap.width, bitmap.height)
  const canvas = makeCanvas(width, height)
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!ctx) throw new CompressError("Couldn't process the image on this device.")
  // White under transparent PNGs, so a JPEG fallback doesn't turn them black.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const out = await encodeSmallest(canvas)
  if (!('convertToBlob' in canvas)) canvas.width = 0

  // HEIC is kept converted even if bigger: most browsers can't display it.
  if (!heic && !isSmaller(out.size, file.size)) {
    return keptOriginal(file, originalMime, 'Already small, original kept')
  }
  return { blob: out, mime: out.type, originalSize: file.size, size: out.size, compressed: true }
}
