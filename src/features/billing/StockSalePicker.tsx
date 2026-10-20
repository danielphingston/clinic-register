import { useLiveQuery } from 'dexie-react-hooks'
import { useId, useState } from 'react'
import { useDebounced } from '../../lib/useDebounced'
import { formatINR, parseAmount } from '../../lib/format'
import { formatQty, medicineLineDesc, roundQty } from '../stock/stockLogic'
import { stockList, type StockRow } from '../stock/stockRepo'

export interface SaleLine {
  desc: string
  amount: number
  stockItemId: string
  qty: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

// "Add medicine" on a bill: search stock, pick an item, enter the quantity.
// The line it adds is a counter sale, so saving the bill takes it out of stock.
export function StockSalePicker({ onAdd, onCancel }: { onAdd: (line: SaleLine) => void; onCancel: () => void }) {
  const id = useId()
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<StockRow | null>(null)
  const [qty, setQty] = useState('')
  const [error, setError] = useState('')
  const q = useDebounced(search, 150)
  const results = useLiveQuery(async () => (q.trim() ? stockList({ search: q }) : Promise.resolve([] as StockRow[])), [q])

  const n = parseAmount(qty)
  const amount = picked && Number.isFinite(n) && n > 0 ? round2(n * picked.price) : 0

  function add() {
    if (!picked) return
    if (!Number.isFinite(n) || n <= 0) return setError('Enter a quantity above zero')
    const qtyN = roundQty(n)
    onAdd({ desc: medicineLineDesc(picked.remedyName, picked.potency, qtyN, picked.unit), amount, stockItemId: picked.id, qty: qtyN })
  }

  return (
    <div className="space-y-2 rounded-md border border-brand-500/40 bg-brand-50/40 p-3" data-testid="sale-picker">
      {!picked ? (
        <>
          <label className="label" htmlFor={`${id}-q`}>
            Find medicine in stock
          </label>
          <input
            id={`${id}-q`}
            type="search"
            className="input"
            placeholder="Remedy name or potency, e.g. ars 30"
            value={search}
            autoFocus
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (results?.length === 1) setPicked(results[0])
              }
            }}
          />
          {q.trim() && results && (
            <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200 bg-white" aria-label="Matching stock">
              {results.length === 0 && <li className="p-2 text-sm text-slate-500">No stock item matches. Add it on the Stock page first.</li>}
              {results.slice(0, 8).map((r) => (
                <li key={r.id}>
                  <button type="button" className="flex w-full items-center justify-between gap-2 p-2 text-left text-sm hover:bg-slate-50 focus:bg-slate-50" onClick={() => setPicked(r)}>
                    <span>
                      <span className="font-medium">{r.remedyName}</span> {r.potency} <span className="text-slate-500">· {r.form}</span>
                    </span>
                    <span className="whitespace-nowrap text-xs text-slate-600">
                      {formatQty(r.qty)} {r.unit} · {r.price > 0 ? `${formatINR(r.price)}/${r.unit}` : 'no price'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="btn-ghost px-3 py-1" onClick={onCancel}>
            Cancel
          </button>
        </>
      ) : (
        <>
          <p className="text-sm">
            <span className="font-medium">{picked.remedyName}</span> {picked.potency} · {formatQty(picked.qty)} {picked.unit} in stock
            {picked.price > 0 ? ` · ${formatINR(picked.price)}/${picked.unit}` : ' · no price set'}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-32">
              <label className="label" htmlFor={`${id}-qty`}>
                Quantity ({picked.unit})
              </label>
              <input
                id={`${id}-qty`}
                className="input text-right"
                inputMode="decimal"
                value={qty}
                autoFocus
                onChange={(e) => {
                  setQty(e.target.value)
                  setError('')
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    add()
                  }
                }}
              />
            </div>
            <div className="pb-2 text-sm text-slate-600" data-testid="sale-amount">
              = {formatINR(amount)}
            </div>
            <button type="button" className="btn-primary px-3" onClick={add}>
              Add to bill
            </button>
            <button type="button" className="btn-ghost px-3" onClick={() => setPicked(null)}>
              Back
            </button>
          </div>
          {picked.qty - (Number.isFinite(n) ? n : 0) < 0 && (
            <p className="text-xs text-amber-700">This takes stock below zero. Record a purchase when it arrives.</p>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  )
}
