import type { CaseNotes, ComplaintDetail, ComplaintStatus, ComplaintStatusValue, GeneralsChecklist, Level, UrineOption } from '../../db/types'

export const LEVELS: { value: Level; label: string }[] = [
  { value: 'increased', label: 'Increased' },
  { value: 'decreased', label: 'Decreased' },
  { value: 'normal', label: 'Normal' },
]

export const URINE_OPTIONS: { value: UrineOption; label: string }[] = [
  { value: 'anuria', label: 'Anuria' },
  { value: 'oliguria', label: 'Oliguria' },
  { value: 'frequent', label: 'Frequent micturition' },
  { value: 'nocturnal', label: 'Nocturnal urination' },
  { value: 'normal', label: 'Normal' },
]

export const SLEEP_OPTIONS = [
  { value: 'sound', label: 'Sound' },
  { value: 'disturbed', label: 'Disturbed' },
  { value: 'sleeplessness', label: 'Sleeplessness' },
] as const

export const STOOL_OPTIONS = [
  { value: 'regular', label: 'Regular' },
  { value: 'irregular', label: 'Irregular' },
  { value: 'constipation', label: 'Constipation' },
] as const

export const STATUS_OPTIONS: { value: ComplaintStatusValue; label: string }[] = [
  { value: 'persists', label: 'Persists' },
  { value: 'better', label: 'Better' },
  { value: 'worse', label: 'Worsened' },
  { value: 'resolved', label: 'Resolved' },
]

// Tap-to-pick terms for the Worse (<) and Better (>) modalities.
export const MODALITY_QUICK_PICKS = ['Morning', 'Evening', 'Night', 'Cold', 'Heat', 'Damp weather', 'Open air', 'Motion', 'Rest', 'Lying down', 'Pressure', 'Touch', 'Eating', 'Sun', 'Noise']

export const DETAIL_FIELDS = ['location', 'sensation', 'duration', 'worse', 'better', 'concomitants', 'note'] as const

const label = (opts: readonly { value: string; label: string }[], v: string) => opts.find((o) => o.value === v)?.label ?? v

// Trimmed, non-empty lines (what is stored); typing happens on raw lines.
export function normaliseComplaints(lines: string[]): string[] {
  return lines.map((l) => l.trim()).filter(Boolean)
}

