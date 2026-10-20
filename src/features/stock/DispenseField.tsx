import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef } from 'react'
import { db } from '../../db/db'
import { dispenseWarning, FORM_LABEL, formatQty, samePotency, stockStatus } from './stockLogic'
import { findStock } from './stockRepo'

interface Props {
  index: number // 1-based row number for labels
  remedyId: string
  potency: string
  stockItemId: string
  qty: string
  otherRowsQty: number // asked for from the same item by other rows of this visit
  saved: Map<string, number> // already deducted per stock item by this visit's last save
  onChange: (changes: { stockItemId?: string; qty?: string }) => void
}

// The "Dispense" part of a prescription row: which stock item and how much.
export function DispenseField({ index, remedyId, potency, stockItemId, qty, otherRowsQty, saved, onChange }: Props) {
  const matches = useLiveQuery(async () => findStock(remedyId, potency), [remedyId, potency])
  const selected = useLiveQuery(async () => (stockItemId ? ((await db.stockItems.get(stockItemId)) ?? null) : null), [stockItemId])
  const autoPicked = useRef('')
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    // A selection that no longer matches the row (remedy/potency edited) is dropped.
    if (selected && (selected.remedyId !== remedyId || !samePotency(selected.potency, potency))) {
      onChangeRef.current({ stockItemId: '' })
      return
    }
    const key = `${remedyId}|${potency.trim().toLowerCase()}`
    if (!stockItemId && matches?.length === 1 && autoPicked.current !== key) {
      autoPicked.current = key
      onChangeRef.current({ stockItemId: matches[0].id })
    }
  }, [matches, selected, stockItemId, remedyId, potency])

  if (!matches) return null
  const options = selected && !matches.some((m) => m.id === selected.id) ? [...matches, selected] : matches
  if (options.length === 0) {
    return <p className="text-xs text-slate-400">Not in stock · prescription only</p>
  }

  const item = selected && options.some((o) => o.id === selected.id) ? selected : null
  const want = (Number(qty) || 0) + otherRowsQty
  const available = item ? item.qty + (saved.get(item.id) ?? 0) : 0
  const warning = item ? dispenseWarning(item, available, want) : null
  const status = item ? stockStatus({ qty: available, lowStockAt: item.lowStockAt }) : 'ok'

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="dispense">
      <span className="text-xs font-medium uppercase text-slate-500">Dispense</span>
      <select
        className="input w-auto min-w-0 max-w-[14rem] py-1"
        aria-label={`Stock item ${index}`}
        value={item?.id ?? ''}
        onChange={(e) => onChange({ stockItemId: e.target.value, ...(e.target.value ? {} : { qty: '' }) })}
      >
        <option value="">No dispensing</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {FORM_LABEL[o.form]} · {formatQty(o.qty + (saved.get(o.id) ?? 0))} {o.unit}
            {o.deleted ? ' (deleted)' : ''}
          </option>
        ))}
      </select>
      {item && (
        <>
          <span className="flex items-center gap-1">
            <input
              className="input w-20 py-1 text-right"
              aria-label={`Quantity ${index}`}
              inputMode="decimal"
              placeholder="Qty"
              value={qty}
              onChange={(e) => onChange({ qty: e.target.value })}
            />
            <span className="text-slate-600">{item.unit}</span>
          </span>
          <span
            className={`text-xs ${status === 'out' ? 'text-red-700' : status === 'low' ? 'text-amber-700' : 'text-slate-500'}`}
            data-testid="available"
          >
            {formatQty(available)} {item.unit} available
          </span>
        </>
      )}
      {warning && (
        <span
          role="status"
          className={`basis-full text-xs font-medium ${warning.level === 'negative' ? 'text-red-700' : 'text-amber-700'}`}
          data-testid="dispense-warning"
        >
          {warning.message}
        </span>
      )}
    </div>
  )
}
