import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { bucketLabel, monthRange } from '../../lib/dateRange'
import { formatDate, formatINR, parseISODate, todayISO } from '../../lib/format'
import { dailyTrend, type DailyTrend } from '../reports/reportQueries'

// Lightweight inline-SVG bars, so the dashboard doesn't pull in Recharts.
// Two small charts share one hover/focus position instead of a dual axis.

const W = 600
const H = 90
const GAP = 2
const MONTH_CHOICES = 24

// "YYYY-MM" keys, newest first, starting with the month of `today`.
function recentMonths(today: string): string[] {
  const t = parseISODate(today)
  return Array.from({ length: MONTH_CHOICES }, (_, i) => {
    const d = new Date(t.getFullYear(), t.getMonth() - i, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
}

// 2026-10 -> "October 2026"
function monthLabel(ym: string): string {
  return parseISODate(`${ym}-01`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

function Bars({
  data,
  value,
  color,
  active,
  onActive,
  label,
}: {
  data: DailyTrend[]
  value: (d: DailyTrend) => number
  color: string
  active: number | null
  onActive: (i: number | null) => void
  label: string
}) {
  const max = Math.max(1, ...data.map(value))
  const bw = W / data.length
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-24 w-full touch-none"
      role="img"
      aria-label={label}
      onPointerLeave={() => onActive(null)}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        const i = Math.floor(((e.clientX - r.left) / r.width) * data.length)
        onActive(Math.min(data.length - 1, Math.max(0, i)))
      }}
    >
      <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} stroke="#cbd5e1" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      {data.map((d, i) => {
        const v = value(d)
        const h = v > 0 ? Math.max(2, (v / max) * (H - 4)) : 0
        return (
          <rect
            key={d.date}
            x={i * bw + GAP / 2}
            y={H - h}
            width={Math.max(1, bw - GAP)}
            height={h}
            rx="2"
            fill={color}
            opacity={active == null || active === i ? 1 : 0.45}
          />
        )
      })}
    </svg>
  )
}

// `last30` is the dashboard's last-30-days series; a chosen month is fetched here.
export function TrendChart({ data: last30 }: { data: DailyTrend[] }) {
  const [active, setActive] = useState<number | null>(null)
  const [month, setMonth] = useState<string | null>(null) // "YYYY-MM", null = last 30 days
  const months = recentMonths(todayISO())
  const monthData = useLiveQuery(async () => (month ? dailyTrend(monthRange(month)) : undefined), [month])
  const data = month ? monthData : last30
  const title = month ? monthLabel(month) : 'Last 30 days'
  const idx = month ? months.indexOf(month) : -1

  const choose = (m: string | null) => {
    setMonth(m)
    setActive(null)
  }
  const prev = month ? months[idx + 1] : months[1] // from last 30 days: last month
  const next = month ? months[idx - 1] : undefined

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 id="trend-heading" className="font-semibold">
        {title}
      </h2>
      <div className="flex items-center gap-1">
        <button type="button" className="btn-ghost border border-slate-300 px-2 py-1" aria-label="Previous month" disabled={!prev} onClick={() => prev && choose(prev)}>
          ‹
        </button>
        <select className="input w-auto py-1 text-sm" aria-label="Period" value={month ?? ''} onChange={(e) => choose(e.target.value || null)}>
          <option value="">Last 30 days</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
        <button type="button" className="btn-ghost border border-slate-300 px-2 py-1" aria-label="Next month" disabled={!next} onClick={() => next && choose(next)}>
          ›
        </button>
      </div>
    </div>
  )

  if (!data) {
    return (
      <section className="card" aria-labelledby="trend-heading" data-testid="trend-chart">
        {header}
      </section>
    )
  }
  if (!data.length) return null
  const totalVisits = data.reduce((s, d) => s + d.visits, 0)
  const totalCollected = Math.round(data.reduce((s, d) => s + d.collected, 0) * 100) / 100
  const cur = active == null ? null : data[active]
  const maxVisits = Math.max(...data.map((d) => d.visits))
  const maxCollected = Math.max(...data.map((d) => d.collected))

  return (
    <section className="card" aria-labelledby="trend-heading" data-testid="trend-chart">
      {header}
      <div className="mt-1 flex flex-wrap items-baseline justify-end gap-2">
        <p className="text-sm text-slate-600" aria-live="polite">
          {cur ? (
            <>
              <span className="font-medium">{formatDate(cur.date)}</span>: {cur.visits} visit{cur.visits === 1 ? '' : 's'} · {formatINR(cur.collected)}
            </>
          ) : (
            <>
              {totalVisits} visit{totalVisits === 1 ? '' : 's'} · {formatINR(totalCollected)} collected
            </>
          )}
        </p>
      </div>

      <div className="mt-3">
        <div className="flex items-baseline justify-between text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#17805e]" aria-hidden="true" /> Visits per day
          </span>
          <span>max {maxVisits}</span>
        </div>
        <Bars data={data} value={(d) => d.visits} color="#17805e" active={active} onActive={setActive} label={`Visits per day, ${totalVisits} in total`} />
      </div>

      <div className="mt-3">
        <div className="flex items-baseline justify-between text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#6366f1]" aria-hidden="true" /> Collection per day
          </span>
          <span>max {formatINR(maxCollected)}</span>
        </div>
        <Bars data={data} value={(d) => d.collected} color="#6366f1" active={active} onActive={setActive} label={`Collection per day, ${formatINR(totalCollected)} in total`} />
      </div>

      <div className="mt-1 flex justify-between text-xs text-slate-500">
        <span>{bucketLabel(data[0].date)}</span>
        <span>{bucketLabel(data[data.length - 1].date)}</span>
      </div>

      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-xs text-brand-700">Show as table</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1">Date</th>
                <th className="py-1 text-right">Visits</th>
                <th className="py-1 text-right">Collected</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.date} className="border-t border-slate-100">
                  <td className="py-1">{formatDate(d.date)}</td>
                  <td className="py-1 text-right">{d.visits}</td>
                  <td className="py-1 text-right">{formatINR(d.collected)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}