// A visit's complaints: the list, else the old free-text field split by line.
export function complaintLines(notes: CaseNotes | undefined): string[] {
  if (!notes) return []
  return normaliseComplaints(notes.complaints ?? (notes.complaint ?? '').split('\n'))
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>()
  return list.filter((c) => {
    const k = c.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

// What to ask about at a follow-up: the previous visit's complaints plus any
// it was still tracking that had not resolved, so ongoing ones carry forward.
export function previousComplaints(notes: CaseNotes | undefined): string[] {
  const carried = (notes?.complaintStatus ?? []).filter((s) => s.status !== 'resolved').map((s) => s.complaint.trim())
  return dedupe(normaliseComplaints([...complaintLines(notes), ...carried]))
}

// Keeps set statuses of listed complaints, in list order.
export function cleanStatuses(complaints: string[], statuses: Record<string, ComplaintStatusValue | undefined>): ComplaintStatus[] {
  return complaints.flatMap((complaint) => {
    const status = statuses[complaint.toLowerCase()]
    return status ? [{ complaint, status }] : []
  })
}

// Drops unset fields and the details of options that are not chosen.
export function cleanChecklist(c: GeneralsChecklist | undefined): GeneralsChecklist | undefined {
  if (!c) return undefined
  const out: GeneralsChecklist = {}
  if (c.appetite) out.appetite = c.appetite
  if (c.thirst) out.thirst = c.thirst
  if (c.urine?.length) out.urine = c.urine
  if (c.sleep) out.sleep = c.sleep
  if (c.stool) out.stool = c.stool
  if (c.stool === 'constipation' && c.constipationDays && c.constipationDays > 0) out.constipationDays = c.constipationDays
  if (c.sweat) out.sweat = c.sweat
  if (c.sweat === 'increased' && c.sweatParts?.trim()) out.sweatParts = c.sweatParts.trim()
  return Object.keys(out).length ? out : undefined
}

// "Appetite: Decreased · Stool: Constipation (every 3 days)"
export function checklistSummary(c: GeneralsChecklist | undefined): string {
  if (!c) return ''
  const parts: string[] = []
  if (c.appetite) parts.push(`Appetite: ${label(LEVELS, c.appetite)}`)
  if (c.thirst) parts.push(`Thirst: ${label(LEVELS, c.thirst)}`)
  if (c.urine?.length) parts.push(`Urine: ${c.urine.map((u) => label(URINE_OPTIONS, u)).join(', ')}`)
  if (c.sleep) parts.push(`Sleep: ${label(SLEEP_OPTIONS, c.sleep)}`)
  if (c.stool) {
    const days = c.stool === 'constipation' && c.constipationDays ? ` (every ${c.constipationDays} day${c.constipationDays === 1 ? '' : 's'})` : ''
    parts.push(`Stool: ${label(STOOL_OPTIONS, c.stool)}${days}`)
  }
  if (c.sweat) {
    const where = c.sweat === 'increased' && c.sweatParts ? ` (${c.sweatParts})` : ''
    parts.push(`Sweat: ${label(LEVELS, c.sweat)}${where}`)
  }
  return parts.join(' · ')
}

// ["Headache — Better", ...]
export function statusSummary(statuses: ComplaintStatus[] | undefined): string[] {
  return (statuses ?? []).map((s) => `${s.complaint} — ${label(STATUS_OPTIONS, s.status)}`)
}

// A new visit starts with every general at its normal option; only the
// differences need tapping.
export function defaultGenerals(): GeneralsChecklist {
  return { appetite: 'normal', thirst: 'normal', urine: ['normal'], sleep: 'sound', stool: 'regular', sweat: 'normal' }
}

const terms = (text: string | undefined) => (text ?? '').split(',').map((t) => t.trim()).filter(Boolean)

export function hasTerm(text: string | undefined, term: string): boolean {
  return terms(text).some((t) => t.toLowerCase() === term.toLowerCase())
}

// Adds the term to a comma-separated field, or removes it when already there.
export function toggleTerm(text: string | undefined, term: string): string {
  const list = terms(text)
  return (hasTerm(text, term) ? list.filter((t) => t.toLowerCase() !== term.toLowerCase()) : [...list, term]).join(', ')
}

// Trimmed fields; empty ones are dropped.
export function cleanDetail(d: ComplaintDetail): ComplaintDetail {
  const out: ComplaintDetail = {}
  for (const k of DETAIL_FIELDS) {
    const v = d[k]?.trim()
    if (v) out[k] = v
  }
  return out
}

// Cleaned cards, without the empty ones.
export function cleanDetails(list: ComplaintDetail[]): ComplaintDetail[] {
  return list.map(cleanDetail).filter((d) => Object.keys(d).length > 0)
}

// Lower-cases the start of each comma-separated term so a phrase reads
// mid-sentence ("Throbbing, Bursting" -> "throbbing, bursting"); acronyms stay.
const lowerTerms = (text: string) => terms(text).map((t) => (/^[A-Z][^A-Z]/.test(t) || t.length === 1 ? t[0].toLowerCase() + t.slice(1) : t)).join(', ')

// "Head, right temple: throbbing, bursting; since 3 months; < sun; > pressure; with nausea"
export function complaintSummary(d: ComplaintDetail): string {
  const c = cleanDetail(d)
  const sensation = c.sensation && (c.location ? lowerTerms(c.sensation) : c.sensation)
  const head = c.location && sensation ? `${c.location}: ${sensation}` : (c.location ?? sensation)
  return [
    head,
    c.duration && `since ${lowerTerms(c.duration)}`,
    c.worse && `< ${lowerTerms(c.worse)}`,
    c.better && `> ${lowerTerms(c.better)}`,
    c.concomitants && `with ${lowerTerms(c.concomitants)}`,
    c.note,
  ]
    .filter(Boolean)
    .join('; ')
}

// The cards of a visit: the saved ones, else each old complaint line as a note.
export function detailsFromNotes(notes: CaseNotes | undefined): ComplaintDetail[] {
  if (notes?.complaintDetails?.length) return notes.complaintDetails
  return complaintLines(notes).map((note) => ({ note }))
}
