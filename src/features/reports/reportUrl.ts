import { isISODate, presetRange, RANGE_PRESETS, type DateRange, type RangePreset } from '../../lib/dateRange'
import { isPeriodKind, periodOf, type Period } from '../../lib/period'
import { isPeriodReport, isReportType, type ReportType } from './reportDefs'
import { isProfitBasis, type ProfitBasis } from './profitQueries'

export interface ReportState {
  type: ReportType
  preset: RangePreset
  range: DateRange
  period: Period // Trends and Profit & loss
  basis: ProfitBasis // Profit & loss only
}

const isPreset = (s: string | null): s is RangePreset => RANGE_PRESETS.some((p) => p.value === s)

// ?period=quarter&at=2026-10-01&fy=1 . Defaults to the current month; a date
// in the future falls back to today's period.
export function readPeriod(params: URLSearchParams, today: string): Period {
  const raw = params.get('period')
  const kind = isPeriodKind(raw) ? raw : 'month'
  const at = params.get('at')
  return periodOf(kind, isISODate(at) && at <= today ? at : today, params.get('fy') === '1')
}

export function periodParams(p: Period): URLSearchParams {
  const q = new URLSearchParams({ period: p.kind, at: p.start })
  if (p.fy) q.set('fy', '1')
  return q
}

// ?report=revenue&range=lastMonth, or &range=custom&from=…&to=… . A preset
// is stored by name so "This month" keeps meaning this month after a reload.
// Trends and Profit & loss keep a period instead: ?report=trends&period=month&at=… ,
// and Profit & loss its income basis (&basis=billed; collected by default).
export function readBasis(params: URLSearchParams): ProfitBasis {
  const b = params.get('basis')
  return isProfitBasis(b) ? b : 'collected'
}

export function readReportState(params: URLSearchParams, today: string): ReportState {
  const report = params.get('report')
  const type: ReportType = isReportType(report) ? report : 'op-register'
  const period = readPeriod(params, today)
  const basis = readBasis(params)
  const raw = params.get('range')
  const preset: RangePreset = isPreset(raw) ? raw : 'thisMonth'
  if (preset === 'custom') {
    const from = params.get('from')
    const to = params.get('to')
    if (isISODate(from) && isISODate(to)) return { type, preset, range: from <= to ? { from, to } : { from: to, to: from }, period, basis }
    return { type, preset, range: presetRange('thisMonth', today), period, basis }
  }
  return { type, preset, range: presetRange(preset, today), period, basis }
}

function periodSearch(type: ReportType, period: Period, basis?: ProfitBasis): string {
  const q = periodParams(period)
  if (type === 'profit' && basis === 'billed') q.set('basis', basis)
  return q.toString()
}

export function reportSearch(s: { type: ReportType; preset: RangePreset; range: DateRange; period?: Period; basis?: ProfitBasis }): string {
  if (isPeriodReport(s.type) && s.period) return `?report=${s.type}&${periodSearch(s.type, s.period, s.basis)}`
  const p = new URLSearchParams({ report: s.type, range: s.preset })
  if (s.preset === 'custom') {
    p.set('from', s.range.from)
    p.set('to', s.range.to)
  }
  return `?${p}`
}

export function printReportPath(type: ReportType, range: DateRange, period?: Period, basis?: ProfitBasis): string {
  if (isPeriodReport(type) && period) return `/print/report/${type}?${periodSearch(type, period, basis)}`
  return `/print/report/${type}?from=${range.from}&to=${range.to}`
}
