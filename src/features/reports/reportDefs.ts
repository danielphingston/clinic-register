import { bucketLabel, rangeLabel, type DateRange } from '../../lib/dateRange'
import { periodOf, type Period } from '../../lib/period'
import { formatDate, formatINR, todayISO } from '../../lib/format'
import type { PaymentMode } from '../../db/types'
import { AGEING_LABEL, MODE_LABEL, type AgeingKey } from '../billing/billingRepo'
import { STATUS_LABEL } from '../appointments/appointmentRepo'
import { FORM_LABEL, formatQty } from '../stock/stockLogic'
import {
  AGE_BANDS,
  appointmentsReport,
  duesReport,
  opRegister,
  patientsSummary,
  revenueReport,
  stockReport,
  topRemedies,
  trendsData,
  type TrendTotals,
} from './reportQueries'
import { EXPECT_BACK_DAYS, FOLLOW_UP_DAYS, remedyKey, trendsInsights, WEEKDAYS, type InsightTotals, type TrendsInsights } from './trendsQueries'

// A report rendered as data, so the screen, the print view and the Excel
// export all show the same thing.

export type ReportType = 'op-register' | 'trends' | 'patients' | 'revenue' | 'dues' | 'top-remedies' | 'stock' | 'appointments'

export const REPORTS: { type: ReportType; label: string }[] = [
  { type: 'op-register', label: 'OP Register' },
  { type: 'trends', label: 'Trends' },
  { type: 'patients', label: 'Patients' },
  { type: 'revenue', label: 'Revenue' },
  { type: 'dues', label: 'Dues' },
  { type: 'top-remedies', label: 'Top remedies' },
  { type: 'stock', label: 'Stock' },
  { type: 'appointments', label: 'Appointments' },
]

export const REPORT_LABEL = Object.fromEntries(REPORTS.map((r) => [r.type, r.label])) as Record<ReportType, string>

export function isReportType(s: string | null | undefined): s is ReportType {
  return !!s && s in REPORT_LABEL
}

// 'change' is a signed fraction (0.12 = +12%), for period-on-period changes.
export type ColType = 'text' | 'int' | 'money' | 'qty' | 'date' | 'percent' | 'change'
export type Cell = string | number | null

export interface Column {
  key: string
  header: string
  type: ColType
}

export interface ReportTable {
  title: string
  columns: Column[]
  rows: Record<string, Cell>[]
  totals?: Record<string, Cell>
  // Optional link per row (screen only).
  links?: (string | undefined)[]
  // Optional row highlight (screen + print): 'warn' | 'bad'.
  tones?: ('warn' | 'bad' | undefined)[]
  // Numeric columns shaded by value, as a heatmap (screen + print).
  heat?: string[]
}

export interface Tile {
  label: string
  value: number | null // null: nothing to measure (shown as —)
  type: 'int' | 'money' | 'percent'
  hint?: string
  // Earlier periods to compare with. Counts and money change in %, rates in
  // percentage points.
  compare?: { label: string; value: number | null }[]
  // A rise is bad news (no-shows, dues): rises show red, falls green.
  lowerIsBetter?: boolean
}

export interface ChartSeries {
  key: string
  label: string
  color: string
  // Drawn as a line over the bars of a 'bar' chart.
  line?: boolean
}

export interface ChartSpec {
  kind: 'bar' | 'line' | 'hbar'
  title: string
  xKey: string
  data: Record<string, string | number>[]
  series: ChartSeries[]
  money?: boolean
  stacked?: boolean
}

export interface ReportSection {
  title: string
  note?: string
  tiles: Tile[]
  tables: ReportTable[]
  charts: ChartSpec[]
}

export interface ReportResult {
  type: ReportType
  title: string
  range: DateRange
  note?: string
  tiles: Tile[]
  tables: ReportTable[]
  charts: ChartSpec[]
  // Further headed parts after the main tiles, charts and tables.
  sections?: ReportSection[]
}

// Validated categorical order (brand green first).
export const SERIES_COLORS = ['#17805e', '#c2410c', '#6366f1', '#0891b2']

export function formatCell(v: Cell, type: ColType): string {
  if (v == null || v === '') return ''
  if (typeof v === 'string') return type === 'date' ? formatDate(v) : v
  switch (type) {
    case 'money':
      return formatINR(v)
    case 'qty':
      return formatQty(v)
    case 'percent':
      return `${Math.round(v * 1000) / 10}%`
    case 'change': {
      const pct = Math.round(Math.abs(v) * 1000) / 10
      return pct === 0 ? '0%' : `${v > 0 ? '+' : '−'}${pct}%`
    }
    default:
      return String(v)
  }
}

