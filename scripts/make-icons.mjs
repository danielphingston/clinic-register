// Generates the PNG app icons in public/ from public/icon.svg.
// Run: node scripts/make-icons.mjs (sharp is a devDependency).
import sharp from 'sharp'
import { readFileSync } from 'node:fs'

const pub = new URL('../public/', import.meta.url)
const svg = readFileSync(new URL('icon.svg', pub), 'utf8')

// Maskable / Apple: full-bleed square (the OS applies its own mask), with the
// cross scaled into the central safe zone (a circle of 40% radius).
const cross = svg.match(/<rect x=[\s\S]*?\/>\s*<rect x=[\s\S]*?\/>/)[0]
const fullBleed = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#17805e"/>
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${cross}</g>
</svg>`

const outputs = [
  ['icon-192.png', svg, 192],
  ['icon-512.png', svg, 512],
  ['icon-maskable-512.png', fullBleed(0.75), 512],
  ['apple-touch-icon.png', fullBleed(0.85), 180],
]

for (const [name, source, size] of outputs) {
  await sharp(Buffer.from(source), { density: 300 }).resize(size, size).png({ compressionLevel: 9 }).toFile(new URL(name, pub).pathname)
  console.log('wrote public/' + name)
}
