import { useState, type FormEvent } from 'react'
import { Modal } from '../../app/Modal'
import type { StockForm, StockItem } from '../../db/types'
import { parseAmount } from '../../lib/format'
import { RemedyAutocomplete } from '../remedies/RemedyAutocomplete'
import { POTENCY_PRESETS } from '../visits/rxFormat'
import { DEFAULT_UNIT, STOCK_FORMS, UNIT_PRESETS } from './stockLogic'
import { createStockItem, editStockItem } from './stockRepo'

const num = (s: string) => (s.trim() === '' ? 0 : Number(s.replace(/,/g, '')))

// Add (no `item`) or edit a stock item. Quantity is never edited here; it
// changes only through purchase/adjust/dispense moves.
export function StockItemDialog({ item, onClose, onSaved }: { item?: StockItem; onClose: () => void; onSaved?: (id: string) => void }) {
  const [remedyId, setRemedyId] = useState(item?.remedyId ?? '')
  const [potency, setPotency] = useState(item?.potency ?? '')
  const [form, setForm] = useState<StockForm>(item?.form ?? 'dilution')
  const [unit, setUnit] = useState(item?.unit ?? DEFAULT_UNIT.dilution)
  const [unitTouched, setUnitTouched] = useState(!!item)
  const [opening, setOpening] = useState('')
  const [lowAt, setLowAt] = useState(item ? String(item.lowStockAt) : '')
  const [price, setPrice] = useState(item?.price ? String(item.price) : '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const fields = { remedyId, potency, form, unit, lowStockAt: num(lowAt), price: parseAmount(price) }
    if ([fields.lowStockAt, fields.price, num(opening)].some((n) => Number.isNaN(n))) return setError('Enter quantities and price as numbers')
    setSaving(true)
    try {
      if (item) {
        await editStockItem(item.id, fields)
        onSaved?.(item.id)
      } else {
        const created = await createStockItem({ ...fields, openingQty: num(opening) })
        onSaved?.(created.id)
      }
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal title={item ? 'Edit stock item' : 'Add stock item'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <div>
          <label className="label" htmlFor="si-remedy">
            Remedy
          </label>
          <RemedyAutocomplete id="si-remedy" value={remedyId} onChange={setRemedyId} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="si-potency">
              Potency
            </label>
            <input id="si-potency" className="input" list="si-potency-presets" value={potency} onChange={(e) => setPotency(e.target.value)} />
            <datalist id="si-potency-presets">
              {POTENCY_PRESETS.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="label" htmlFor="si-form">
              Form
            </label>
            <select
              id="si-form"
              className="input"
              value={form}
              onChange={(e) => {
                const f = e.target.value as StockForm
                setForm(f)
                if (!unitTouched) setUnit(DEFAULT_UNIT[f])
              }}
            >
              {STOCK_FORMS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="si-unit">
              Unit
            </label>
            <input
              id="si-unit"
              className="input"
              list="si-unit-presets"
              value={unit}
              onChange={(e) => {
                setUnit(e.target.value)
                setUnitTouched(true)
              }}
            />
            <datalist id="si-unit-presets">
              {UNIT_PRESETS.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </div>
          {!item && (
            <div>
              <label className="label" htmlFor="si-opening">
                Opening qty
              </label>
              <input id="si-opening" className="input text-right" inputMode="decimal" placeholder="0" value={opening} onChange={(e) => setOpening(e.target.value)} />
            </div>
          )}
          <div>
            <label className="label" htmlFor="si-low">
              Low-stock level
            </label>
            <input id="si-low" className="input text-right" inputMode="decimal" placeholder="0" value={lowAt} onChange={(e) => setLowAt(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="si-price">
              Price per {unit.trim() || 'unit'} (₹)
            </label>
            <input id="si-price" className="input text-right" inputMode="decimal" placeholder="Not set" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button type="submit" className="btn-primary" disabled={saving}>
            {item ? 'Save changes' : 'Add item'}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  )
}
