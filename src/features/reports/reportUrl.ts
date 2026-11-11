import { isISODate, presetRange, RANGE_PRESETS, type DateRange, type RangePreset } from '../../lib/dateRange'
import { isPeriodKind, periodOf, type Period } from '../../lib/period'
import { isReportType, type ReportType } from './reportDefs'

export interface ReportState {
  type: ReportType
  preset: RangePreset
  range: DateRange
  period: Period // Trends only
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
// Trends keeps its period instead: ?report=trends&period=month&at=… .
export function readReportState(params: URLSearchParams, today: string): ReportState {
  const report = params.get('report')
  const type: ReportType = isReportType(report) ? report : 'op-register'
  const period = readPeriod(params, today)
  const raw = params.get('range')
  const preset: RangePreset = isPreset(raw) ? raw : 'thisMonth'
  if (preset === 'custom') {
    const from = params.get('from')
    const to = params.get('to')
    if (isISODate(from) && isISODate(to)) return { type, preset, range: from <= to ? { from, to } : { from: to, to: from }, period }
    return { type, preset, range: presetRange('thisMonth', today), period }
  }
  return { type, preset, range: presetRange(preset, today), period }
}

export function reportSearch(s: { type: ReportType; preset: RangePreset; range: DateRange; period?: Period }): string {
  if (s.type === 'trends' && s.period) return `?report=trends&${periodParams(s.period)}`
  const p = new URLSearchParams({ report: s.type, range: s.preset })
  if (s.preset === 'custom') {
    p.set('from', s.range.from)
    p.set('to', s.range.to)
  }
  return `?${p}`
}

export function printReportPath(type: ReportType, range: DateRange, period?: Period): string {
  if (type === 'trends' && period) return `/print/report/trends?${periodParams(period)}`
  return `/print/report/${type}?from=${range.from}&to=${range.to}`
}
