import { Link } from 'react-router-dom'
import { formatCell, formatTile, type ColType, type ReportTable, type Tile } from './reportDefs'

const NUMERIC: ColType[] = ['int', 'money', 'qty', 'percent']
const TONE = { warn: 'bg-amber-50', bad: 'bg-red-50' }

export function ReportTableView({ table, print = false }: { table: ReportTable; print?: boolean }) {
  const align = (t: ColType) => (NUMERIC.includes(t) ? 'text-right tabular-nums' : 'text-left')
  const cellPad = print ? 'px-1.5 py-1' : 'px-3 py-2'
  return (
    <section className={print ? 'mt-4' : 'card overflow-hidden p-0'}>
      <h2 className={print ? 'mb-1 text-[10.5pt] font-semibold' : 'border-b border-slate-200 px-4 py-3 text-sm font-semibold'}>
        {table.title} <span className="font-normal text-slate-500">({table.rows.length})</span>
      </h2>
      <div className={print ? '' : 'overflow-x-auto'}>
        <table className={`report-table w-full border-collapse ${print ? 'text-[8.5pt]' : 'text-sm'}`}>
          <thead>
            <tr className={print ? 'border-y-2 border-slate-800' : 'bg-slate-50 text-xs uppercase tracking-wide text-slate-500'}>
              {table.columns.map((c) => (
                <th key={c.key} scope="col" className={`${cellPad} whitespace-nowrap font-semibold ${align(c.type)}`}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.length === 0 && (
              <tr>
                <td colSpan={table.columns.length} className={`${cellPad} text-slate-500`}>
                  No records in this range. Try a wider date range.
                </td>
              </tr>
            )}
            {table.rows.map((r, i) => {
              const link = !print ? table.links?.[i] : undefined
              const tone = table.tones?.[i]
              return (
                <tr key={i} className={`border-b border-slate-100 ${tone ? TONE[tone] : ''}`}>
                  {table.columns.map((c, ci) => {
                    const text = formatCell(r[c.key] ?? null, c.type)
                    const wrap = c.key === 'complaint' || c.key === 'remedies' ? (print ? '' : 'min-w-[12rem]') : 'whitespace-nowrap'
                    return (
                      <td key={c.key} className={`${cellPad} ${align(c.type)} ${wrap}`}>
                        {link && ci === firstTextCol(table) ? (
                          <Link to={link} className="font-medium text-brand-700 hover:underline">
                            {text}
                          </Link>
                        ) : (
                          text
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
          {table.totals && table.rows.length > 0 && (
            <tfoot>
              <tr className={print ? 'border-t-2 border-slate-800 font-semibold' : 'border-t-2 border-slate-200 bg-slate-50 font-semibold'}>
                {table.columns.map((c) => (
                  <td key={c.key} className={`${cellPad} whitespace-nowrap ${align(c.type)}`}>
                    {formatCell(table.totals![c.key] ?? null, c.type)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  )
}

// The name column (or first text column) carries the row link.
function firstTextCol(t: ReportTable): number {
  const name = t.columns.findIndex((c) => c.key === 'name' || c.key === 'remedyName')
  return name >= 0 ? name : t.columns.findIndex((c) => c.type === 'text')
}

export function Tiles({ tiles, print = false }: { tiles: Tile[]; print?: boolean }) {
  if (print) {
    return (
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[9.5pt]">
        {tiles.map((t) => (
          <div key={t.label}>
            <dt className="inline text-slate-600">{t.label}: </dt>
            <dd className="inline font-semibold">{formatTile(t)}</dd>
          </div>
        ))}
      </dl>
    )
  }
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((t) => (
        <div key={t.label} className="card">
          <dt className="text-sm text-slate-500">{t.label}</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums" data-testid={`tile-${t.label}`}>
            {formatTile(t)}
          </dd>
          {t.hint && <dd className="text-xs text-slate-500">{t.hint}</dd>}
        </div>
      ))}
    </dl>
  )
}
