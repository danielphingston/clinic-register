import { db } from '../../db/db'
import { getSettings, insert, saveSettings, softDelete, update } from '../../db/repo'
import type { DateRange } from '../../lib/dateRange'
import type { Expense, ExpenseCategory, ExpenseMode, RecurringExpense } from '../../db/types'
import { isISODate } from '../../lib/dateRange'
import { todayISO } from '../../lib/format'
import { allCategories, dueRecurring, isBuiltinCategory, OTHER_CATEGORY, paidKey, type DueItem } from './expenseLogic'

export class ExpenseError extends Error {}

const round2 = (n: number) => Math.round(n * 100) / 100

// ---- categories ----

export async function expenseCategories(): Promise<ExpenseCategory[]> {
  return allCategories((await getSettings()).expenseCategories)
}

async function saveCustom(change: (list: ExpenseCategory[]) => ExpenseCategory[]): Promise<void> {
  await db.transaction('rw', db.kv, async () => {
    const settings = await getSettings()
    await saveSettings({ ...settings, expenseCategories: change(settings.expenseCategories ?? []) })
  })
}

export async function addCategory(name: string, fixed: boolean): Promise<ExpenseCategory> {
  const trimmed = name.trim()
  if (!trimmed) throw new ExpenseError('Enter a category name')
  const existing = (await expenseCategories()).find((c) => c.name.toLowerCase() === trimmed.toLowerCase())
  if (existing && !existing.archived) throw new ExpenseError(`${existing.name} is already a category`)
  if (existing) {
    // Re-adding a removed category brings it back, with its old expenses.
    await saveCustom((list) => list.map((c) => (c.id === existing.id ? { ...c, archived: undefined, fixed } : c)))
    return { ...existing, archived: undefined, fixed }
  }
  const cat: ExpenseCategory = { id: crypto.randomUUID(), name: trimmed, fixed }
  await saveCustom((list) => [...list, cat])
  return cat
}

export async function updateCategory(id: string, changes: Partial<Pick<ExpenseCategory, 'name' | 'fixed'>>): Promise<void> {
  if (isBuiltinCategory(id)) throw new ExpenseError('Built-in categories cannot be changed')
  const name = changes.name?.trim()
  if (changes.name !== undefined && !name) throw new ExpenseError('Enter a category name')
  await saveCustom((list) => list.map((c) => (c.id === id ? { ...c, ...changes, ...(name ? { name } : {}) } : c)))
}

// Removed categories stay stored (archived) so old expenses keep their name.
export async function removeCategory(id: string): Promise<void> {
  if (isBuiltinCategory(id)) throw new ExpenseError('Built-in categories cannot be removed')
  await saveCustom((list) => list.map((c) => (c.id === id ? { ...c, archived: true } : c)))
}

// ---- expenses ----

export interface ExpenseInput {
  date: string
  category: string
  amount: number
  mode: ExpenseMode
  note?: string
}

async function validate(input: ExpenseInput): Promise<ExpenseInput> {
  if (!(input.amount > 0) || !Number.isFinite(input.amount)) throw new ExpenseError('Enter an amount above zero')
  if (!isISODate(input.date)) throw new ExpenseError('Enter the date paid')
  const cat = (await expenseCategories()).find((c) => c.id === input.category)
  if (!cat) throw new ExpenseError('Choose a category')
  const note = input.note?.trim() || undefined
  // "Others" says nothing on its own; a note keeps it from becoming a dumping ground.
  if (input.category === OTHER_CATEGORY && !note) throw new ExpenseError('Add a note saying what this was for')
  return { ...input, amount: round2(input.amount), note }
}

export async function addExpense(input: ExpenseInput & { recurringId?: string; forMonth?: string }): Promise<Expense> {
  const v = await validate(input)
  return insert(db.expenses, {
    date: v.date,
    category: v.category,
    amount: v.amount,
    mode: v.mode,
    ...(v.note ? { note: v.note } : {}),
    ...(input.recurringId ? { recurringId: input.recurringId, forMonth: input.forMonth } : {}),
  })
}

export async function editExpense(id: string, input: ExpenseInput): Promise<void> {
  const cur = await db.expenses.get(id)
  if (!cur || cur.deleted) throw new ExpenseError('Expense not found')
  const v = await validate(input)
  await update(db.expenses, id, { date: v.date, category: v.category, amount: v.amount, mode: v.mode, note: v.note })
}

// Its receipt photos go with it (soft deletes, so other devices see them).
export async function deleteExpense(id: string): Promise<void> {
  await db.transaction('rw', db.expenses, db.attachments, async () => {
    await softDelete(db.expenses, id)
    const receipts = await db.attachments.where('expenseId').equals(id).filter((a) => a.deleted === 0).toArray()
    for (const r of receipts) await softDelete(db.attachments, r.id)
  })
}

export async function expensesInRange({ from, to }: DateRange): Promise<Expense[]> {
  const list = await db.expenses.where('date').between(from, to, true, true).filter((e) => e.deleted === 0).toArray()
  return list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
}

export interface ExpenseTotals {
  total: number
  count: number
  byCategory: Record<string, number>
  byMode: Partial<Record<ExpenseMode, number>>
}

