import { describe, expect, it } from 'vitest'
import { allCategories, categoryName, dueDateIn, dueRecurring, monthName, paidKey, shiftMonth, type RecurringRule } from './expenseLogic'

const rule = (over: Partial<RecurringRule> = {}): RecurringRule => ({ id: 'r1', deleted: 0, day: 5, startMonth: '2026-09', ...over })

describe('expense categories', () => {
  it('lists the built-ins, then added ones, with Others last; rent and electricity are fixed', () => {
    const cats = allCategories([{ id: 'c1', name: 'Internet', fixed: true }])
    expect(cats.map((c) => c.name)).toEqual(['Rent', 'Electricity', 'Supplies', 'Staff (temp)', 'Internet', 'Others'])
    expect(cats.filter((c) => c.fixed).map((c) => c.id)).toEqual(['rent', 'electricity', 'c1'])
    expect(categoryName(cats, 'c1')).toBe('Internet')
    expect(categoryName(cats, 'gone')).toBe('Unknown')
  })

  it('ignores a stored category that reuses a built-in id', () => {
    expect(allCategories([{ id: 'rent', name: 'Hacked', fixed: false }]).filter((c) => c.id === 'rent')).toEqual([{ id: 'rent', name: 'Rent', fixed: true }])
  })
})

describe('months', () => {
  it('shifts across years and names months', () => {
    expect(shiftMonth('2026-11', 2)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(monthName('2026-02')).toBe('February 2026')
  })

  it('moves a due day past the month end back to its last day', () => {
    expect(dueDateIn('2026-02', 31)).toBe('2026-02-28')
    expect(dueDateIn('2028-02', 30)).toBe('2028-02-29')
    expect(dueDateIn('2026-11', 5)).toBe('2026-11-05')
  })
})

describe('dueRecurring', () => {
  it('lists each month from the start whose due day has come, oldest first', () => {
    const due = dueRecurring([rule()], new Set(), '2026-11-04')
    // November's 5th has not come yet.
    expect(due.map((d) => [d.month, d.dueDate])).toEqual([
      ['2026-09', '2026-09-05'],
      ['2026-10', '2026-10-05'],
    ])
    expect(dueRecurring([rule()], new Set(), '2026-11-05').map((d) => d.month)).toEqual(['2026-09', '2026-10', '2026-11'])
  })

  it('leaves out paid and skipped months, and paused or deleted rules', () => {
    const paid = new Set([paidKey('r1', '2026-09')])
    expect(dueRecurring([rule({ skipped: ['2026-10'] })], paid, '2026-11-20').map((d) => d.month)).toEqual(['2026-11'])
    expect(dueRecurring([rule({ paused: true })], new Set(), '2026-11-20')).toEqual([])
    expect(dueRecurring([rule({ deleted: 1 })], new Set(), '2026-11-20')).toEqual([])
  })

  it('looks back at most twelve months', () => {
    const due = dueRecurring([rule({ startMonth: '2024-01', day: 1 })], new Set(), '2026-11-20')
    expect(due).toHaveLength(12)
    expect(due[0].month).toBe('2025-12')
  })

  it('orders several rules by due date', () => {
    const due = dueRecurring([rule({ id: 'late', day: 20, startMonth: '2026-11' }), rule({ id: 'early', day: 2, startMonth: '2026-11' })], new Set(), '2026-11-25')
    expect(due.map((d) => d.rule.id)).toEqual(['early', 'late'])
  })
})
