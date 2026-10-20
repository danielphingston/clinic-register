import type * as XLSXNS from 'xlsx'
import type { WorkBook, WorkSheet } from 'xlsx'
import { rangeLabel } from '../../lib/dateRange'
import { formatDate } from '../../lib/format'
import type { Cell, ColType, ReportResult, ReportTable } from './reportDefs'

// SheetJS is passed in (rather than imported) so the app can load it only on
// click while tests use it directly.
export type XLSX = typeof XLSXNS

const NUMBER_FORMAT: Partial<Record<ColType, string>> = {
  money: '#,##0.00',
  qty: '#,##0.###',
  percent: '0.0%',
  int: '0',
}

function excelValue(v: Cell, type: ColType): string | number {
  if (v == null) return ''
  if (type === 'date' && typeof v === 'string') return formatDate(v)
  return v
}

export function safeSheetName(name: string, taken: Set<string>): string {
  const base = name.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet'
  let out = base
  for (let n = 2; taken.has(out); n++) out = `${base.slice(0, 28)} ${n}`
  taken.add(out)
  return out
}

function tableSheet(X: XLSX, heading: string, t: ReportTable): WorkSheet {
  const header = t.columns.map((c) => c.header)
  const body = t.rows.map((r) => t.columns.map((c) => excelValue(r[c.key] ?? null, c.type)))
  const aoa: (string | number)[][] = [[heading], [t.title], header, ...body]
  if (t.totals) aoa.push(t.columns.map((c) => excelValue(t.totals![c.key] ?? null, c.type)))
  const ws = X.utils.aoa_to_sheet(aoa)
  const firstDataRow = 3
  for (let r = firstDataRow; r < aoa.length; r++) {
    t.columns.forEach((c, ci) => {
      const cell = ws[X.utils.encode_cell({ r, c: ci })]
      const z = NUMBER_FORMAT[c.type]
      if (cell && cell.t === 'n' && z) cell.z = z
    })
  }
  ws['!cols'] = t.columns.map((c, ci) => ({
    wch: Math.min(60, Math.max(c.header.length, ...body.map((row) => String(row[ci] ?? '').length), c.type === 'money' ? 12 : 4) + 2),
  }))
  return ws
}

export function reportHeading(report: Pick<ReportResult, 'title' | 'range'>, clinicName: string): string {
  return [clinicName || 'Clinic', report.title, rangeLabel(report.range)].join(' — ')
}

export function buildReportWorkbook(X: XLSX, report: ReportResult, clinicName: string): WorkBook {
  const wb = X.utils.book_new()
  const heading = reportHeading(report, clinicName)
  const taken = new Set<string>()
  if (report.tiles.length || report.note) {
    const aoa: (string | number)[][] = [[heading], [], ['Measure', 'Value']]
    for (const t of report.tiles) aoa.push([t.label, t.value])
    if (report.note) aoa.push([], [report.note])
    const ws = X.utils.aoa_to_sheet(aoa)
    report.tiles.forEach((t, i) => {
      const cell = ws[X.utils.encode_cell({ r: 3 + i, c: 1 })]
      if (cell) cell.z = NUMBER_FORMAT[t.type]
    })
    ws['!cols'] = [{ wch: 32 }, { wch: 16 }]
    X.utils.book_append_sheet(wb, ws, safeSheetName('Summary', taken))
  }
  for (const t of report.tables) X.utils.book_append_sheet(wb, tableSheet(X, heading, t), safeSheetName(t.title, taken))
  return wb
}

export function reportFileName(report: Pick<ReportResult, 'type' | 'range'>): string {
  return `${report.type}-${report.range.from}-to-${report.range.to}.xlsx`
}

export async function exportReportToExcel(report: ReportResult, clinicName: string): Promise<void> {
  const X = await import('xlsx')
  X.writeFile(buildReportWorkbook(X, report, clinicName), reportFileName(report), { compression: true })
}

// Plain sheets (header row + rows of objects), for the all-data export.
export function buildSheetsWorkbook(X: XLSX, sheets: { name: string; rows: Record<string, string | number | undefined>[] }[]): WorkBook {
  const wb = X.utils.book_new()
  const taken = new Set<string>()
  for (const s of sheets) {
    const ws = s.rows.length ? X.utils.json_to_sheet(s.rows) : X.utils.aoa_to_sheet([['(no records)']])
    X.utils.book_append_sheet(wb, ws, safeSheetName(s.name, taken))
  }
  return wb
}
