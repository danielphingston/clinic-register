const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })
const inrWhole = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

// Whole rupees print without ".00"; anything with paise keeps two decimals.
export function formatINR(amount: number): string {
  return (Number.isInteger(amount) ? inrWhole : inr).format(amount)
}

// Days from `from` to `to` (both ISO dates); negative when `to` is earlier.
export function daysBetween(from: string, to: string): number {
  return Math.round((parseISODate(to).getTime() - parseISODate(from).getTime()) / 86_400_000)
}

const pad = (n: number) => String(n).padStart(2, '0')

// Local calendar date as YYYY-MM-DD. toISOString() would give the UTC date,
// which is the previous day before 05:30 in IST.
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function todayISO(): string {
  return toISODate(new Date())
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso)
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

// 2026-10-20 -> "20 Oct 2026"
export function formatDate(iso?: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${pad(d)} ${MONTHS[m - 1]} ${y}`
}

// Parses a rupee input; blank counts as 0, junk as NaN.
export function parseAmount(s: string): number {
  const t = s.replace(/[,₹\s]/g, '')
  return t === '' ? 0 : Number(t)
}

// 4404019 -> "4.2 MB", 317440 -> "310 KB"
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

// "just now", "5 min ago", "3 h ago", "2 days ago".
export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return d === 1 ? '1 day ago' : `${d} days ago`
}
