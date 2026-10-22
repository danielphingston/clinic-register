// Turns a photo or scan of a signature or rubber stamp into ink on a
// transparent background, so it prints like it was signed on the page.
//
// 1. Estimate the paper brightness around each pixel (photos have shadows
//    and uneven light) and divide it out, so the paper becomes pure white.
// 2. Opacity follows how much darker than the paper a pixel is: paper is
//    fully transparent and faint stroke edges stay partly visible.
// 3. Recolour to one ink colour, or keep the original hue (stamps).
// 4. Crop to the ink.

export type RGB = [number, number, number]

export interface InkOptions {
  // 0–1. Higher keeps fainter strokes (and more noise).
  strength: number
  // null keeps the original colours.
  color: RGB | null
}

export interface Pixels {
  data: Uint8ClampedArray
  width: number
  height: number
}

export const INK_COLORS: { label: string; value: RGB | null }[] = [
  { label: 'Blue ink', value: [22, 40, 120] },
  { label: 'Black ink', value: [20, 20, 24] },
  { label: 'Original colour', value: null },
]

export class InkError extends Error {}

const luma = (d: Uint8ClampedArray, i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]

function percentile(values: number[], p: number): number {
  if (!values.length) return 255
  values.sort((a, b) => a - b)
  return values[Math.min(values.length - 1, Math.floor(values.length * p))]
}

// Paper brightness per pixel: the 90th-percentile luma of a coarse grid of
// blocks (ink is sparse, so most of each block is paper), interpolated
// bilinearly between block centres.
function paperBrightness({ data, width, height }: Pixels): Float32Array {
  const block = Math.max(8, Math.round(Math.max(width, height) / 16))
  const gw = Math.ceil(width / block)
  const gh = Math.ceil(height / block)
  const all: number[] = []
  for (let i = 0; i < data.length; i += 16) all.push(luma(data, i))
  // A block that is mostly ink (a thick stamp) mustn't count as dark paper.
  const floor = percentile(all, 0.9) * 0.7
  const grid = new Float32Array(gw * gh)
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const vals: number[] = []
      for (let y = gy * block; y < Math.min(height, (gy + 1) * block); y++)
        for (let x = gx * block; x < Math.min(width, (gx + 1) * block); x++) vals.push(luma(data, (y * width + x) * 4))
      grid[gy * gw + gx] = Math.max(floor, percentile(vals, 0.9), 1)
    }
  }
  const out = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / block - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(gh - 1, y0 + 1)
    const ty = fy - y0
    for (let x = 0; x < width; x++) {
      const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / block - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(gw - 1, x0 + 1)
      const tx = fx - x0
      const top = grid[y0 * gw + x0] * (1 - tx) + grid[y0 * gw + x1] * tx
      const bottom = grid[y1 * gw + x0] * (1 - tx) + grid[y1 * gw + x1] * tx
      out[y * width + x] = top * (1 - ty) + bottom * ty
    }
  }
  return out
}

const PAD = 8

export function extractInk(src: Pixels, opts: InkOptions): Pixels {
  const { data, width, height } = src
  const paper = paperBrightness(src)
  const s = Math.min(1, Math.max(0, opts.strength))
  // Darkness below `low` is paper grain and shadow; above `high` is solid ink.
  const low = 0.25 - 0.2 * s
  const high = low + 0.35
  const out = new Uint8ClampedArray(data.length)
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      const i = p * 4
      const bg = paper[p]
      const dark = 1 - Math.min(1, luma(data, i) / bg)
      const t = Math.min(1, Math.max(0, (dark - low) / (high - low)))
      // Smoothstep keeps stroke edges soft rather than jagged.
      const alpha = Math.round(t * t * (3 - 2 * t) * (data[i + 3] / 255) * 255)
      if (opts.color) {
        out[i] = opts.color[0]
        out[i + 1] = opts.color[1]
        out[i + 2] = opts.color[2]
      } else {
        // Original hue with the paper's tint divided out, slightly deepened.
        for (let c = 0; c < 3; c++) out[i + c] = Math.min(255, (data[i + c] * 255) / bg) * 0.85
      }
      out[i + 3] = alpha
      if (alpha > 24) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) throw new InkError('No ink found in this image. Try a darker photo, or raise the strength.')
  return crop({ data: out, width, height }, Math.max(0, minX - PAD), Math.max(0, minY - PAD), Math.min(width - 1, maxX + PAD), Math.min(height - 1, maxY + PAD))
}

function crop(src: Pixels, x0: number, y0: number, x1: number, y1: number): Pixels {
  const width = x1 - x0 + 1
  const height = y1 - y0 + 1
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const from = ((y0 + y) * src.width + x0) * 4
    data.set(src.data.subarray(from, from + width * 4), y * width * 4)
  }
  return { data, width, height }
}

// ---- browser side (canvas) ----

// Decodes an image file, scaled so its longer side is at most maxSide.
export async function loadPixels(file: Blob, maxSide: number): Promise<Pixels> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new InkError("Couldn't read this image. Use a JPEG, PNG or WebP photo.")
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new InkError("Couldn't process the image on this device.")
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const { data } = ctx.getImageData(0, 0, width, height)
  return { data, width, height }
}

export function pixelsToPngDataUrl({ data, width, height }: Pixels): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new InkError("Couldn't process the image on this device.")
  ctx.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0)
  return canvas.toDataURL('image/png')
}
