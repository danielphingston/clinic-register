// OP number formats: a template such as `{YY}{N:4}` (260183) or
// `OP-{YYYY}-{N:5}` (OP-2026-00183). Everything outside {…} is fixed text,
// which may be empty. The running number restarts whenever the rest of the
// number changes, so a format with {YY} restarts every year, one with {MM}
// every month, and plain `{N}` never.

export const DEFAULT_OP_FORMAT = 'OP-{YYYY}-{N:5}'

export interface OpToken {
  token: string
  label: string
  meaning: string
  example: string
}

export const OP_TOKENS: OpToken[] = [
  { token: '{YYYY}', label: 'Year', meaning: 'Four-digit year', example: '2026' },
  { token: '{YY}', label: 'Short year', meaning: 'Last two digits of the year', example: '26' },
  { token: '{MM}', label: 'Month', meaning: 'Two-digit month. The number then restarts every month', example: '11' },
  { token: '{N}', label: 'Number', meaning: 'Running number, no padding', example: '183' },
  { token: '{N:4}', label: 'Number, 4 digits', meaning: 'Running number padded with zeros to 4 digits', example: '0183' },
  { token: '{N:5}', label: 'Number, 5 digits', meaning: 'Running number padded with zeros to 5 digits', example: '00183' },
]

export const OP_FORMAT_EXAMPLES: { format: string; note: string }[] = [
  { format: '{YY}{N:4}', note: 'e.g. 183rd patient of the year, restarts each year' },
  { format: 'OP-{YYYY}-{N:5}', note: 'The default' },
  { format: '{YYYY}/{N}', note: 'Restarts each year' },
  { format: '{YY}{MM}{N:3}', note: 'Restarts each month' },
  { format: '{N}', note: 'Never restarts' },
]

const TOKEN_RE = /\{([^{}]*)\}/g
const N_RE = /^N(?::(\d))?$/

type Part = { kind: 'text'; text: string } | { kind: 'date'; name: 'YYYY' | 'YY' | 'MM' } | { kind: 'n'; pad: number }

function parse(format: string): Part[] | string {
  const parts: Part[] = []
  let last = 0
  let ns = 0
  for (const m of format.matchAll(TOKEN_RE)) {
    if (m.index > last) parts.push({ kind: 'text', text: format.slice(last, m.index) })
    last = m.index + m[0].length
    const name = m[1]
    const n = N_RE.exec(name)
    if (n) {
      ns++
      parts.push({ kind: 'n', pad: Number(n[1] ?? 0) })
    } else if (name === 'YYYY' || name === 'YY' || name === 'MM') parts.push({ kind: 'date', name })
    else return `Unknown placeholder {${name}}`
  }
  if (last < format.length) parts.push({ kind: 'text', text: format.slice(last) })
  if (/[{}]/.test(parts.map((p) => (p.kind === 'text' ? p.text : '')).join(''))) return 'Unmatched { or }'
  if (ns === 0) return 'The format needs a running number: {N}, {N:4} or {N:5}'
  if (ns > 1) return 'Use the running number only once'
  return parts
}

// Returns an error message, or null when the format is usable.
export function validateOpFormat(format: string): string | null {
  if (format.length > 40) return 'Keep the format under 40 characters'
  const p = parse(format)
  return typeof p === 'string' ? p : null
}

// A non-blocking hint for formats that read badly, e.g. {YY}{N}: 2610 could be
// case 10 of 2026 or case 610 of 2002.
export function opFormatHint(format: string): string | null {
  const p = parse(format)
  if (typeof p === 'string') return null
  const i = p.findIndex((x) => x.kind === 'n')
  const n = p[i] as Extract<Part, { kind: 'n' }>
  if (n.pad) return null
  const touchesDigits = (x: Part | undefined) => !!x && (x.kind === 'date' || (x.kind === 'text' && /\d/.test(x.text)))
  return touchesDigits(p[i - 1]) || touchesDigits(p[i + 1])
    ? 'Tip: the number sits right next to other digits. Padding it, e.g. {N:4}, keeps every number the same length and easy to read.'
    : null
}

