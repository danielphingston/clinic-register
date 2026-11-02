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

// Tap-to-pick terms for Aggravation (<) and Amelioration (>).
export const MODALITY_QUICK_PICKS = ['Morning', 'Evening', 'Night', 'Cold', 'Heat', 'Damp weather', 'Open air', 'Motion', 'Rest', 'Lying down', 'Pressure', 'Touch', 'Eating', 'Sun', 'Noise']

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

// Trimmed entries without blanks or case-insensitive duplicates (first spelling wins).
export function cleanEntries(list: string[] | undefined): string[] {
  return dedupe(normaliseComplaints(list ?? []))
}

export function hasTerm(list: string[] | undefined, term: string): boolean {
  return (list ?? []).some((t) => t.trim().toLowerCase() === term.trim().toLowerCase())
}

// Appends an entry unless it is blank or already there.
export function addTerm(list: string[] | undefined, term: string): string[] {
  return cleanEntries([...(list ?? []), term])
}

// Adds the term to the list, or removes it when already there.
export function toggleTerm(list: string[] | undefined, term: string): string[] {
  return hasTerm(list, term) ? (list ?? []).filter((t) => t.trim().toLowerCase() !== term.trim().toLowerCase()) : addTerm(list, term)
}

// Trimmed fields and entries; empty ones are dropped.
export function cleanDetail(d: ComplaintDetail): ComplaintDetail {
  const out: ComplaintDetail = {}
  const complaint = d.complaint?.trim()
  const duration = d.duration?.trim()
  const aggravation = cleanEntries(d.aggravation)
  const amelioration = cleanEntries(d.amelioration)
  if (complaint) out.complaint = complaint
  if (duration) out.duration = duration
  if (aggravation.length) out.aggravation = aggravation
  if (amelioration.length) out.amelioration = amelioration
  return out
}

// Cleaned cards, without the empty ones.
export function cleanDetails(list: ComplaintDetail[]): ComplaintDetail[] {
  return list.map(cleanDetail).filter((d) => Object.keys(d).length > 0)
}

// Lower-cases the start of a modality term so it reads mid-sentence
// ("Damp weather" -> "damp weather"); acronyms stay.
const lowerTerm = (t: string) => (/^[A-Z][^A-Z]/.test(t) || t.length === 1 ? t[0].toLowerCase() + t.slice(1) : t)

// "Throbbing headache, right temple; since 3 months; < sun, noise; > pressure"
export function complaintSummary(d: ComplaintDetail): string {
  const c = cleanDetail(d)
  return [
    c.complaint,
    c.duration && `since ${c.duration}`,
    c.aggravation && `< ${c.aggravation.map(lowerTerm).join(', ')}`,
    c.amelioration && `> ${c.amelioration.map(lowerTerm).join(', ')}`,
  ]
    .filter(Boolean)
    .join('; ')
}

// The cards of a visit: the saved ones, else each old complaint line as a card.
export function detailsFromNotes(notes: CaseNotes | undefined): ComplaintDetail[] {
  if (notes?.complaintDetails?.length) return notes.complaintDetails
  return complaintLines(notes).map((complaint) => ({ complaint }))
}
