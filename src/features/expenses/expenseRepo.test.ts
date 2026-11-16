import { describe, expect, it, vi } from 'vitest'
import { db } from '../../db/db'
import { getSettings } from '../../db/repo'
import { addExpenseReceipt } from '../attachments/attachmentRepo'
import {
  addCategory,
  addExpense,
  addRecurring,
  deleteExpense,
  deleteRecurring,
  dueExpenses,
  editExpense,
  editRecurring,
  expenseCategories,
  expensesInRange,
  expensesWithReceipts,
  expenseTotals,
  markRecurringPaid,
  receiptsFor,
  removeCategory,
  skipRecurringMonth,
  updateCategory,
} from './expenseRepo'

// Real compression needs a browser's codecs; receipts are stored as given.
vi.mock('../../lib/compress', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/compress')>()
  return {
    ...actual,
    compressFile: vi.fn(async (file: File) => ({ blob: file, mime: file.type, originalSize: file.size, size: file.size, compressed: false })),
  }
})

const base = { date: '2026-10-05', category: 'rent', amount: 15000, mode: 'bank' as const }

describe('expenses', () => {
  it('adds, edits and lists expenses in a range, newest first, with totals by category and mode', async () => {
    const rent = await addExpense({ ...base, note: '  Landlord  ' })
    expect(rent).toMatchObject({ amount: 15000, note: 'Landlord', deleted: 0 })
    await addExpense({ date: '2026-10-12', category: 'electricity', amount: 2400.5, mode: 'upi' })
    await addExpense({ date: '2026-10-20', category: 'supplies', amount: 800, mode: 'cash' })
    await addExpense({ date: '2026-11-01', category: 'supplies', amount: 999, mode: 'cash' })

    const oct = { from: '2026-10-01', to: '2026-10-31' }
    expect((await expensesInRange(oct)).map((e) => e.category)).toEqual(['supplies', 'electricity', 'rent'])
    expect(await expenseTotals(oct)).toEqual({
      total: 18200.5,
      count: 3,
      byCategory: { rent: 15000, electricity: 2400.5, supplies: 800 },
      byMode: { bank: 15000, upi: 2400.5, cash: 800 },
    })

    await editExpense(rent.id, { ...base, amount: 16000, note: '' })
    const edited = await db.expenses.get(rent.id)
    expect(edited?.amount).toBe(16000)
    expect(edited).not.toHaveProperty('note')
  })

  it('rejects a missing amount, date or category, and Others without a note', async () => {
    await expect(addExpense({ ...base, amount: 0 })).rejects.toThrow('above zero')
    await expect(addExpense({ ...base, date: '2026-13-01' })).rejects.toThrow('date')
    await expect(addExpense({ ...base, category: 'nope' })).rejects.toThrow('category')
    await expect(addExpense({ ...base, category: 'other', note: '  ' })).rejects.toThrow('note')
    await expect(addExpense({ ...base, category: 'other', note: 'Plumber' })).resolves.toMatchObject({ note: 'Plumber' })
  })

  it('stores receipt photos against the expense, and deletes them with it', async () => {
    const e = await addExpense(base)
    const { attachment } = await addExpenseReceipt(e.id, new File(['bill'], 'bill.jpg', { type: 'image/jpeg' }))
    expect(attachment).toMatchObject({ expenseId: e.id, patientId: '', kind: 'other', caption: 'Receipt' })
    expect((await receiptsFor(e.id)).map((a) => a.id)).toEqual([attachment.id])
    expect(await expensesWithReceipts([e.id, 'other'])).toEqual(new Set([e.id]))

    await deleteExpense(e.id)
    expect((await db.expenses.get(e.id))?.deleted).toBe(1)
    expect((await db.attachments.get(attachment.id))?.deleted).toBe(1)
    expect(await expensesInRange({ from: '2026-10-01', to: '2026-10-31' })).toEqual([])
    await expect(addExpenseReceipt(e.id, new File(['x'], 'x.jpg', { type: 'image/jpeg' }))).rejects.toThrow('Expense not found')
  })
})