function dateValue(name: 'YYYY' | 'YY' | 'MM', d: Date): string {
  if (name === 'YYYY') return String(d.getFullYear())
  if (name === 'YY') return String(d.getFullYear() % 100).padStart(2, '0')
  return String(d.getMonth() + 1).padStart(2, '0')
}

function partsOrDefault(format: string): Part[] {
  const p = parse(format)
  return typeof p === 'string' ? (parse(DEFAULT_OP_FORMAT) as Part[]) : p
}

export function renderOpNo(format: string, date: Date, n: number): string {
  return partsOrDefault(format)
    .map((x) => (x.kind === 'text' ? x.text : x.kind === 'date' ? dateValue(x.name, date) : String(n).padStart(x.pad, '0')))
    .join('')
}

// What the number looks like apart from the running number, e.g. "26{N:4}"
// in 2026. Numbers in one scope share a counter; a new scope starts at 1.
export function opScope(format: string, date: Date): string {
  return partsOrDefault(format)
    .map((x) => (x.kind === 'text' ? x.text : x.kind === 'date' ? dateValue(x.name, date) : x.pad ? `{N:${x.pad}}` : '{N}'))
    .join('')
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Reads the running number back out of an OP number made with this format in
// the scope of `date`; undefined when the number doesn't fit.
export function opNumberParser(format: string, date: Date): (opNo: string) => number | undefined {
  const parts = partsOrDefault(format)
  const src = parts
    .map((x) => (x.kind === 'text' ? esc(x.text) : x.kind === 'date' ? dateValue(x.name, date) : x.pad ? `(\\d{${x.pad},})` : '(\\d+)'))
    .join('')
  const re = new RegExp(`^${src}$`, 'i')
  const pad = (parts.find((x) => x.kind === 'n') as Extract<Part, { kind: 'n' }>).pad
  return (opNo) => {
    const m = re.exec(opNo.trim())
    if (!m) return undefined
    // A padded number only grows past its padding without a leading zero.
    if (pad && m[1].length > pad && m[1][0] === '0') return undefined
    const n = Number(m[1])
    return Number.isSafeInteger(n) && n > 0 ? n : undefined
  }
}

// Splits any OP number made with this format, whatever its date, into its
// scope and running number; `make(n)` gives number n in the same scope.
// Used to renumber a clash in the scope the clashing number was made in.
export function splitOpNo(format: string, opNo: string): { scope: string; n: number; make: (n: number) => string } | undefined {
  const parts = partsOrDefault(format)
  const src = parts
    .map((x) => (x.kind === 'text' ? esc(x.text) : x.kind === 'date' ? (x.name === 'YYYY' ? '(\\d{4})' : '(\\d{2})') : x.pad ? `(\\d{${x.pad},})` : '(\\d+)'))
    .join('')
  const m = new RegExp(`^${src}$`, 'i').exec(opNo.trim())
  if (!m) return undefined
  const values = m.slice(1)
  const pad = (parts.find((x) => x.kind === 'n') as Extract<Part, { kind: 'n' }>).pad
  let n = 0
  let i = 0
  const pieces: (string | null)[] = parts.map((x) => {
    if (x.kind === 'text') return x.text
    const v = values[i++]
    if (x.kind === 'date') return v
    n = Number(v)
    if (pad && v.length > pad && v[0] === '0') n = NaN
    return null
  })
  if (!Number.isSafeInteger(n) || n < 1) return undefined
  const make = (k: number) => pieces.map((p) => p ?? String(k).padStart(pad, '0')).join('')
  return { scope: pieces.map((p) => p ?? (pad ? `{N:${pad}}` : '{N}')).join(''), n, make }
}

// Settings saved before formats existed only have a prefix.
export function opFormatOf(settings: { opFormat?: string; opPrefix?: string } | undefined): string {
  if (settings?.opFormat !== undefined) return settings.opFormat
  if (settings?.opPrefix !== undefined) return `${settings.opPrefix}-{YYYY}-{N:5}`
  return DEFAULT_OP_FORMAT
}