// Change from `prev` to `cur` as a fraction; null when there is nothing to
// compare with (prev is 0).
export function pctChange(cur: number | null, prev: number | null): number | null {
  return cur == null || prev == null || prev === 0 ? null : (cur - prev) / prev
}

export interface TileChange {
  dir: 'up' | 'down' | 'flat'
  text: string // "12%" or "4.5 pts", without a sign
  good: boolean | null // null when flat
  value: number // the signed change: a fraction, or points for rates
}

// A tile's change against an earlier value; null when there is nothing to
// compare (either value missing, or a count/amount that was 0 before).
export function tileChange(t: Pick<Tile, 'type' | 'value' | 'lowerIsBetter'>, prev: number | null): TileChange | null {
  if (t.value == null || prev == null) return null
  let value: number
  let text: string
  if (t.type === 'percent') {
    value = Math.round((t.value - prev) * 1000) / 10
    text = `${Math.abs(value)} pts`
  } else {
    const pct = pctChange(t.value, prev)
    if (pct == null) return null
    value = pct
    text = formatCell(Math.abs(pct), 'percent')
  }
  const rounded = t.type === 'percent' ? value : Math.round(value * 1000) / 10
  if (rounded === 0) return { dir: 'flat', text: '0%', good: null, value: 0 }
  const up = value > 0
  return { dir: up ? 'up' : 'down', text, good: up !== !!t.lowerIsBetter, value }
}

// Plain-text change for print: "▲ 12% vs October 2026".
export function changeLine(t: Tile, c: { label: string; value: number | null }): string {
  const ch = tileChange(t, c.value)
  const mark = !ch ? '—' : ch.dir === 'flat' ? '± 0%' : `${ch.dir === 'up' ? '▲' : '▼'} ${ch.text}`
  return `${mark} vs ${c.label}`
}

export function formatTile(t: Tile): string {
  return t.value == null ? '—' : formatCell(t.value, t.type)
}

const sumBy = (rows: Record<string, Cell>[], key: string) => Math.round(rows.reduce((s, r) => s + (Number(r[key]) || 0), 0) * 100) / 100

