import { useLiveQuery } from 'dexie-react-hooks'
import { useParams, useSearchParams } from 'react-router-dom'
import { isISODate, rangeLabel } from '../lib/dateRange'
import { formatDate, todayISO } from '../lib/format'
import { trendWindows } from '../lib/period'
import { readPeriod } from '../features/reports/reportUrl'
import { buildReport, isReportType, REPORT_LABEL } from '../features/reports/reportDefs'
import { ReportTableView, Tiles } from '../features/reports/ReportTableView'
import { Letterhead, PrintShell } from './PrintShell'

export default function PrintReport() {
  const { type = '' } = useParams()
  const [params] = useSearchParams()
  const today = todayISO()
  const from = params.get('from')
  const to = params.get('to')
  // Trends is printed by period (?period=…&at=…&fy=1), the rest by date range.
  const trends = type === 'trends'
  const period = readPeriod(params, today)
  const range = trends ? trendWindows(period, today).current.range : { from: from!, to: to! }
  const valid = isReportType(type) && (trends || (isISODate(from) && isISODate(to) && from <= to))
  const report = useLiveQuery(
    async () => (valid ? buildReport(type, range, today, period) : Promise.resolve(null)),
    [type, range.from, range.to, period.kind, period.fy, today, valid],
  )

  if (!valid) return <div className="p-6 text-sm">Unknown report or date range.</div>
  if (!report) return null

  return (
    <PrintShell title={`${REPORT_LABEL[type]} ${range.from} to ${range.to}`} ready landscape={type === 'op-register'}>
      <Letterhead />
      <div className="mt-3 flex items-baseline justify-between gap-4">
        <h1 className="text-[14pt] font-bold">{report.title}</h1>
        <div className="text-[10pt] text-slate-700">{type === 'dues' ? `As of ${formatDate(today)}` : rangeLabel(report.range)}</div>
      </div>
      <Tiles tiles={report.tiles} print />
      {report.note && <p className="mt-1 text-[8.5pt] text-slate-600">{report.note}</p>}
      {report.tables.map((t) => (
        <ReportTableView key={t.title} table={t} print />
      ))}
      {report.sections?.map((sec) => (
        <section key={sec.title} className="mt-5 break-inside-avoid-page">
          <h2 className="border-b border-slate-400 text-[12pt] font-bold">{sec.title}</h2>
          {sec.tiles.length > 0 && <Tiles tiles={sec.tiles} print />}
          {sec.note && <p className="mt-1 text-[8.5pt] text-slate-600">{sec.note}</p>}
          {sec.tables.map((t) => (
            <ReportTableView key={t.title} table={t} print />
          ))}
        </section>
      ))}
      <p className="mt-4 text-[8pt] text-slate-500">Printed {formatDate(today)}</p>
    </PrintShell>
  )
}
