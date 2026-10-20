import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom'
import type { StockForm } from '../../db/types'
import { formatINR } from '../../lib/format'
import { useDebounced } from '../../lib/useDebounced'
import { StockDetail } from './StockDetail'
import { StockItemDialog } from './StockItemDialog'
import { FORM_LABEL, formatQty, STATUS_QTY, STATUS_ROW, STOCK_FORMS, stockStatus, type StockStatus } from './stockLogic'
import { stockList, type StockFilter } from './stockRepo'

const CHIPS: { value: StockFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'low', label: 'Low' },
  { value: 'negative', label: 'Out or negative' },
]

export function QtyBadge({ status }: { status: StockStatus }) {
  if (status === 'ok') return null
  return (
    <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${status === 'low' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}`}>
      {status === 'low' ? 'Low' : 'Out'}
    </span>
  )
}

function StockList() {
  const [params, setParams] = useSearchParams()
  const filter = (['low', 'negative'].includes(params.get('filter') ?? '') ? params.get('filter') : 'all') as StockFilter
  const form = (params.get('form') ?? '') as StockForm | ''
  const [query, setQuery] = useState('')
  const search = useDebounced(query, 150)
  const rows = useLiveQuery(async () => stockList({ search, filter, form }), [search, filter, form])
  const [adding, setAdding] = useState(false)
  const navigate = useNavigate()

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value && value !== 'all') next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Stock</h1>
        <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
          Add stock item
        </button>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Stock filter">
        {CHIPS.map((c) => (
          <button
            key={c.value}
            type="button"
            aria-pressed={filter === c.value}
            onClick={() => setParam('filter', c.value)}
            className={`rounded-full border px-3 py-1 text-sm ${
              filter === c.value ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 text-slate-700 hover:bg-slate-100'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_12rem]">
        <input type="search" className="input" aria-label="Search stock" placeholder="Remedy or potency" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="input" aria-label="Form" value={form} onChange={(e) => setParam('form', e.target.value)}>
          <option value="">All forms</option>
          {STOCK_FORMS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {rows && rows.length === 0 && (
        <div className="card text-sm text-slate-500">{filter === 'all' && !search && !form ? 'No stock items yet. Add the medicines you dispense.' : 'No stock items match.'}</div>
      )}

      {rows && rows.length > 0 && (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white md:block">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Remedy</th>
                  <th className="px-3 py-2 font-medium">Potency</th>
                  <th className="px-3 py-2 font-medium">Form</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 text-right font-medium">Low at</th>
                  <th className="px-3 py-2 text-right font-medium">Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const st = stockStatus(r)
                  return (
                    <tr
                      key={r.id}
                      data-testid="stock-row"
                      data-status={st}
                      className={`cursor-pointer hover:bg-slate-50 ${STATUS_ROW[st]}`}
                      onClick={() => navigate(`/stock/${r.id}`)}
                    >
                      <td className="px-3 py-2">
                        <Link to={`/stock/${r.id}`} className="font-medium text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
                          {r.remedyName}
                        </Link>
                      </td>
                      <td className="px-3 py-2 font-semibold">{r.potency}</td>
                      <td className="px-3 py-2">{FORM_LABEL[r.form]}</td>
                      <td className={`whitespace-nowrap px-3 py-2 text-right font-medium ${STATUS_QTY[st]}`}>
                        {formatQty(r.qty)} {r.unit}
                        <QtyBadge status={st} />
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600">{formatQty(r.lowStockAt)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">{r.price > 0 ? `${formatINR(r.price)}/${r.unit}` : <span className="text-slate-400">Not set</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <ul className="space-y-2 md:hidden">
            {rows.map((r) => {
              const st = stockStatus(r)
              return (
                <li key={r.id} data-testid="stock-card" data-status={st}>
                  <Link to={`/stock/${r.id}`} className={`card block ${STATUS_ROW[st]}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate font-medium text-brand-700">
                        {r.remedyName} <span className="font-semibold text-slate-900">{r.potency}</span>
                      </span>
                      <span className={`shrink-0 font-medium ${STATUS_QTY[st]}`}>
                        {formatQty(r.qty)} {r.unit}
                      </span>
                    </div>
                    <div className="mt-1 flex justify-between gap-2 text-xs text-slate-500">
                      <span>
                        {FORM_LABEL[r.form]} · low at {formatQty(r.lowStockAt)}
                        <QtyBadge status={st} />
                      </span>
                      <span>{r.price > 0 ? `${formatINR(r.price)}/${r.unit}` : 'No price'}</span>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        </>
      )}
      {adding && <StockItemDialog onClose={() => setAdding(false)} />}
    </div>
  )
}

export function StockPage() {
  return (
    <Routes>
      <Route index element={<StockList />} />
      <Route path=":stockId" element={<StockDetail />} />
    </Routes>
  )
}