// `period` is used by the Trends report only (default: the current month);
// the other reports use `range`.
export async function buildReport(type: ReportType, range: DateRange, today = todayISO(), period?: Period): Promise<ReportResult> {
  const base = { type, title: REPORT_LABEL[type], range }
  switch (type) {
    case 'trends':
      return trendsReport(period ?? periodOf('month', today), today)
    case 'op-register': {
      const rows = await opRegister(range)
      const table: ReportTable = {
        title: 'OP Register',
        columns: [
          { key: 'sNo', header: 'S.No', type: 'int' },
          { key: 'date', header: 'Date', type: 'date' },
          { key: 'opNo', header: 'OP No', type: 'text' },
          { key: 'name', header: 'Name', type: 'text' },
          { key: 'ageSex', header: 'Age/Sex', type: 'text' },
          { key: 'visitType', header: 'New/Revisit', type: 'text' },
          { key: 'complaint', header: 'Complaint', type: 'text' },
          { key: 'remedies', header: 'Remedies', type: 'text' },
          { key: 'consultation', header: 'Consultation fee', type: 'money' },
          { key: 'billed', header: 'Bill total', type: 'money' },
          { key: 'paid', header: 'Paid', type: 'money' },
        ],
        rows: rows.map(({ isNew, ...r }) => ({ ...r, visitType: isNew ? 'New' : 'Revisit' })),
        links: rows.map((r) => `/patients/${r.patientId}/visits/${r.visitId}`),
      }
      table.totals = { name: 'Total', consultation: sumBy(table.rows, 'consultation'), billed: sumBy(table.rows, 'billed'), paid: sumBy(table.rows, 'paid') }
      const newCount = rows.filter((r) => r.isNew).length
      return {
        ...base,
        tiles: [
          { label: 'Visits', value: rows.length, type: 'int' },
          { label: 'New', value: newCount, type: 'int' },
          { label: 'Revisit', value: rows.length - newCount, type: 'int' },
          { label: 'Consultation billed', value: Number(table.totals.consultation), type: 'money' },
        ],
        tables: [table],
        charts: [],
      }
    }
    case 'patients': {
      const s = await patientsSummary(range)
      const unit = s.granularity === 'day' ? 'Date' : 'Month'
      const trend = s.buckets.map((b) => ({ key: b.key, label: s.granularity === 'day' ? b.key : bucketLabel(b.key), newCount: b.newCount, revisit: b.revisit, total: b.total }))
      const people = s.distinctPatients || 1
      return {
        ...base,
        tiles: [
          { label: 'Visits', value: s.visits, type: 'int' },
          { label: 'Patients seen', value: s.distinctPatients, type: 'int' },
          { label: 'New', value: s.newCount, type: 'int' },
          { label: 'Revisit', value: s.revisit, type: 'int' },
        ],
        tables: [
          {
            title: s.granularity === 'day' ? 'Daily visits' : 'Monthly visits',
            columns: [
              { key: 'label', header: unit, type: s.granularity === 'day' ? 'date' : 'text' },
              { key: 'newCount', header: 'New', type: 'int' },
              { key: 'revisit', header: 'Revisit', type: 'int' },
              { key: 'total', header: 'Total', type: 'int' },
            ],
            rows: trend,
            totals: { label: 'Total', newCount: s.newCount, revisit: s.revisit, total: s.visits },
          },
          {
            title: 'By sex (patients seen)',
            columns: [
              { key: 'group', header: 'Sex', type: 'text' },
              { key: 'count', header: 'Patients', type: 'int' },
              { key: 'share', header: 'Share', type: 'percent' },
            ],
            rows: (
              [
                ['Male', s.bySex.M],
                ['Female', s.bySex.F],
                ['Other', s.bySex.O],
                ['Not recorded', s.bySex.U],
              ] as const
            ).map(([group, count]) => ({ group, count, share: count / people })),
          },
          {
            title: 'By age band (patients seen)',
            columns: [
              { key: 'group', header: 'Age', type: 'text' },
              { key: 'count', header: 'Patients', type: 'int' },
              { key: 'share', header: 'Share', type: 'percent' },
            ],
            rows: AGE_BANDS.map((band) => ({ group: band, count: s.byAge[band], share: s.byAge[band] / people })),
          },
        ],
        charts: [
          {
            kind: 'bar',
            stacked: true,
            title: s.granularity === 'day' ? 'Visits per day' : 'Visits per month',
            xKey: 'x',
            data: trend.map((t) => ({ x: bucketLabel(t.key), newCount: t.newCount, revisit: t.revisit })),
            series: [
              { key: 'newCount', label: 'New', color: SERIES_COLORS[0] },
              { key: 'revisit', label: 'Revisit', color: SERIES_COLORS[2] },
            ],
          },
        ],
      }
    }
    case 'revenue': {
      const r = await revenueReport(range)
      const day = r.granularity === 'day'
      return {
        ...base,
        note: 'Billed = bills dated in the range (after discount). Collected = payments received in the range, whatever the bill date. Medicine = bill lines linked to stock or starting with a remedy name; the rest counts as consultation (amounts before discount).',
        tiles: [
          { label: 'Billed', value: r.billed, type: 'money', hint: `${r.billCount} bills` },
          { label: 'Collected', value: r.collected, type: 'money', hint: `${r.paymentCount} payments` },
          { label: 'Discounts', value: r.discount, type: 'money' },
          { label: 'Consultation', value: r.consultation, type: 'money' },
          { label: 'Medicine', value: r.medicine, type: 'money' },
        ],
        tables: [
          {
            title: day ? 'Billed vs collected per day' : 'Billed vs collected per month',
            columns: [
              { key: 'label', header: day ? 'Date' : 'Month', type: day ? 'date' : 'text' },
              { key: 'billed', header: 'Billed', type: 'money' },
              { key: 'collected', header: 'Collected', type: 'money' },
            ],
            rows: r.buckets.map((b) => ({ label: day ? b.key : bucketLabel(b.key), billed: b.billed, collected: b.collected })),
            totals: { label: 'Total', billed: r.billed, collected: r.collected },
          },
          {
            title: 'Collections by mode',
            columns: [
              { key: 'mode', header: 'Mode', type: 'text' },
              { key: 'amount', header: 'Amount', type: 'money' },
            ],
            rows: (Object.keys(r.byMode) as (keyof typeof r.byMode)[]).map((m) => ({ mode: MODE_LABEL[m], amount: r.byMode[m] })),
            totals: { mode: 'Total', amount: r.collected },
          },
          {
            title: 'Billing split',
            columns: [
              { key: 'part', header: 'Part', type: 'text' },
              { key: 'amount', header: 'Amount', type: 'money' },
            ],
            rows: [
              { part: 'Consultation & other', amount: r.consultation },
              { part: 'Medicine', amount: r.medicine },
              { part: 'Less discounts', amount: -r.discount },
            ],
            totals: { part: 'Billed', amount: r.billed },
          },
        ],
        charts: [
          {
            kind: day && r.buckets.length > 1 ? 'line' : 'bar',
            title: day ? 'Billed vs collected per day' : 'Billed vs collected per month',
            xKey: 'x',
            money: true,
            data: r.buckets.map((b) => ({ x: bucketLabel(b.key), billed: b.billed, collected: b.collected })),
            series: [
              { key: 'billed', label: 'Billed', color: SERIES_COLORS[2] },
              { key: 'collected', label: 'Collected', color: SERIES_COLORS[0] },
            ],
          },
        ],
      }
    }
    case 'dues': {
      const d = await duesReport(today)
      const keys = Object.keys(AGEING_LABEL) as AgeingKey[]
      return {
        ...base,
        note: `Dues are as of today (${formatDate(d.asOf)}); the date range does not apply. Ageing counts days past each bill's due date.`,
        tiles: [
          { label: 'Outstanding', value: d.total, type: 'money' },
          { label: 'Overdue', value: d.overdue, type: 'money' },
          { label: 'Patients with dues', value: d.patients.length, type: 'int' },
        ],
        tables: [
          {
            title: 'Ageing',
            columns: [
              { key: 'bucket', header: 'Days overdue', type: 'text' },
              { key: 'count', header: 'Bills', type: 'int' },
              { key: 'amount', header: 'Amount', type: 'money' },
            ],
            rows: keys.map((k) => ({ bucket: AGEING_LABEL[k], count: d.ageing[k].count, amount: d.ageing[k].amount })),
            totals: { bucket: 'Total', count: keys.reduce((s, k) => s + d.ageing[k].count, 0), amount: d.total },
          },
          {
            title: 'Outstanding by patient',
            columns: [
              { key: 'opNo', header: 'OP No', type: 'text' },
              { key: 'name', header: 'Name', type: 'text' },
              { key: 'phone', header: 'Phone', type: 'text' },
              { key: 'bills', header: 'Bills', type: 'int' },
              { key: 'oldestDue', header: 'Oldest due', type: 'date' },
              { key: 'daysOverdue', header: 'Days overdue', type: 'int' },
              { key: 'balance', header: 'Balance', type: 'money' },
            ],
            rows: d.patients.map((p) => ({
              opNo: p.patient.opNo,
              name: p.patient.name,
              phone: p.patient.phone ?? '',
              bills: p.billCount,
              oldestDue: p.oldestDueDate,
              daysOverdue: Math.max(0, p.daysOverdue),
              balance: p.balance,
            })),
            links: d.patients.map((p) => `/patients/${p.patient.id}`),
            tones: d.patients.map((p) => (p.daysOverdue > 0 ? 'warn' : undefined)),
            totals: { name: 'Total', balance: d.total },
          },
        ],
        charts: [
          {
            kind: 'bar',
            title: 'Outstanding by age',
            xKey: 'x',
            money: true,
            data: keys.map((k) => ({ x: AGEING_LABEL[k], amount: d.ageing[k].amount })),
            series: [{ key: 'amount', label: 'Amount', color: SERIES_COLORS[1] }],
          },
        ],
      }
    }
    case 'top-remedies': {
      const rows = await topRemedies(range)
      return {
        ...base,
        tiles: [
          { label: 'Prescriptions', value: rows.reduce((s, r) => s + r.count, 0), type: 'int', hint: 'remedy rows' },
          { label: 'Remedy + potency combinations', value: rows.length, type: 'int' },
        ],
        tables: [
          {
            title: 'Most prescribed',
            columns: [
              { key: 'rank', header: '#', type: 'int' },
              { key: 'remedyName', header: 'Remedy', type: 'text' },
              { key: 'potency', header: 'Potency', type: 'text' },
              { key: 'count', header: 'Times prescribed', type: 'int' },
              { key: 'patients', header: 'Patients', type: 'int' },
            ],
            rows: rows.map((r, i) => ({ rank: i + 1, ...r })),
          },
        ],
        charts: rows.length
          ? [
              {
                kind: 'hbar',
                title: 'Top 10',
                xKey: 'x',
                data: rows.slice(0, 10).map((r) => ({ x: `${r.remedyName} ${r.potency}`, count: r.count })),
                series: [{ key: 'count', label: 'Times prescribed', color: SERIES_COLORS[0] }],
              },
            ]
          : [],
      }
    }
    case 'stock': {
      const rows = await stockReport(range)
      const live = rows.filter((r) => !r.deleted)
      return {
        ...base,
        note: 'Used = net quantity dispensed in the range (visit edits net out). Purchased includes opening stock entered in the range. Qty is the current balance.',
        tiles: [
          { label: 'Stock items', value: live.length, type: 'int' },
          { label: 'Items used', value: rows.filter((r) => r.used > 0).length, type: 'int' },
          { label: 'Low stock', value: live.filter((r) => r.status === 'low').length, type: 'int' },
          { label: 'Out / negative', value: live.filter((r) => r.status === 'out').length, type: 'int' },
        ],
        tables: [
          {
            title: 'Stock usage',
            columns: [
              { key: 'remedyName', header: 'Remedy', type: 'text' },
              { key: 'potency', header: 'Potency', type: 'text' },
              { key: 'form', header: 'Form', type: 'text' },
              { key: 'unit', header: 'Unit', type: 'text' },
              { key: 'used', header: 'Used', type: 'qty' },
              { key: 'purchased', header: 'Purchased', type: 'qty' },
              { key: 'qty', header: 'Current qty', type: 'qty' },
              { key: 'flag', header: 'Status', type: 'text' },
            ],
            rows: rows.map((r) => ({
              remedyName: r.remedyName,
              potency: r.potency,
              form: FORM_LABEL[r.form],
              unit: r.unit,
              used: r.used,
              purchased: r.purchased,
              qty: r.qty,
              flag: r.deleted ? 'Deleted' : r.negative ? 'Negative' : r.status === 'out' ? 'Out' : r.status === 'low' ? 'Low' : '',
            })),
            links: rows.map((r) => (r.deleted ? undefined : `/stock/${r.stockItemId}`)),
            tones: rows.map((r) => (r.deleted ? undefined : r.status === 'out' ? 'bad' : r.status === 'low' ? 'warn' : undefined)),
          },
        ],
        charts: rows.some((r) => r.used > 0)
          ? [
              {
                kind: 'hbar',
                title: 'Most used (top 10)',
                xKey: 'x',
                data: rows
                  .filter((r) => r.used > 0)
                  .slice(0, 10)
                  .map((r) => ({ x: `${r.remedyName} ${r.potency} (${r.unit})`, used: r.used })),
                series: [{ key: 'used', label: 'Used', color: SERIES_COLORS[3] }],
              },
            ]
          : [],
      }
    }
    case 'appointments': {
      const a = await appointmentsReport(range)
      const statuses = Object.keys(a.byStatus) as (keyof typeof a.byStatus)[]
      return {
        ...base,
        note: 'Completed = arrived or done. No-show rate = no-shows ÷ (completed + no-shows). Walk-ins are patients added to the queue without a booking.',
        tiles: [
          { label: 'Appointments', value: a.total, type: 'int' },
          { label: 'Completed', value: a.attended, type: 'int' },
          { label: 'No-show', value: a.byStatus['no-show'], type: 'int' },
          { label: 'Cancelled', value: a.byStatus.cancelled, type: 'int' },
          { label: 'No-show rate', value: a.noShowRate, type: 'percent' },
          { label: 'Walk-ins', value: a.walkIns, type: 'int', hint: `${a.booked} booked` },
        ],
        tables: [
          {
            title: 'By status',
            columns: [
              { key: 'status', header: 'Status', type: 'text' },
              { key: 'count', header: 'Count', type: 'int' },
            ],
            rows: [
              ...statuses.map((s) => ({ status: s === 'booked' ? 'Booked (pending)' : STATUS_LABEL[s], count: a.byStatus[s] })),
              { status: 'Walk-ins', count: a.walkIns },
              { status: 'Booked in advance', count: a.booked },
            ],
            totals: { status: 'Total', count: a.total },
          },
        ],
        charts: [
          {
            kind: 'bar',
            stacked: true,
            title: a.granularity === 'day' ? 'Per day' : 'Per month',
            xKey: 'x',
            data: a.buckets.map((b) => ({ x: bucketLabel(b.key), attended: b.attended, noShow: b.noShow, cancelled: b.cancelled })),
            series: [
              { key: 'attended', label: 'Completed', color: SERIES_COLORS[0] },
              { key: 'noShow', label: 'No-show', color: SERIES_COLORS[1] },
              { key: 'cancelled', label: 'Cancelled', color: SERIES_COLORS[2] },
            ],
          },
        ],
      }
    }
  }
}

