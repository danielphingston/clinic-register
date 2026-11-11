import type * as XLSXNS from 'xlsx'
import type { WorkBook, WorkSheet } from 'xlsx'
import { rangeLabel } from '../../lib/dateRange'
import { formatDate } from '../../lib/format'
import { tileChange, type Cell, type ColType, type ReportResult, type ReportTable } from './reportDefs'

// SheetJS is passed in (rather than imported) so the app can load it only on
// click while tests use it directly.
export type XLSX = typeof XLSXNS

const NUMBER_FORMAT: Partial<Record<ColType, string>> = {
  money: '#,##0.00',
  qty: '#,##0.###',
  percent: '0.0%',
  change: '+0.0%;-0.0%;0.0%',
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

const POINTS_FORMAT = '+0.0" pts";-0.0" pts";0.0" pts"'

// Measures with their values; with comparisons, each earlier value and its
// change. Section tiles follow under their section's title.
function summarySheet(X: XLSX, heading: string, report: ReportResult): WorkSheet {
  const groups = [{ title: '', tiles: report.tiles }, ...(report.sections ?? []).map((s) => ({ title: s.title, tiles: s.tiles }))]
  const labels = groups.flatMap((g) => g.tiles).find((t) => t.compare?.length)?.compare?.map((c) => c.label) ?? []
  const aoa: (string | number)[][] = [[heading], [], ['Measure', 'Value', ...labels.flatMap((l) => [l, 'Change'])]]
  const formats: [number, number, string | undefined][] = []
  for (const g of groups) {
    if (g.title && g.tiles.length) aoa.push([], [g.title])
    for (const t of g.tiles) {
      const r = aoa.length
      const row: (string | number)[] = [t.label, t.value ?? '']
      formats.push([r, 1, NUMBER_FORMAT[t.type]])
      t.compare?.forEach((c, i) => {
        const ch = tileChange(t, c.value)
        row.push(c.value ?? '', ch ? ch.value : '')
        formats.push([r, 2 + i * 2, NUMBER_FORMAT[t.type]], [r, 3 + i * 2, t.type === 'percent' ? POINTS_FORMAT : NUMBER_FORMAT.change])
      })
      aoa.push(row)
    }
  }
  const notes = [report.note, ...(report.sections ?? []).map((s) => s.note && `${s.title}: ${s.note}`)].filter(Boolean) as string[]
  if (notes.length) aoa.push([], ...notes.map((n) => [n]))
  const ws = X.utils.aoa_to_sheet(aoa)
  for (const [r, c, z] of formats) {
    const cell = ws[X.utils.encode_cell({ r, c })]
    if (cell && cell.t === 'n' && z) cell.z = z
  }
  ws['!cols'] = [{ wch: 32 }, { wch: 16 }, ...labels.flatMap((l) => [{ wch: Math.max(16, l.length + 2) }, { wch: 10 }])]
  return ws
}

export function buildReportWorkbook(X: XLSX, report: ReportResult, clinicName: string): WorkBook {
  const wb = X.utils.book_new()
  const heading = reportHeading(report, clinicName)
  const taken = new Set<string>()
  if (report.tiles.length || report.note || report.sections?.length) X.utils.book_append_sheet(wb, summarySheet(X, heading, report), safeSheetName('Summary', taken))
  const tables = [...report.tables, ...(report.sections ?? []).flatMap((s) => s.tables)]
  for (const t of tables) X.utils.book_append_sheet(wb, tableSheet(X, heading, t), safeSheetName(t.title, taken))
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
