import { useLiveQuery } from 'dexie-react-hooks'
import { useParams, useSearchParams } from 'react-router-dom'
import { isISODate, rangeLabel } from '../lib/dateRange'
import { formatDate, todayISO } from '../lib/format'
import { buildReport, isReportType, REPORT_LABEL } from '../features/reports/reportDefs'
import { ReportTableView, Tiles } from '../features/reports/ReportTableView'
import { Letterhead, PrintShell } from './PrintShell'

export default function PrintReport() {
  const { type = '' } = useParams()
  const [params] = useSearchParams()
  const today = todayISO()
  const from = params.get('from')
  const to = params.get('to')
  const valid = isReportType(type) && isISODate(from) && isISODate(to) && from <= to
  const report = useLiveQuery(
    async () => (valid ? buildReport(type, { from: from!, to: to! }, today) : Promise.resolve(null)),
    [type, from, to, today, valid],
  )

  if (!valid) return <div className="p-6 text-sm">Unknown report or date range.</div>
  if (!report) return null

  return (
    <PrintShell title={`${REPORT_LABEL[type]} ${from} to ${to}`} ready landscape={type === 'op-register'}>
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
      <p className="mt-4 text-[8pt] text-slate-500">Printed {formatDate(today)}</p>
    </PrintShell>
  )
}
