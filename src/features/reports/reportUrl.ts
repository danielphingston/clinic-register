import { isISODate, presetRange, RANGE_PRESETS, type DateRange, type RangePreset } from '../../lib/dateRange'
import { isReportType, type ReportType } from './reportDefs'

export interface ReportState {
  type: ReportType
  preset: RangePreset
  range: DateRange
}

const isPreset = (s: string | null): s is RangePreset => RANGE_PRESETS.some((p) => p.value === s)

// ?report=revenue&range=lastMonth, or &range=custom&from=…&to=… . A preset
// is stored by name so "This month" keeps meaning this month after a reload.
export function readReportState(params: URLSearchParams, today: string): ReportState {
  const report = params.get('report')
  const type: ReportType = isReportType(report) ? report : 'op-register'
  const raw = params.get('range')
  const preset: RangePreset = isPreset(raw) ? raw : 'thisMonth'
  if (preset === 'custom') {
    const from = params.get('from')
    const to = params.get('to')
    if (isISODate(from) && isISODate(to)) return { type, preset, range: from <= to ? { from, to } : { from: to, to: from } }
    return { type, preset, range: presetRange('thisMonth', today) }
  }
  return { type, preset, range: presetRange(preset, today) }
}

export function reportSearch(s: { type: ReportType; preset: RangePreset; range: DateRange }): string {
  const p = new URLSearchParams({ report: s.type, range: s.preset })
  if (s.preset === 'custom') {
    p.set('from', s.range.from)
    p.set('to', s.range.to)
  }
  return `?${p}`
}

export function printReportPath(type: ReportType, range: DateRange): string {
  return `/print/report/${type}?from=${range.from}&to=${range.to}`
}
