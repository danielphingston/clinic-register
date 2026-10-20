import { bucketLabel, type DateRange } from '../../lib/dateRange'
import { formatDate, formatINR, todayISO } from '../../lib/format'
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
} from './reportQueries'

// A report rendered as data, so the screen, the print view and the Excel
// export all show the same thing.

export type ReportType = 'op-register' | 'patients' | 'revenue' | 'dues' | 'top-remedies' | 'stock' | 'appointments'

export const REPORTS: { type: ReportType; label: string }[] = [
  { type: 'op-register', label: 'OP Register' },
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

export type ColType = 'text' | 'int' | 'money' | 'qty' | 'date' | 'percent'
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
}

export interface Tile {
  label: string
  value: number
  type: 'int' | 'money' | 'percent'
  hint?: string
}

export interface ChartSeries {
  key: string
  label: string
  color: string
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

export interface ReportResult {
  type: ReportType
  title: string
  range: DateRange
  note?: string
  tiles: Tile[]
  tables: ReportTable[]
  charts: ChartSpec[]
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
    default:
      return String(v)
  }
}

export function formatTile(t: Tile): string {
  return formatCell(t.value, t.type)
}

const sumBy = (rows: Record<string, Cell>[], key: string) => Math.round(rows.reduce((s, r) => s + (Number(r[key]) || 0), 0) * 100) / 100

export async function buildReport(type: ReportType, range: DateRange, today = todayISO()): Promise<ReportResult> {
  const base = { type, title: REPORT_LABEL[type], range }
  switch (type) {
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
