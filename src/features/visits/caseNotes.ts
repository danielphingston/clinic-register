import type { CaseNotes, ComplaintStatus, ComplaintStatusValue, GeneralsChecklist, Level, UrineOption } from '../../db/types'

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
