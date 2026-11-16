import type { ExpenseCategory } from '../../db/types'
import { bucketKey, bucketKeys, type DateRange, type Granularity } from '../../lib/dateRange'
import { addDays, daysBetween } from '../../lib/format'
import { periodEnd, periodGranularity, periodOf, shiftPeriod, trendWindows, type Period, type TrendWindows } from '../../lib/period'
import { expenseCategories, expensesInRange, sumExpenses } from '../expenses/expenseRepo'
import { revenueReport, visitsInRange } from './reportQueries'

// Profit = income − expenses. Income is either what was collected (payments
// received, a cash view) or what was billed (bills dated in the period).

export type ProfitBasis = 'collected' | 'billed'

export const BASIS_LABEL: Record<ProfitBasis, string> = { collected: 'Collected', billed: 'Billed' }

export function isProfitBasis(s: string | null | undefined): s is ProfitBasis {
  return s === 'collected' || s === 'billed'
}

const round2 = (n: number) => Math.round(n * 100) / 100

export interface ProfitTotals {
  income: number // collected or billed, by basis
  collected: number
  billed: number
  expenses: number
  net: number
  margin: number | null // net ÷ income
  visits: number
  costPerVisit: number | null
  // Visits needed to cover fixed costs: fixed ÷ (income − variable costs) per visit.
  breakEvenVisits: number | null
  fixed: number
  variable: number
  byCategory: Record<string, number>
  cashIn: number
  cashOut: number
}

export async function profitTotals(range: DateRange, basis: ProfitBasis, categories?: ExpenseCategory[]): Promise<ProfitTotals> {
  const cats = categories ?? (await expenseCategories())
  const fixedIds = new Set(cats.filter((c) => c.fixed).map((c) => c.id))
  const [rev, { visits }, list] = await Promise.all([revenueReport(range, 'month'), visitsInRange(range), expensesInRange(range)])
  const exp = sumExpenses(list)
  const income = basis === 'collected' ? rev.collected : rev.billed
  let fixed = 0
  for (const [id, amt] of Object.entries(exp.byCategory)) if (fixedIds.has(id)) fixed += amt
  fixed = round2(fixed)
  const variable = round2(exp.total - fixed)
  const n = visits.length
  const contribution = n ? (income - variable) / n : 0
  return {
    income,
    collected: rev.collected,
    billed: rev.billed,
    expenses: exp.total,
    net: round2(income - exp.total),
    margin: income > 0 ? (income - exp.total) / income : null,
    visits: n,
    costPerVisit: n ? round2(exp.total / n) : null,
    breakEvenVisits: n && contribution > 0 ? Math.ceil(fixed / contribution) : null,
    fixed,
    variable,
    byCategory: exp.byCategory,
    cashIn: rev.byMode.cash,
    cashOut: exp.byMode.cash ?? 0,
  }
}

export interface ProfitBucket {
  key: string
  from: string
  income: number
  expenses: number
  net: number
  byCategory: Record<string, number>
}

export interface CategoryAlert {
  category: ExpenseCategory
  amount: number
  average: number // over the previous ALERT_PERIODS periods, like for like
  rise: number // fraction above the average
}

// A category is flagged when it is this much above its recent average…
export const ALERT_RISE = 0.3
// …and by at least this many rupees (so ₹40 against ₹25 is not news).
export const ALERT_MIN = 200
export const ALERT_PERIODS = 3

export interface ProfitData {
  windows: TrendWindows
  granularity: Granularity
  basis: ProfitBasis
  categories: ExpenseCategory[]
  current: ProfitTotals
  previous: ProfitTotals
  lastYear: ProfitTotals
  buckets: ProfitBucket[]
  alerts: CategoryAlert[]
}

// The earlier periods' windows, cut to the same number of days as the
// current one while it is still running.
function earlierWindows(period: Period, current: DateRange, n: number): DateRange[] {
  const days = daysBetween(current.from, current.to)
  return Array.from({ length: n }, (_, i) => {
    const q = shiftPeriod(period, -(i + 1))
    const end = periodEnd(q)
    const to = addDays(q.start, days)
    return { from: q.start, to: to < end ? to : end }
  })
}

// Categories spending well above their average over the previous periods.
export async function categoryAlerts(period: Period, today: string, categories?: ExpenseCategory[]): Promise<CategoryAlert[]> {
  const cats = categories ?? (await expenseCategories())
  const current = trendWindows(period, today).current.range
  const now = sumExpenses(await expensesInRange(current)).byCategory
  const before = await Promise.all(earlierWindows(period, current, ALERT_PERIODS).map(async (r) => sumExpenses(await expensesInRange(r)).byCategory))
  const out: CategoryAlert[] = []
  for (const [id, amount] of Object.entries(now)) {
    const average = round2(before.reduce((s, b) => s + (b[id] ?? 0), 0) / ALERT_PERIODS)
    if (average > 0 && amount > average * (1 + ALERT_RISE) && amount - average >= ALERT_MIN) {
      const category = cats.find((c) => c.id === id) ?? { id, name: 'Unknown', fixed: false }
      out.push({ category, amount, average, rise: (amount - average) / average })
    }
  }
  return out.sort((a, b) => b.rise - a.rise)
}

export async function profitData(period: Period, today: string, basis: ProfitBasis): Promise<ProfitData> {
  const windows = trendWindows(period, today)
  const granularity = periodGranularity(period.kind)
  const categories = await expenseCategories()
  const { range } = windows.current
  const [current, previous, lastYear, rev, list, alerts] = await Promise.all([
    profitTotals(range, basis, categories),
    profitTotals(windows.previous.range, basis, categories),
    profitTotals(windows.lastYear.range, basis, categories),
    revenueReport(range, granularity),
    expensesInRange(range),
    categoryAlerts(period, today, categories),
  ])
  const buckets = new Map<string, ProfitBucket>(
    bucketKeys(range, granularity).map((key) => {
      const first = granularity === 'month' ? `${key}-01` : key
      return [key, { key, from: first < range.from ? range.from : first, income: 0, expenses: 0, net: 0, byCategory: {} }]
    }),
  )
  for (const b of rev.buckets) {
    const pb = buckets.get(b.key)
    if (pb) pb.income = basis === 'collected' ? b.collected : b.billed
  }
  for (const e of list) {
    const pb = buckets.get(bucketKey(e.date, granularity))!
    pb.expenses += e.amount
    pb.byCategory[e.category] = round2((pb.byCategory[e.category] ?? 0) + e.amount)
  }
  for (const pb of buckets.values()) {
    pb.expenses = round2(pb.expenses)
    pb.net = round2(pb.income - pb.expenses)
  }
  return { windows, granularity, basis, categories, current, previous, lastYear, buckets: [...buckets.values()], alerts }
}

// This month's net (collected − expenses) so far, and last month's over the
// same days, for the dashboard.
export async function monthProfit(today: string): Promise<{ net: number; previous: number; previousLabel: string }> {
  const w = trendWindows(periodOf('month', today), today)
  const [cur, prev] = await Promise.all([profitTotals(w.current.range, 'collected'), profitTotals(w.previous.range, 'collected')])
  return { net: cur.net, previous: prev.net, previousLabel: w.previous.label }
}