// ---- trends ----

const MODES: PaymentMode[] = ['cash', 'upi', 'card', 'other']

const TREND_METRICS: { key: Exclude<keyof TrendTotals, 'byMode'>; label: string; money: boolean }[] = [
  { key: 'visits', label: 'Visits', money: false },
  { key: 'patients', label: 'Patients seen', money: false },
  { key: 'newPatients', label: 'New patients', money: false },
  { key: 'returning', label: 'Returning patients', money: false },
  { key: 'collected', label: 'Collected', money: true },
  { key: 'billed', label: 'Billed', money: true },
]

async function trendsReport(period: Period, today: string): Promise<ReportResult> {
  const t = await trendsData(period, today)
  const insights = await trendsInsights(t.windows, t, today)
  const { current: cw, previous: pw, lastYear: lw } = t.windows
  const g = t.granularity
  const unit = g === 'day' ? 'day' : g === 'week' ? 'week' : 'month'
  const label = (b: (typeof t.buckets)[number]) => (g === 'month' ? bucketLabel(b.key) : bucketLabel(b.from))
  const compareTable = (title: string, money: boolean): ReportTable => {
    const type = money ? 'money' : 'int'
    return {
      title,
      columns: [
        { key: 'metric', header: 'Measure', type: 'text' },
        { key: 'current', header: cw.label, type },
        { key: 'previous', header: pw.label, type },
        { key: 'vsPrevious', header: 'Change', type: 'change' },
        { key: 'lastYear', header: lw.label, type },
        { key: 'vsLastYear', header: 'Change', type: 'change' },
      ],
      rows: TREND_METRICS.filter((m) => m.money === money).map((m) => ({
        metric: m.label,
        current: t.current[m.key],
        previous: t.previous[m.key],
        vsPrevious: pctChange(t.current[m.key], t.previous[m.key]),
        lastYear: t.lastYear[m.key],
        vsLastYear: pctChange(t.current[m.key], t.lastYear[m.key]),
      })),
    }
  }
  const modes = MODES.filter((m) => t.current.byMode[m] || t.previous.byMode[m] || t.lastYear.byMode[m])
  const collected = t.current.collected || 1
  const inProgress = t.windows.partial
    ? `${cw.label} is still running, so it is counted to today and compared with the same days of the earlier periods: ${rangeLabel(pw.range)} and ${rangeLabel(lw.range)}.`
    : `Compared with ${pw.label} and ${lw.label}.`

  return {
    type: 'trends',
    title: `Trends: ${cw.label}`,
    range: cw.range,
    note: `${inProgress} Collected = payments received, whatever the bill date. Billed = bills dated in the period, after discount. New patients = first-ever visit in the period; returning = seen in the period, first visit earlier.`,
    tiles: TREND_METRICS.map((m) => ({
      label: m.label,
      value: t.current[m.key],
      type: m.money ? 'money' : 'int',
      compare: [
        { label: pw.label, value: t.previous[m.key] },
        { label: lw.label, value: t.lastYear[m.key] },
      ],
    })),
    charts: [
      {
        kind: 'bar',
        stacked: true,
        title: `Visits per ${unit}`,
        xKey: 'x',
        data: t.buckets.map((b) => ({ x: label(b), newCount: b.newCount, revisit: b.revisit })),
        series: [
          { key: 'newCount', label: 'New', color: SERIES_COLORS[0] },
          { key: 'revisit', label: 'Revisit', color: SERIES_COLORS[2] },
        ],
      },
      {
        kind: 'bar',
        stacked: true,
        money: true,
        title: `Collected per ${unit}`,
        xKey: 'x',
        data: t.buckets.map((b) => ({ x: label(b), billed: b.billed, ...b.byMode })),
        series: [
          ...(modes.length ? modes : (['cash'] as PaymentMode[])).map((m) => ({ key: m, label: MODE_LABEL[m], color: SERIES_COLORS[MODES.indexOf(m)] })),
          { key: 'billed', label: 'Billed', color: '#64748b', line: true },
        ],
      },
    ],
    tables: [
      compareTable('Patients compared', false),
      compareTable('Collections compared', true),
      {
        title: `Per ${unit}`,
        columns: [
          { key: 'label', header: g === 'day' ? 'Date' : g === 'week' ? 'Week from' : 'Month', type: g === 'month' ? 'text' : 'date' },
          { key: 'newCount', header: 'New', type: 'int' },
          { key: 'revisit', header: 'Revisit', type: 'int' },
          { key: 'visits', header: 'Visits', type: 'int' },
          { key: 'collected', header: 'Collected', type: 'money' },
          { key: 'billed', header: 'Billed', type: 'money' },
        ],
        rows: t.buckets.map((b) => ({
          label: g === 'month' ? bucketLabel(b.key) : b.from,
          newCount: b.newCount,
          revisit: b.revisit,
          visits: b.visits,
          collected: b.collected,
          billed: b.billed,
        })),
        totals: { label: 'Total', newCount: t.current.newPatients, revisit: t.current.visits - t.current.newPatients, visits: t.current.visits, collected: t.current.collected, billed: t.current.billed },
      },
      {
        title: 'Collections by mode',
        columns: [
          { key: 'mode', header: 'Mode', type: 'text' },
          { key: 'current', header: cw.label, type: 'money' },
          { key: 'share', header: 'Share', type: 'percent' },
          { key: 'previous', header: pw.label, type: 'money' },
          { key: 'lastYear', header: lw.label, type: 'money' },
        ],
        rows: modes.map((m) => ({
          mode: MODE_LABEL[m],
          current: t.current.byMode[m],
          share: t.current.byMode[m] / collected,
          previous: t.previous.byMode[m],
          lastYear: t.lastYear.byMode[m],
        })),
        totals: { mode: 'Total', current: t.current.collected, previous: t.previous.collected, lastYear: t.lastYear.collected },
      },
    ],
    sections: trendSections(insights, t.windows),
  }
}

