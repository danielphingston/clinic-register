import type { StockForm, StockItem } from '../../db/types'

export const STOCK_FORMS: { value: StockForm; label: string }[] = [
  { value: 'dilution', label: 'Dilution' },
  { value: 'globules', label: 'Globules' },
  { value: 'tablet', label: 'Tablets' },
  { value: 'mother-tincture', label: 'Mother tincture' },
  { value: 'other', label: 'Other' },
]

export const FORM_LABEL: Record<StockForm, string> = Object.fromEntries(STOCK_FORMS.map((f) => [f.value, f.label])) as Record<
  StockForm,
  string
>

export const UNIT_PRESETS = ['ml', 'g', 'dram', 'tablets', 'bottle']

export const DEFAULT_UNIT: Record<StockForm, string> = {
  dilution: 'ml',
  globules: 'g',
  tablet: 'tablets',
  'mother-tincture': 'ml',
  other: 'bottle',
}

// Quantities can be decimal (ml, g); three places avoids float drift without
// losing anything a dispensary measures.
export const roundQty = (n: number) => Math.round(n * 1000) / 1000

export function formatQty(n: number): string {
  return String(roundQty(n))
}

export type StockStatus = 'ok' | 'low' | 'out'

export function stockStatus(item: Pick<StockItem, 'qty' | 'lowStockAt'>): StockStatus {
  if (item.qty <= 0) return 'out'
  if (item.qty <= item.lowStockAt) return 'low'
  return 'ok'
}

export const STATUS_ROW: Record<StockStatus, string> = { ok: '', low: 'bg-amber-50', out: 'bg-red-50' }
export const STATUS_QTY: Record<StockStatus, string> = { ok: '', low: 'text-amber-800', out: 'text-red-700' }

export const samePotency = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export interface DispenseWarning {
  level: 'negative' | 'low'
  message: string
}

// `available` is what the shelf holds before this dispense (already-saved
// dispenses for the same visit added back); `want` is the total asked for.
export function dispenseWarning(
  item: Pick<StockItem, 'lowStockAt' | 'unit'>,
  available: number,
  want: number,
): DispenseWarning | null {
  if (!(want > 0)) return null
  const left = roundQty(available - want)
  if (left < 0) return { level: 'negative', message: `Only ${formatQty(Math.max(available, 0))} ${item.unit} left; stock will go to ${formatQty(left)}` }
  if (left <= item.lowStockAt) return { level: 'low', message: `Low stock: ${formatQty(left)} ${item.unit} will be left` }
  return null
}

// "Arsenicum album 30C × 10 ml"
export function medicineLineDesc(remedyName: string, potency: string, qty: number, unit: string): string {
  return `${remedyName} ${potency} × ${formatQty(qty)} ${unit}`
}

export function stockItemLabel(remedyName: string, item: Pick<StockItem, 'potency' | 'form'>): string {
  return `${remedyName} ${item.potency} ${FORM_LABEL[item.form].toLowerCase()}`
}
