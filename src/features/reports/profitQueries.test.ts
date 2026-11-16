import { describe, expect, it } from 'vitest'
import { periodOf } from '../../lib/period'
import { createBill } from '../billing/billingRepo'
import { addCategory, addExpense } from '../expenses/expenseRepo'
import { createPatient } from '../patients/patientRepo'
import { saveVisit } from '../visits/visitRepo'
import { categoryAlerts, monthProfit, profitTotals } from './profitQueries'
import { buildReport } from './reportDefs'

const OCT = { from: '2026-10-01', to: '2026-10-31' }

// October: 2 visits, ₹1,500 billed, ₹1,100 collected (₹600 of it cash).
// Expenses ₹1,000: rent 500 + electricity 100 (fixed), supplies 400 (cash).
// Supplies were ₹100 a month from July to September.
async function fixture() {
  const p = await createPatient({ name: 'Asha' })
  for (const date of ['2026-10-02', '2026-10-10']) await saveVisit({ patientId: p.id, date, caseNotes: {}, items: [] })
  await createBill({ patientId: p.id, date: '2026-10-02', items: [{ desc: 'Consultation', amount: 1000 }], discount: 0, payNow: { amount: 600, mode: 'cash' } })
  await createBill({ patientId: p.id, date: '2026-10-10', items: [{ desc: 'Consultation', amount: 500 }], discount: 0, payNow: { amount: 500, mode: 'upi' } })
  for (const m of ['07', '08', '09']) await addExpense({ date: `2026-${m}-15`, category: 'supplies', amount: 100, mode: 'cash' })
  await addExpense({ date: '2026-10-05', category: 'rent', amount: 500, mode: 'bank' })
  await addExpense({ date: '2026-10-12', category: 'electricity', amount: 100, mode: 'upi' })
  await addExpense({ date: '2026-10-15', category: 'supplies', amount: 400, mode: 'cash' })
}

describe('profitTotals', () => {
  it('works out profit on money collected', async () => {
    await fixture()
    const t = await profitTotals(OCT, 'collected')
    expect(t).toMatchObject({
      income: 1100,
      collected: 1100,
      billed: 1500,
      expenses: 1000,
      net: 100,
      visits: 2,
      costPerVisit: 500,
      fixed: 600,
      variable: 400,
      cashIn: 600,
      cashOut: 400,
      byCategory: { rent: 500, electricity: 100, supplies: 400 },
    })
    expect(t.margin).toBeCloseTo(100 / 1100)
    // Each visit brings (1100 − 400) ÷ 2 = 350 towards ₹600 of fixed costs.
    expect(t.breakEvenVisits).toBe(2)
  })

  it('works out profit on what was billed', async () => {
    await fixture()
    const t = await profitTotals(OCT, 'billed')
    expect(t).toMatchObject({ income: 1500, net: 500 })
    expect(t.margin).toBeCloseTo(500 / 1500)
    expect(t.breakEvenVisits).toBe(2) // 600 ÷ ((1500 − 400) ÷ 2 = 550)
  })

  it('counts added categories marked fixed as fixed costs', async () => {
    await fixture()
    const internet = await addCategory('Internet', true)
    await addExpense({ date: '2026-10-20', category: internet.id, amount: 300, mode: 'upi' })
    expect(await profitTotals(OCT, 'collected')).toMatchObject({ fixed: 900, variable: 400, expenses: 1300 })
  })

  it('has no margin, cost per visit or break-even without income or visits', async () => {
    await addExpense({ date: '2026-10-05', category: 'rent', amount: 500, mode: 'bank' })
    expect(await profitTotals(OCT, 'collected')).toMatchObject({ income: 0, net: -500, margin: null, costPerVisit: null, breakEvenVisits: null })
  })
})