type Windows = Awaited<ReturnType<typeof trendsData>>['windows']

// A tile for one measure across the three windows.
function insightTile(
  ins: TrendsInsights,
  w: Windows,
  label: string,
  type: Tile['type'],
  get: (x: InsightTotals) => number | null,
  extra: Partial<Tile> = {},
): Tile {
  return {
    label,
    type,
    value: get(ins.current),
    compare: [
      { label: w.previous.label, value: get(ins.previous) },
      { label: w.lastYear.label, value: get(ins.lastYear) },
    ],
    ...extra,
  }
}

const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`

function trendSections(ins: TrendsInsights, w: Windows): ReportSection[] {
  const c = ins.current
  const tile = (label: string, type: Tile['type'], get: (x: InsightTotals) => number | null, extra?: Partial<Tile>) => insightTile(ins, w, label, type, get, extra)
  const fu = c.followUps
  const decided = fu.due - fu.pending
  const ns = c.noShows
  const o = c.outcomes
  const busiest = Math.max(...ins.busy.byWeekday.map((d) => d.average))

  return [
    {
      title: 'Collection health',
      note: 'Collected per visit = collected ÷ visits. Collected ÷ billed passes 100% when old dues are paid off. Outstanding dues = unpaid bill balances at the end of the period (today, while it is running).',
      tiles: [
        tile('Collected per visit', 'money', (x) => x.perVisit),
        tile('Collected ÷ billed', 'percent', (x) => x.collectionRate),
        tile('Outstanding dues', 'money', (x) => x.duesEnd, { lowerIsBetter: true, hint: `${formatINR(ins.duesStart)} at the start` }),
      ],
      charts: [],
      tables: [],
    },
    {
      title: 'Follow-ups',
      note: `A follow-up counts as on time when the patient's next visit is within ${FOLLOW_UP_DAYS} days of the follow-up date, either side. Follow-ups less than ${FOLLOW_UP_DAYS} days past are not counted yet. "Not seen again" = new patients in the period with no visit since, more than ${FOLLOW_UP_DAYS} days after they were due back (their follow-up date, or ${EXPECT_BACK_DAYS} days after the visit when none was set).`,
      tiles: [
        tile('Follow-up adherence', 'percent', (x) => x.followUps.rate, { hint: `${fu.onTime} of ${decided} on time` }),
        tile('Follow-ups due', 'int', (x) => x.followUps.due),
        tile('Not seen again', 'int', (x) => x.notSeenAgain, { lowerIsBetter: true, hint: 'new patients' }),
      ],
      charts: [],
      tables: [
        {
          title: 'Follow-ups due in the period',
          columns: [
            { key: 'outcome', header: 'Outcome', type: 'text' },
            { key: 'count', header: 'Follow-ups', type: 'int' },
            { key: 'share', header: 'Share', type: 'percent' },
          ],
          rows: (
            [
              [`On time (within ${FOLLOW_UP_DAYS} days)`, fu.onTime],
              ['Came back early', fu.early],
              ['Came back late', fu.late],
              ['Did not come back', fu.missed],
              ['Not counted yet', fu.pending],
            ] as const
          ).map(([outcome, count]) => ({ outcome, count, share: fu.due ? count / fu.due : null })),
          totals: { outcome: 'Total', count: fu.due },
        },
        {
          title: 'New patients not seen again',
          columns: [
            { key: 'opNo', header: 'OP No', type: 'text' },
            { key: 'name', header: 'Name', type: 'text' },
            { key: 'phone', header: 'Phone', type: 'text' },
            { key: 'firstVisit', header: 'First visit', type: 'date' },
            { key: 'followUp', header: 'Follow-up date', type: 'date' },
          ],
          rows: ins.notSeenAgain.map((r) => ({ opNo: r.patient.opNo, name: r.patient.name, phone: r.patient.phone ?? '', firstVisit: r.firstVisit, followUp: r.followUpDate ?? '' })),
          links: ins.notSeenAgain.map((r) => `/patients/${r.patient.id}`),
        },
      ],
    },
    {
      title: 'Busy days & no-shows',
      note: 'No-show rate = no-shows ÷ (appointments attended + no-shows). Arrivals by hour counts appointments and walk-ins marked arrived or done, by their booked start time.',
      tiles: [
        tile('No-show rate', 'percent', (x) => x.noShows.rate, { lowerIsBetter: true, hint: `${ns.noShows} of ${ns.attended + ns.noShows} appointments` }),
        tile('Appointments', 'int', (x) => x.noShows.appointments),
      ],
      charts: [
        {
          kind: 'bar',
          title: 'Average visits by weekday',
          xKey: 'x',
          data: ins.busy.byWeekday.map((d) => ({ x: d.day, average: d.average })),
          series: [{ key: 'average', label: 'Visits per day', color: SERIES_COLORS[0] }],
        },
      ],
      tables: [
        {
          title: 'Visits by weekday',
          columns: [
            { key: 'day', header: 'Day', type: 'text' },
            { key: 'visits', header: 'Visits', type: 'int' },
            { key: 'days', header: 'Days in period', type: 'int' },
            { key: 'average', header: 'Visits per day', type: 'qty' },
          ],
          rows: ins.busy.byWeekday.map((d) => ({ ...d })),
          tones: ins.busy.byWeekday.map((d) => (d.average > 0 && d.average === busiest ? 'warn' : undefined)),
        },
        {
          title: 'Arrivals by hour',
          columns: [{ key: 'day', header: 'Day', type: 'text' }, ...ins.busy.hours.map((h) => ({ key: `h${h}`, header: hourLabel(h), type: 'int' as const }))],
          rows: ins.busy.hours.length
            ? WEEKDAYS.map((day, i) => ({ day, ...Object.fromEntries(ins.busy.hours.map((h, j) => [`h${h}`, ins.busy.heat[i][j] || null])) }))
            : [],
          heat: ins.busy.hours.map((h) => `h${h}`),
        },
      ],
    },
    {
      title: 'Clinical trends',
      note: "Complaint progress is what was recorded at each visit about the previous visit's complaints. Diagnoses are those on the records of patients seen in the period.",
      tiles: [
        tile('Complaints improved', 'percent', (x) => x.outcomes.improvedRate, { hint: `${o.byStatus.better + o.byStatus.resolved} of ${o.reviewed} better or resolved` }),
        tile('Complaints resolved', 'int', (x) => x.outcomes.byStatus.resolved),
      ],
      charts: ins.diagnoses.current.length
        ? [
            {
              kind: 'hbar',
              title: 'Top diagnoses',
              xKey: 'x',
              data: ins.diagnoses.current.slice(0, 10).map((d) => ({ x: d.diagnosis, patients: d.patients })),
              series: [{ key: 'patients', label: 'Patients', color: SERIES_COLORS[3] }],
            },
          ]
        : [],
      tables: [
        {
          title: 'Complaint progress',
          columns: [
            { key: 'status', header: 'Progress', type: 'text' },
            { key: 'count', header: 'Complaints', type: 'int' },
            { key: 'share', header: 'Share', type: 'percent' },
          ],
          rows: o.reviewed
            ? (
                [
                  ['Resolved', o.byStatus.resolved],
                  ['Better', o.byStatus.better],
                  ['Same', o.byStatus.persists],
                  ['Worse', o.byStatus.worse],
                ] as const
              ).map(([status, count]) => ({ status, count, share: count / o.reviewed }))
            : [],
          totals: { status: 'Total', count: o.reviewed },
        },
        {
          title: 'Top diagnoses',
          columns: [
            { key: 'diagnosis', header: 'Diagnosis', type: 'text' },
            { key: 'patients', header: 'Patients', type: 'int' },
            { key: 'previous', header: w.previous.label, type: 'int' },
            { key: 'change', header: 'Change', type: 'change' },
          ],
          rows: ins.diagnoses.current.slice(0, 15).map((d) => {
            const prev = ins.diagnoses.previous.get(d.diagnosis.toLowerCase()) ?? 0
            return { diagnosis: d.diagnosis, patients: d.patients, previous: prev, change: pctChange(d.patients, prev) }
          }),
        },
        {
          title: 'Top remedies',
          columns: [
            { key: 'remedyName', header: 'Remedy', type: 'text' },
            { key: 'potency', header: 'Potency', type: 'text' },
            { key: 'count', header: 'Times prescribed', type: 'int' },
            { key: 'previous', header: w.previous.label, type: 'int' },
            { key: 'change', header: 'Change', type: 'change' },
          ],
          rows: ins.remedies.current.slice(0, 15).map((r) => {
            const prev = ins.remedies.previous.get(remedyKey(r)) ?? 0
            return { remedyName: r.remedyName, potency: r.potency, count: r.count, previous: prev, change: pctChange(r.count, prev) }
          }),
        },
      ],
    },
  ]
}