describe('expense categories', () => {
  it('adds categories to settings, refuses duplicates, and keeps removed ones for old expenses', async () => {
    const internet = await addCategory(' Internet ', true)
    expect(internet).toMatchObject({ name: 'Internet', fixed: true })
    await expect(addCategory('internet', false)).rejects.toThrow('already a category')
    await expect(addCategory('RENT', false)).rejects.toThrow('already a category')
    await expect(addCategory('', false)).rejects.toThrow('name')

    await addExpense({ ...base, category: internet.id, amount: 700 })
    await updateCategory(internet.id, { fixed: false })
    await removeCategory(internet.id)
    const cats = await expenseCategories()
    expect(cats.find((c) => c.id === internet.id)).toMatchObject({ name: 'Internet', fixed: false, archived: true })
    expect((await getSettings()).expenseCategories).toHaveLength(1)

    // Adding it again brings back the same category.
    expect((await addCategory('Internet', true)).id).toBe(internet.id)
    expect((await expenseCategories()).find((c) => c.id === internet.id)?.archived).toBeUndefined()
  })

  it('does not change or remove built-in categories', async () => {
    await expect(removeCategory('rent')).rejects.toThrow('cannot be removed')
    await expect(updateCategory('rent', { fixed: false })).rejects.toThrow('cannot be changed')
  })
})

describe('recurring expenses', () => {
  const rentRule = { category: 'rent', amount: 15000, day: 5, mode: 'bank' as const, startMonth: '2026-10', note: 'Landlord' }

  it('shows months as due, records a payment for a month, and skips one', async () => {
    const r = await addRecurring(rentRule)
    expect((await dueExpenses('2026-11-10')).map((d) => d.month)).toEqual(['2026-10', '2026-11'])

    // Paid late and at a new rate: the expense keeps what was actually paid.
    const paid = await markRecurringPaid(r.id, '2026-10', { amount: 16000, date: '2026-10-09', mode: 'upi' })
    expect(paid).toMatchObject({ category: 'rent', amount: 16000, date: '2026-10-09', mode: 'upi', note: 'Landlord', recurringId: r.id, forMonth: '2026-10' })
    await expect(markRecurringPaid(r.id, '2026-10', { amount: 1, date: '2026-10-09', mode: 'upi' })).rejects.toThrow('already recorded')
    expect((await dueExpenses('2026-11-10')).map((d) => d.month)).toEqual(['2026-11'])

    await skipRecurringMonth(r.id, '2026-11')
    expect(await dueExpenses('2026-11-10')).toEqual([])
    expect((await db.recurringExpenses.get(r.id))?.skipped).toEqual(['2026-11'])
  })

  it('a deleted payment makes its month due again; a deleted rule keeps its payments', async () => {
    const r = await addRecurring(rentRule)
    const paid = await markRecurringPaid(r.id, '2026-10', { amount: 15000, date: '2026-10-05', mode: 'bank' })
    await deleteExpense(paid.id)
    expect((await dueExpenses('2026-10-20')).map((d) => d.month)).toEqual(['2026-10'])

    const again = await markRecurringPaid(r.id, '2026-10', { amount: 15000, date: '2026-10-05', mode: 'bank' })
    await deleteRecurring(r.id)
    expect(await dueExpenses('2026-12-20')).toEqual([])
    expect((await db.expenses.get(again.id))?.deleted).toBe(0)
  })

  it('validates and edits a rule', async () => {
    await expect(addRecurring({ ...rentRule, day: 32 })).rejects.toThrow('1 to 31')
    await expect(addRecurring({ ...rentRule, amount: -5 })).rejects.toThrow('above zero')
    await expect(addRecurring({ ...rentRule, startMonth: 'soon' })).rejects.toThrow('month')
    await expect(addRecurring({ ...rentRule, category: 'other', note: '' })).rejects.toThrow('note')
    const r = await addRecurring(rentRule)
    await editRecurring(r.id, { ...rentRule, amount: 17000, day: 1, paused: true })
    expect(await db.recurringExpenses.get(r.id)).toMatchObject({ amount: 17000, day: 1, paused: true })
    expect(await dueExpenses('2026-11-10')).toEqual([])
  })
})
