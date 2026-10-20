import type { PrescriptionItem } from '../../db/types'
import type { RxInput } from './visitRepo'

// Editable prescription grid row. `id` is set for rows already saved.
export interface RxRow {
  key: string
  id?: string
  remedyId: string
  potency: string
  dose: string
  repetition: string
  duration: string
  stockItemId: string
  qty: string // quantity dispensed from stockItemId
}

let counter = 0
const nextKey = () => `row-${++counter}`

export function blankRow(): RxRow {
  return { key: nextKey(), remedyId: '', potency: '', dose: '', repetition: '', duration: '', stockItemId: '', qty: '' }
}

export function isBlankRow(r: RxRow): boolean {
  return !r.remedyId && !r.potency.trim() && !r.dose.trim() && !r.repetition.trim() && !r.duration.trim() && !r.qty.trim()
}

// keepIds=false makes copies (for repeating a prescription onto a new visit).
export function rowsFromItems(items: PrescriptionItem[], keepIds: boolean): RxRow[] {
  return items.map((i) => ({
    key: nextKey(),
    id: keepIds ? i.id : undefined,
    remedyId: i.remedyId,
    potency: i.potency,
    dose: i.dose ?? '',
    repetition: i.repetition ?? '',
    duration: i.durationDays ? String(i.durationDays) : '',
    stockItemId: i.stockItemId ?? '',
    qty: i.qtyDispensed ? String(i.qtyDispensed) : '',
  }))
}

// Keeps whatever the doctor already entered and appends the previous Rx.
export function repeatRows(current: RxRow[], previous: PrescriptionItem[]): RxRow[] {
  const kept = current.filter((r) => !isBlankRow(r))
  const copies = rowsFromItems(previous, false)
  return kept.length + copies.length ? [...kept, ...copies] : [blankRow()]
}

export function rowsToInput(rows: RxRow[]): { items: RxInput[]; error?: string } {
  const items: RxInput[] = []
  for (const [n, r] of rows.entries()) {
    if (isBlankRow(r)) continue
    if (!r.remedyId) return { items, error: `Row ${n + 1}: choose a remedy from the list` }
    if (!r.potency.trim()) return { items, error: `Row ${n + 1}: enter a potency` }
    const days = r.duration.trim() ? Number(r.duration) : undefined
    if (days != null && (!Number.isInteger(days) || days <= 0)) return { items, error: `Row ${n + 1}: duration must be whole days` }
    const qty = r.qty.trim() ? Number(r.qty) : undefined
    if (qty != null && (!Number.isFinite(qty) || qty < 0)) return { items, error: `Row ${n + 1}: dispense quantity must be a number` }
    if (qty && !r.stockItemId) return { items, error: `Row ${n + 1}: choose the stock item to dispense from` }
    items.push({
      id: r.id,
      remedyId: r.remedyId,
      potency: r.potency,
      dose: r.dose,
      repetition: r.repetition,
      durationDays: days,
      stockItemId: r.stockItemId || undefined,
      qtyDispensed: qty || undefined,
    })
  }
  return { items }
}
