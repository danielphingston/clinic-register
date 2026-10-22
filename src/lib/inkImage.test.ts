import { describe, expect, it } from 'vitest'
import { extractInk, InkError, type Pixels } from './inkImage'

// A grey "paper" that gets darker towards the right (a shadow), with a dark
// stroke in the middle.
function photo(width = 120, height = 60): Pixels {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const paper = 230 - (x / width) * 70
      const ink = y >= 28 && y < 32 && x >= 30 && x < 90
      const v = ink ? paper * 0.3 : paper
      data[i] = v
      data[i + 1] = v
      data[i + 2] = ink ? v + 40 : v
      data[i + 3] = 255
    }
  }
  return { data, width, height }
}

const alphaAt = (p: Pixels, x: number, y: number) => p.data[(y * p.width + x) * 4 + 3]

describe('extractInk', () => {
  it('makes shadowed paper transparent and keeps the stroke opaque', () => {
    const out = extractInk(photo(), { strength: 0.5, color: [22, 40, 120] })
    // Cropped to the stroke plus padding.
    expect(out.width).toBe(60 + 16)
    expect(out.height).toBe(4 + 16)
    expect(alphaAt(out, 0, 0)).toBe(0)
    expect(alphaAt(out, out.width - 1, out.height - 1)).toBe(0)
    expect(alphaAt(out, 10, 10)).toBe(255)
    expect(alphaAt(out, out.width - 10, 10)).toBe(255)
    expect([...out.data.slice((10 * out.width + 10) * 4, (10 * out.width + 10) * 4 + 3)]).toEqual([22, 40, 120])
  })

  it('keeps the original hue when no colour is chosen', () => {
    const out = extractInk(photo(), { strength: 0.5, color: null })
    const i = (10 * out.width + 10) * 4
    expect(out.data[i + 2]).toBeGreaterThan(out.data[i])
  })

  it('rejects an image with no ink', () => {
    const blank = photo()
    for (let i = 0; i < blank.data.length; i += 4) blank.data.fill(200, i, i + 3)
    expect(() => extractInk(blank, { strength: 0.5, color: null })).toThrow(InkError)
  })
})