export function sumExpenses(list: Expense[]): ExpenseTotals {
  const out: ExpenseTotals = { total: 0, count: list.length, byCategory: {}, byMode: {} }
  for (const e of list) {
    out.total += e.amount
    out.byCategory[e.category] = (out.byCategory[e.category] ?? 0) + e.amount
    out.byMode[e.mode] = (out.byMode[e.mode] ?? 0) + e.amount
  }
  out.total = round2(out.total)
  for (const k of Object.keys(out.byCategory)) out.byCategory[k] = round2(out.byCategory[k])
  for (const k of Object.keys(out.byMode) as ExpenseMode[]) out.byMode[k] = round2(out.byMode[k]!)
  return out
}

export async function expenseTotals(range: DateRange): Promise<ExpenseTotals> {
  return sumExpenses(await expensesInRange(range))
}

// Receipt photos attached to an expense, newest first.
export async function receiptsFor(expenseId: string) {
  const list = await db.attachments.where('expenseId').equals(expenseId).filter((a) => a.deleted === 0).toArray()
  return list.sort((a, b) => b.createdAt - a.createdAt)
}

// Ids of expenses in the list that have at least one receipt.
export async function expensesWithReceipts(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const list = await db.attachments.where('expenseId').anyOf(ids).filter((a) => a.deleted === 0).toArray()
  return new Set(list.map((a) => a.expenseId!))
}

// ---- recurring expenses ----

export interface RecurringInput {
  category: string
  amount: number
  day: number
  mode: ExpenseMode
  note?: string
  startMonth: string
}

async function validateRecurring(input: RecurringInput): Promise<RecurringInput> {
  if (!(input.amount > 0) || !Number.isFinite(input.amount)) throw new ExpenseError('Enter an amount above zero')
  if (!Number.isInteger(input.day) || input.day < 1 || input.day > 31) throw new ExpenseError('Enter a day of the month from 1 to 31')
  if (!/^\d{4}-\d{2}$/.test(input.startMonth)) throw new ExpenseError('Enter the month it starts')
  if (!(await expenseCategories()).some((c) => c.id === input.category)) throw new ExpenseError('Choose a category')
  const note = input.note?.trim() || undefined
  if (input.category === OTHER_CATEGORY && !note) throw new ExpenseError('Add a note saying what this was for')
  return { ...input, amount: round2(input.amount), note }
}

export async function addRecurring(input: RecurringInput): Promise<RecurringExpense> {
  const v = await validateRecurring(input)
  return insert(db.recurringExpenses, { ...v, ...(v.note ? {} : { note: undefined }) })
}

export async function editRecurring(id: string, input: RecurringInput & { paused?: boolean }): Promise<void> {
  const cur = await db.recurringExpenses.get(id)
  if (!cur || cur.deleted) throw new ExpenseError('Recurring expense not found')
  const v = await validateRecurring(input)
  await update(db.recurringExpenses, id, { ...v, paused: input.paused || undefined })
}

export async function setRecurringPaused(id: string, paused: boolean): Promise<void> {
  await update(db.recurringExpenses, id, { paused: paused || undefined })
}

// Expenses already recorded from it are kept.
export async function deleteRecurring(id: string): Promise<void> {
  await softDelete(db.recurringExpenses, id)
}

export async function recurringList(): Promise<RecurringExpense[]> {
  const list = await db.recurringExpenses.where('deleted').equals(0).toArray()
  return list.sort((a, b) => a.day - b.day || a.createdAt - b.createdAt)
}

async function paidMonths(): Promise<Set<string>> {
  const paid = await db.expenses.where('recurringId').above('').filter((e) => e.deleted === 0).toArray()
  return new Set(paid.map((e) => paidKey(e.recurringId!, e.forMonth ?? e.date.slice(0, 7))))
}

export async function dueExpenses(today = todayISO()): Promise<DueItem<RecurringExpense>[]> {
  return dueRecurring(await recurringList(), await paidMonths(), today)
}

// Records the month's payment. The amount and date can differ from the rule
// (a rent rise, a late payment).
export async function markRecurringPaid(
  ruleId: string,
  month: string,
  paid: { amount: number; date: string; mode: ExpenseMode; note?: string },
): Promise<Expense> {
  const rule = await db.recurringExpenses.get(ruleId)
  if (!rule || rule.deleted) throw new ExpenseError('Recurring expense not found')
  if ((await paidMonths()).has(paidKey(ruleId, month))) throw new ExpenseError('This month is already recorded')
  return addExpense({ category: rule.category, note: paid.note ?? rule.note, amount: paid.amount, date: paid.date, mode: paid.mode, recurringId: ruleId, forMonth: month })
}

// "Not this month": the month stops showing as due.
export async function skipRecurringMonth(ruleId: string, month: string): Promise<void> {
  await db.transaction('rw', db.recurringExpenses, async () => {
    const rule = await db.recurringExpenses.get(ruleId)
    if (!rule || rule.deleted) throw new ExpenseError('Recurring expense not found')
    const skipped = [...new Set([...(rule.skipped ?? []), month])].sort()
    await update(db.recurringExpenses, ruleId, { skipped })
  })
}
