import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { Expense, RecurringExpense } from '../../db/types'
import { formatDate, formatINR, todayISO } from '../../lib/format'
import { periodLabel, periodOf, periodRange, shiftPeriod } from '../../lib/period'
import { collectionsForDay } from '../billing/billingRepo'
import { categoryColor } from '../reports/reportDefs'
import { categoryAlerts, profitTotals } from '../reports/profitQueries'
import { CategoriesDialog } from './CategoriesDialog'
import { categoryName, EXPENSE_MODE_LABEL, monthName, type DueItem } from './expenseLogic'
import { ExpenseDialog } from './ExpenseDialog'
import { dueExpenses, expenseCategories, expensesInRange, expensesWithReceipts, expenseTotals, recurringList, setRecurringPaused, skipRecurringMonth } from './expenseRepo'
import { RecurringDialog } from './RecurringDialog'

type Dialog =
  | { kind: 'add' }
  | { kind: 'edit'; expense: Expense }
  | { kind: 'pay'; due: DueItem<RecurringExpense> }
  | { kind: 'recurring'; rule?: RecurringExpense }
  | { kind: 'categories' }

function Tile({ label, value, sub, testId, tone }: { label: string; value: string; sub?: string; testId: string; tone?: 'bad' }) {
  return (
    <div className="card" data-testid={testId}>
      <div className="text-sm text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone === 'bad' ? 'text-red-700' : ''}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  )
}

const pct = (n: number) => `${Math.round(n * 100)}%`

export function ExpensesPage() {
  const today = todayISO()
  const [params, setParams] = useSearchParams()
  const raw = params.get('month')
  const month = periodOf('month', raw && /^\d{4}-\d{2}$/.test(raw) && `${raw}-01` <= today ? `${raw}-01` : today)
  const range = periodRange(month)
  const current = month.start === periodOf('month', today).start
  const [dialog, setDialog] = useState<Dialog>()
  const [filter, setFilter] = useState<string>()

  const categories = useLiveQuery(expenseCategories)
  const list = useLiveQuery(async () => expensesInRange(range), [range.from])
  const totals = useLiveQuery(async () => profitTotals(range, 'collected'), [range.from])
  const withReceipts = useLiveQuery(async () => expensesWithReceipts((await expensesInRange(range)).map((e) => e.id)), [range.from])
  const due = useLiveQuery(async () => dueExpenses(today), [today])
  const alerts = useLiveQuery(async () => categoryAlerts(month, today), [month.start, today])
  const rules = useLiveQuery(recurringList)
  const cash = useLiveQuery(async () => {
    const [inn, out] = await Promise.all([collectionsForDay(today), expenseTotals({ from: today, to: today })])
    return { in: inn.byMode.cash, out: out.byMode.cash ?? 0 }
  }, [today])

  const goMonth = (start: string) => {
    setFilter(undefined)
    setParams(start === periodOf('month', today).start ? {} : { month: start.slice(0, 7) }, { replace: true })
  }
  const name = (id: string) => (categories ? categoryName(categories, id) : '')
  const colorOf = (id: string) => categoryColor(categories?.findIndex((c) => c.id === id) ?? -1)

  const shown = filter ? list?.filter((e) => e.category === filter) : list
  const byDate = new Map<string, Expense[]>()
  for (const e of shown ?? []) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e])
  const spent = categories?.filter((c) => totals?.byCategory[c.id]).sort((a, b) => totals!.byCategory[b.id] - totals!.byCategory[a.id]) ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Expenses</h1>
        <div className="flex gap-2">
          <button type="button" className="btn-ghost border border-slate-300" onClick={() => setDialog({ kind: 'categories' })}>
            Categories
          </button>
          <button type="button" className="btn-primary" onClick={() => setDialog({ kind: 'add' })}>
            + Add expense
          </button>
        </div>
      </div>

      {due && due.length > 0 && (
        <section className="card space-y-2 border-amber-200 bg-amber-50" aria-labelledby="due-heading" data-testid="expenses-due">
          <h2 id="due-heading" className="font-semibold text-amber-900">
            Due to record
          </h2>
          <ul className="divide-y divide-amber-100">
            {due.map((d) => (
              <li key={`${d.rule.id}|${d.month}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" data-testid="due-item">
                <span className="min-w-0">
                  <span className="font-medium">
                    {name(d.rule.category)} · {monthName(d.month)}
                  </span>
                  <span className="block text-xs text-slate-600">
                    {formatINR(d.rule.amount)} due {formatDate(d.dueDate)}
                    {d.rule.note && ` · ${d.rule.note}`}
                  </span>
                </span>
                <span className="flex shrink-0 gap-2">
                  <button type="button" className="btn-primary px-3 py-1" onClick={() => setDialog({ kind: 'pay', due: d })}>
                    Mark paid
                  </button>
                  <button
                    type="button"
                    className="btn-ghost border border-slate-300 bg-white px-3 py-1"
                    aria-label={`Skip ${name(d.rule.category)} for ${monthName(d.month)}`}
                    onClick={() => skipRecurringMonth(d.rule.id, d.month)}
                  >
                    Skip
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1" role="group" aria-label="Month">
          <button type="button" className="btn-ghost border border-slate-300 px-2 py-1" aria-label={`Previous: ${periodLabel(shiftPeriod(month, -1))}`} onClick={() => goMonth(shiftPeriod(month, -1).start)}>
            ‹
          </button>
          <span className="min-w-[9rem] px-2 text-center text-sm font-semibold" data-testid="expenses-month">
            {periodLabel(month)}
          </span>
          <button
            type="button"
            className="btn-ghost border border-slate-300 px-2 py-1"
            aria-label={`Next: ${periodLabel(shiftPeriod(month, 1))}`}
            disabled={current}
            onClick={() => goMonth(shiftPeriod(month, 1).start)}
          >
            ›
          </button>
        </div>
        <Link to={`/reports?report=profit&period=month&at=${month.start}`} className="text-sm text-brand-700 hover:underline">
          Profit & loss report →
        </Link>
      </div>

      {alerts && alerts.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" aria-label="Spending alerts">
          {alerts.map((a) => (
            <li key={a.category.id}>
              <span aria-hidden="true">▲ </span>
              <span className="font-medium">{a.category.name}</span> is {pct(a.rise)} above its usual level: {formatINR(a.amount)} against an average of {formatINR(a.average)}.
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile testId="tile-expenses" label={current ? 'Spent this month' : 'Spent'} value={totals ? formatINR(totals.expenses) : '—'} sub={totals ? `${formatINR(totals.fixed)} fixed` : undefined} />
        <Tile testId="tile-collected" label="Collected" value={totals ? formatINR(totals.collected) : '—'} />
        <Tile
          testId="tile-net"
          label="Net profit"
          value={totals ? formatINR(totals.net) : '—'}
          tone={totals && totals.net < 0 ? 'bad' : undefined}
          sub={totals?.margin != null ? `${pct(totals.margin)} margin` : undefined}
        />
        <Tile
          testId="tile-cash"
          label="Cash in hand today"
          value={cash ? formatINR(cash.in - cash.out) : '—'}
          sub={cash ? `${formatINR(cash.in)} in · ${formatINR(cash.out)} out` : undefined}
        />
      </div>

      {spent.length > 0 && totals && (
        <section className="card" aria-labelledby="split-heading">
          <h2 id="split-heading" className="mb-2 font-semibold">
            By category
          </h2>
          <ul className="space-y-1.5">
            {spent.map((c) => {
              const amt = totals.byCategory[c.id]
              const share = amt / (totals.expenses || 1)
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    aria-pressed={filter === c.id}
                    onClick={() => setFilter((f) => (f === c.id ? undefined : c.id))}
                    className={`w-full rounded-md px-2 py-1 text-left text-sm hover:bg-slate-50 ${filter === c.id ? 'bg-slate-100' : ''}`}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">{c.name}</span>
                      <span className="tabular-nums text-slate-700">
                        {formatINR(amt)} <span className="text-xs text-slate-500">{pct(share)}</span>
                      </span>
                    </span>
                    <span className="mt-1 block h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                      <span className="block h-full rounded-full" style={{ width: `${Math.max(2, share * 100)}%`, background: colorOf(c.id) }} />
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          {filter && (
            <p className="mt-2 text-xs text-slate-500">
              Showing {name(filter)} only.{' '}
              <button type="button" className="text-brand-700 underline" onClick={() => setFilter(undefined)}>
                Show all
              </button>
            </p>
          )}
        </section>
      )}

      <section className="card p-0" aria-labelledby="list-heading">
        <h2 id="list-heading" className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">
          {periodLabel(month)} <span className="font-normal text-slate-500">({shown?.length ?? 0})</span>
        </h2>
        {shown && shown.length === 0 && <p className="px-4 py-3 text-sm text-slate-500">No expenses recorded for this month.</p>}
        <div data-testid="expense-list">
          {[...byDate].map(([date, items]) => (
            <div key={date}>
              <h3 className="bg-slate-50 px-4 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{formatDate(date)}</h3>
              <ul className="divide-y divide-slate-100">
                {items.map((e) => (
                  <li key={e.id}>
                    <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm hover:bg-slate-50" onClick={() => setDialog({ kind: 'edit', expense: e })}>
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 font-medium">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorOf(e.category) }} aria-hidden="true" />
                          {name(e.category)}
                          {withReceipts?.has(e.id) && (
                            <span className="text-xs font-normal text-slate-500" title="Receipt attached">
                              <span aria-hidden="true">📎</span>
                              <span className="sr-only">Receipt attached</span>
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-xs text-slate-500">
                          {[e.note, EXPENSE_MODE_LABEL[e.mode], e.forMonth && `for ${monthName(e.forMonth)}`].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums">{formatINR(e.amount)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="card" aria-labelledby="recurring-heading" data-testid="recurring-card">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="recurring-heading" className="font-semibold">
            Recurring
          </h2>
          <button type="button" className="btn-ghost border border-slate-300 px-3 py-1 text-sm" onClick={() => setDialog({ kind: 'recurring' })}>
            + Add recurring
          </button>
        </div>
        {rules && rules.length === 0 && <p className="mt-2 text-sm text-slate-500">Add rent and other monthly payments to be reminded when they are due.</p>}
        <ul className="mt-2 divide-y divide-slate-100">
          {rules?.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0">
                <span className="font-medium">{name(r.category)}</span>
                {r.paused && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Paused</span>}
                <span className="block text-xs text-slate-500">
                  {formatINR(r.amount)} on day {r.day} each month · {EXPENSE_MODE_LABEL[r.mode]}
                  {r.note && ` · ${r.note}`}
                </span>
              </span>
              <span className="flex shrink-0 gap-2">
                <button type="button" className="btn-ghost px-2 py-1" onClick={() => setRecurringPaused(r.id, !r.paused)} aria-label={`${r.paused ? 'Resume' : 'Pause'} ${name(r.category)}`}>
                  {r.paused ? 'Resume' : 'Pause'}
                </button>
                <button type="button" className="btn-ghost border border-slate-300 px-2 py-1" onClick={() => setDialog({ kind: 'recurring', rule: r })} aria-label={`Edit ${name(r.category)}`}>
                  Edit
                </button>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {dialog?.kind === 'add' && <ExpenseDialog onClose={() => setDialog(undefined)} />}
      {dialog?.kind === 'edit' && <ExpenseDialog expense={dialog.expense} onClose={() => setDialog(undefined)} />}
      {dialog?.kind === 'pay' && <ExpenseDialog due={dialog.due} onClose={() => setDialog(undefined)} />}
      {dialog?.kind === 'recurring' && <RecurringDialog rule={dialog.rule} onClose={() => setDialog(undefined)} />}
      {dialog?.kind === 'categories' && <CategoriesDialog onClose={() => setDialog(undefined)} />}
    </div>
  )
}
