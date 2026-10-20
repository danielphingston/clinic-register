import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatINR } from '../../lib/format'
import type { ChartSpec } from './reportDefs'

// Only the lazy reports chunk imports this file (and so Recharts).

const AXIS = { fontSize: 11, fill: '#64748b' }
const GRID = '#e2e8f0'

function compactINR(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e7) return `₹${+(v / 1e7).toFixed(1)}Cr`
  if (a >= 1e5) return `₹${+(v / 1e5).toFixed(1)}L`
  if (a >= 1e3) return `₹${+(v / 1e3).toFixed(1)}k`
  return `₹${v}`
}

export default function ReportChart({ spec }: { spec: ChartSpec }) {
  const fmt = (v: unknown) => (spec.money ? formatINR(Number(v)) : String(v))
  const tick = spec.money ? compactINR : undefined
  const legend = spec.series.length > 1
  const tooltip = <Tooltip formatter={(v, name) => [fmt(v), name]} cursor={{ fill: 'rgba(148,163,184,0.15)' }} />

  if (spec.kind === 'hbar') {
    const height = Math.max(160, spec.data.length * 30 + 40)
    return (
      <figure className="card" aria-label={spec.title}>
        <figcaption className="text-sm font-semibold">{spec.title}</figcaption>
        <div style={{ height }} className="mt-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={spec.data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }} barCategoryGap={6}>
              <CartesianGrid horizontal={false} stroke={GRID} />
              <XAxis type="number" tick={AXIS} allowDecimals={false} tickFormatter={tick} />
              <YAxis type="category" dataKey={spec.xKey} tick={AXIS} width={130} interval={0} />
              {tooltip}
              {spec.series.map((s) => (
                <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} isAnimationActive={false} radius={[0, 4, 4, 0]} maxBarSize={22} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </figure>
    )
  }

  const common = {
    data: spec.data,
    margin: { top: 8, right: 8, bottom: 4, left: 0 },
  }
  const xAxis = <XAxis dataKey={spec.xKey} tick={AXIS} interval="preserveStartEnd" minTickGap={16} tickLine={false} />
  const yAxis = <YAxis tick={AXIS} width={spec.money ? 52 : 32} allowDecimals={false} tickFormatter={tick} axisLine={false} tickLine={false} />

  return (
    <figure className="card" aria-label={spec.title}>
      <figcaption className="text-sm font-semibold">{spec.title}</figcaption>
      <div className="mt-2 h-60 md:h-72">
        <ResponsiveContainer width="100%" height="100%">
          {spec.kind === 'line' ? (
            <LineChart {...common}>
              <CartesianGrid vertical={false} stroke={GRID} />
              {xAxis}
              {yAxis}
              {tooltip}
              {legend && <Legend wrapperStyle={{ fontSize: 12 }} />}
              {spec.series.map((s) => (
                <Line key={s.key} type="linear" isAnimationActive={false} dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={spec.data.length <= 31 ? { r: 2 } : false} activeDot={{ r: 4 }} />
              ))}
            </LineChart>
          ) : (
            <BarChart {...common} barGap={2}>
              <CartesianGrid vertical={false} stroke={GRID} />
              {xAxis}
              {yAxis}
              {tooltip}
              {legend && <Legend wrapperStyle={{ fontSize: 12 }} />}
              {spec.series.map((s, i) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  fill={s.color}
                  stackId={spec.stacked ? 'a' : undefined}
                  isAnimationActive={false}
                  radius={!spec.stacked || i === spec.series.length - 1 ? [4, 4, 0, 0] : 0}
                  maxBarSize={36}
                />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </figure>
  )
}
