import { rangeLabel } from '../../lib/dateRange'
import { isCurrentPeriod, periodLabel, periodOf, PERIOD_KINDS, shiftPeriod, trendWindows, type Period, type PeriodKind } from '../../lib/period'

// Week / Month / Quarter / Year, the calendar or financial year, and ‹ › to
// step through periods. Periods after today's are not offered.
export function PeriodBar({ period, today, onChange }: { period: Period; today: string; onChange: (p: Period) => void }) {
  const prev = shiftPeriod(period, -1)
  const next = shiftPeriod(period, 1)
  const current = isCurrentPeriod(period, today)
  const { current: win, partial } = trendWindows(period, today)
  const { range, label } = win
  const fyApplies = period.kind === 'quarter' || period.kind === 'year'

  // Switching kind keeps the date in view: from November 2026, Quarter gives Q4 2026.
  const chooseKind = (kind: PeriodKind) => {
    const at = current ? today : period.start
    onChange(periodOf(kind, at, period.fy))
  }

  return (
    <fieldset className="flex flex-wrap items-end gap-3" data-testid="period-bar">
      <legend className="sr-only">Period</legend>
      <div role="group" aria-label="Period length" className="inline-flex overflow-hidden rounded-lg border border-slate-300">
        {PERIOD_KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            aria-pressed={k.value === period.kind}
            onClick={() => chooseKind(k.value)}
            className={`px-3 py-1.5 text-sm font-medium ${k.value === period.kind ? 'bg-brand-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'} border-l border-slate-300 first:border-l-0`}
          >
            {k.label}
          </button>
        ))}
      </div>

      {fyApplies && (
        <div>
          <label className="label" htmlFor="period-year">
            Year
          </label>
          <select
            id="period-year"
            className="input w-auto py-1.5"
            value={period.fy ? 'fy' : 'calendar'}
            onChange={(e) => onChange(periodOf(period.kind, current ? today : period.start, e.target.value === 'fy'))}
          >
            <option value="calendar">Calendar (Jan–Dec)</option>
            <option value="fy">Financial (Apr–Mar)</option>
          </select>
        </div>
      )}

      <div className="flex items-center gap-1">
        <button type="button" className="btn-ghost border border-slate-300 px-2 py-1" aria-label={`Previous: ${periodLabel(prev)}`} onClick={() => onChange(prev)}>
          ‹
        </button>
        <div className="min-w-[10rem] px-2 text-center">
          <div className="text-sm font-semibold" data-testid="period-label">
            {label}
          </div>
          <div className="text-xs text-slate-500">
            {rangeLabel(range)}
            {partial && ' (to date)'}
          </div>
        </div>
        <button
          type="button"
          className="btn-ghost border border-slate-300 px-2 py-1"
          aria-label={`Next: ${periodLabel(next)}`}
          disabled={next.start > today}
          onClick={() => onChange(next)}
        >
          ›
        </button>
        {!current && (
          <button type="button" className="btn-ghost ml-1 text-sm text-brand-700" onClick={() => onChange(periodOf(period.kind, today, period.fy))}>
            Current
          </button>
        )}
      </div>
    </fieldset>
  )
}
