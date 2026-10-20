import { useLiveQuery } from 'dexie-react-hooks'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { getSettings } from '../../db/repo'
import { presetRange, rangeLabel, RANGE_PRESETS, type RangePreset } from '../../lib/dateRange'
import { todayISO } from '../../lib/format'
import { buildReport, REPORTS, type ReportType } from './reportDefs'
import { printReportPath, readReportState, reportSearch } from './reportUrl'
import { ReportTableView, Tiles } from './ReportTableView'
import { exportReportToExcel } from './excel'

const ReportChart = lazy(() => import('./ReportChart'))

export function ReportsPage() {
  const [params, setParams] = useSearchParams()
  const today = todayISO()
  const state = readReportState(params, today)
  const { type, preset, range } = state
  const report = useLiveQuery(async () => buildReport(type, range, today), [type, range.from, range.to, today])
  const loaded = report && report.type === type && report.range.from === range.from && report.range.to === range.to
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const tabs = useRef<HTMLUListElement>(null)

  // On phones the report tabs scroll sideways; keep the current one visible.
  useEffect(() => {
    tabs.current?.querySelector<HTMLElement>('[aria-current]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [type])

  function go(next: Partial<typeof state>) {
    const merged = { ...state, ...next }
    setParams(new URLSearchParams(reportSearch(merged).slice(1)), { replace: true })
  }

  function choosePreset(p: RangePreset) {
    go({ preset: p, range: p === 'custom' ? range : presetRange(p, today) })
  }

  function setCustom(field: 'from' | 'to', value: string) {
    if (!value) return
    go({ preset: 'custom', range: { ...range, [field]: value } })
  }

  async function exportExcel() {
    if (!report) return
    setExporting(true)
    setError('')
    try {
      const settings = await getSettings()
      await exportReportToExcel(report, settings.clinicName)
    } catch (e) {
      setError(`Export failed: ${(e as Error).message}`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Reports</h1>
        <div className="flex gap-2">
          <button className="btn-ghost border border-slate-300" onClick={exportExcel} disabled={!loaded || exporting}>
            {exporting ? 'Exporting…' : 'Export to Excel'}
          </button>
          <Link className="btn-primary" to={printReportPath(type, range)}>
            Print
          </Link>
        </div>
      </div>

      <nav aria-label="Reports" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <ul ref={tabs} className="flex gap-1 whitespace-nowrap border-b border-slate-200">
          {REPORTS.map((r) => (
            <li key={r.type}>
              <button
                type="button"
                aria-current={r.type === type ? 'page' : undefined}
                onClick={() => go({ type: r.type as ReportType })}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                  r.type === type ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <fieldset className="flex flex-wrap items-end gap-3">
        <legend className="sr-only">Date range</legend>
        <div>
          <label className="label" htmlFor="range-preset">
            Range
          </label>
          <select id="range-preset" className="input w-auto" value={preset} onChange={(e) => choosePreset(e.target.value as RangePreset)}>
            {RANGE_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        {preset === 'custom' ? (
          <>
            <div>
              <label className="label" htmlFor="range-from">
                From
              </label>
              <input id="range-from" type="date" className="input w-auto" value={range.from} max={range.to} onChange={(e) => setCustom('from', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="range-to">
                To
              </label>
              <input id="range-to" type="date" className="input w-auto" value={range.to} min={range.from} onChange={(e) => setCustom('to', e.target.value)} />
            </div>
          </>
        ) : (
          <p className="pb-2 text-sm text-slate-600" data-testid="range-label">
            {rangeLabel(range)}
          </p>
        )}
      </fieldset>

      {error && <p className="text-sm text-red-700">{error}</p>}

      {!loaded ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="space-y-4" data-testid={`report-${type}`}>
          <Tiles tiles={report.tiles} />
          {report.note && <p className="text-xs text-slate-500">{report.note}</p>}
          {report.charts.length > 0 && (
            <Suspense fallback={<div className="card h-60 text-sm text-slate-500">Loading chart…</div>}>
              <div className="grid gap-4">
                {report.charts.map((c) => (
                  <ReportChart key={c.title} spec={c} />
                ))}
              </div>
            </Suspense>
          )}
          {report.tables.map((t) => (
            <ReportTableView key={t.title} table={t} />
          ))}
        </div>
      )}
    </div>
  )
}
