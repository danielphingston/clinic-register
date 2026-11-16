// Pure expense rules shared by the app and the service worker (no DOM, no db).

import type { ExpenseCategory, ExpenseMode } from '../../db/types'

export const OTHER_CATEGORY = 'other'

// Rent and electricity barely move with patient numbers, so they count as
// fixed costs. Temporary staff are hired as needed, so they count as variable.
export const BUILTIN_CATEGORIES: ExpenseCategory[] = [
  { id: 'rent', name: 'Rent', fixed: true },
  { id: 'electricity', name: 'Electricity', fixed: true },
  { id: 'supplies', name: 'Supplies', fixed: false },
  { id: 'staff', name: 'Staff (temp)', fixed: false },
  { id: OTHER_CATEGORY, name: 'Others', fixed: false },
]

const BUILTIN_IDS = new Set(BUILTIN_CATEGORIES.map((c) => c.id))

export const isBuiltinCategory = (id: string) => BUILTIN_IDS.has(id)

// Built-ins first, then the clinic's own, with "Others" last. Archived ones
// are included (old expenses still need their names); pickers filter them.
export function allCategories(custom: ExpenseCategory[] | undefined): ExpenseCategory[] {
  const builtins = BUILTIN_CATEGORIES.filter((c) => c.id !== OTHER_CATEGORY)
  const other = BUILTIN_CATEGORIES.find((c) => c.id === OTHER_CATEGORY)!
  return [...builtins, ...(custom ?? []).filter((c) => !BUILTIN_IDS.has(c.id)), other]
}

export function categoryName(categories: ExpenseCategory[], id: string): string {
  return categories.find((c) => c.id === id)?.name ?? 'Unknown'
}

export const EXPENSE_MODES: { value: ExpenseMode; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank', label: 'Bank transfer' },
  { value: 'card', label: 'Card' },
  { value: 'other', label: 'Other' },
]

export const EXPENSE_MODE_LABEL = Object.fromEntries(EXPENSE_MODES.map((m) => [m.value, m.label])) as Record<ExpenseMode, string>

// ---- recurring expenses ----

export interface RecurringRule {
  id: string
  deleted: 0 | 1
  day: number
  startMonth: string
  paused?: boolean
  skipped?: string[]
}

export interface DueItem<R extends RecurringRule = RecurringRule> {
  rule: R
  month: string // YYYY-MM
  dueDate: string // ISO date
}

// How far back an unpaid month is still offered.
export const DUE_LOOKBACK_MONTHS = 12

const pad = (n: number) => String(n).padStart(2, '0')

export function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number)
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`
}

// The rule's day in that month, moved back to the last day for short months.
export function dueDateIn(month: string, day: number): string {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return `${month}-${pad(Math.min(Math.max(1, day), last))}`
}

// Months that have reached their due date, have no payment recorded and were
// not skipped, oldest first. `paid` holds `${ruleId}|${month}` keys.
export function dueRecurring<R extends RecurringRule>(rules: R[], paid: Set<string>, today: string): DueItem<R>[] {
  const out: DueItem<R>[] = []
  const thisMonth = today.slice(0, 7)
  const earliest = shiftMonth(thisMonth, -(DUE_LOOKBACK_MONTHS - 1))
  for (const rule of rules) {
    if (rule.deleted || rule.paused) continue
    const skipped = new Set(rule.skipped ?? [])
    for (let m = rule.startMonth > earliest ? rule.startMonth : earliest; m <= thisMonth; m = shiftMonth(m, 1)) {
      const dueDate = dueDateIn(m, rule.day)
      if (dueDate > today || skipped.has(m) || paid.has(`${rule.id}|${m}`)) continue
      out.push({ rule, month: m, dueDate })
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// "November 2026" for "2026-11".
export function monthName(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${MONTH_NAMES[m - 1]} ${y}`
}

export const paidKey = (recurringId: string, month: string) => `${recurringId}|${month}`