describe('categoryAlerts', () => {
  it('flags a category well above its average over the previous three periods', async () => {
    await fixture()
    const alerts = await categoryAlerts(periodOf('month', '2026-10-01'), '2026-11-16')
    // Supplies: ₹400 against ₹100; electricity has no history, so it is not flagged.
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ amount: 400, average: 100, rise: 3 })
    expect(alerts[0].category.name).toBe('Supplies')
  })

  it('ignores small rises in rupees', async () => {
    for (const m of ['07', '08', '09']) await addExpense({ date: `2026-${m}-15`, category: 'supplies', amount: 100, mode: 'cash' })
    await addExpense({ date: '2026-10-15', category: 'supplies', amount: 250, mode: 'cash' })
    expect(await categoryAlerts(periodOf('month', '2026-10-01'), '2026-11-16')).toEqual([])
  })

  it('compares a running month with the same days of earlier months', async () => {
    for (const m of ['07', '08', '09']) await addExpense({ date: `2026-${m}-25`, category: 'supplies', amount: 1000, mode: 'cash' })
    await addExpense({ date: '2026-10-05', category: 'supplies', amount: 300, mode: 'cash' })
    // By 10 October, earlier months had spent nothing on supplies by their 10th.
    expect(await categoryAlerts(periodOf('month', '2026-10-01'), '2026-10-10')).toEqual([])
  })
})

describe('Profit & loss report', () => {
  it('builds tiles with comparisons, category and per-day tables, cash and alerts', async () => {
    await fixture()
    const r = await buildReport('profit', OCT, '2026-11-16', periodOf('month', '2026-10-01'), 'billed')
    expect(r.title).toBe('Profit & loss: October 2026')
    const tile = (label: string) => r.tiles.find((t) => t.label === label)!
    expect(tile('Income (billed)')).toMatchObject({ value: 1500, compare: [{ label: 'September 2026', value: 0 }, { label: 'October 2025', value: 0 }] })
    expect(tile('Expenses')).toMatchObject({ value: 1000, lowerIsBetter: true, compare: [{ value: 100 }, { value: 0 }] })
    expect(tile('Net profit').value).toBe(500)
    expect(tile('Break-even visits')).toMatchObject({ value: 2, hint: 'Covered: 2 visits' })

    const byCat = r.tables.find((t) => t.title === 'Expenses by category')!
    expect(byCat.rows.map((x) => [x.category, x.kind, x.current, x.previous])).toEqual([
      ['Rent', 'Fixed', 500, 0],
      ['Electricity', 'Fixed', 100, 0],
      ['Supplies', 'Variable', 400, 100],
    ])
    expect(byCat.tones).toEqual([undefined, undefined, 'warn'])

    const perDay = r.tables.find((t) => t.title === 'Per day')!
    expect(perDay.rows).toHaveLength(31)
    expect(perDay.rows[1]).toMatchObject({ label: '2026-10-02', income: 1000, net: 1000 })
    expect(perDay.rows[4]).toMatchObject({ label: '2026-10-05', 'cat:rent': 500, expenses: 500, net: -500 })
    expect(perDay.tones?.[4]).toBe('bad')
    expect(perDay.totals).toMatchObject({ income: 1500, expenses: 1000, net: 500 })

    const cash = r.sections!.find((s) => s.title === 'Cash')!
    expect(cash.tiles.map((t) => t.value)).toEqual([600, 400, 200])
    const alerts = r.sections!.find((s) => s.title === 'Spending alerts')!
    expect(alerts.tables[0].rows).toEqual([{ category: 'Supplies', amount: 400, average: 100, rise: 3 }])

    // Collected basis by default.
    const collected = await buildReport('profit', OCT, '2026-11-16', periodOf('month', '2026-10-01'))
    expect(collected.tiles[0]).toMatchObject({ label: 'Income (collected)', value: 1100 })
  })

  it('runs April to March when asked for a financial year', async () => {
    await fixture()
    const r = await buildReport('profit', OCT, '2027-05-01', periodOf('year', '2026-10-01', true))
    expect(r.title).toBe('Profit & loss: FY 2026–27')
    expect(r.range).toEqual({ from: '2026-04-01', to: '2027-03-31' })
    // Supplies from July count; months are the buckets.
    expect(r.tables.find((t) => t.title === 'Per month')!.rows).toHaveLength(12)
    expect(r.tiles.find((t) => t.label === 'Expenses')!.value).toBe(1300)
  })
})

describe('monthProfit', () => {
  it("gives this month's net so far and last month's over the same days", async () => {
    await fixture()
    expect(await monthProfit('2026-10-20')).toEqual({ net: 100, previous: -100, previousLabel: 'September 2026' })
  })
})
