import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type ChangeEvent, type FormEvent } from 'react'
import { Modal } from '../../app/Modal'
import type { Expense, ExpenseCategory, ExpenseMode, RecurringExpense } from '../../db/types'
import { categorize, UNSUPPORTED_MESSAGE } from '../../lib/compress'
import { formatDate, parseAmount, todayISO } from '../../lib/format'
import { AttachmentGrid } from '../attachments/AttachmentGrid'
import { addExpenseReceipt } from '../attachments/attachmentRepo'
import { categoryName, EXPENSE_MODES, monthName, OTHER_CATEGORY, type DueItem } from './expenseLogic'
import { addExpense, deleteExpense, editExpense, expenseCategories, markRecurringPaid, receiptsFor } from './expenseRepo'

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,application/pdf,.pdf'

// One tap per category: chips rather than a dropdown.
export function CategoryPicker({ categories, value, onChange }: { categories: ExpenseCategory[]; value: string; onChange: (id: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Category" className="flex flex-wrap gap-1.5">
      {categories.map((c) => (
        <button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={c.id === value}
          onClick={() => onChange(c.id)}
          className={`rounded-full px-3 py-1.5 text-sm font-medium ${c.id === value ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
        >
          {c.name}
        </button>
      ))}
    </div>
  )
}

export function ModeField({ id, value, onChange }: { id: string; value: ExpenseMode; onChange: (m: ExpenseMode) => void }) {
  return (
    <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value as ExpenseMode)}>
      {EXPENSE_MODES.map((m) => (
        <option key={m.value} value={m.value}>
          {m.label}
        </option>
      ))}
    </select>
  )
}

interface Props {
  expense?: Expense // edit
  due?: DueItem<RecurringExpense> // record a recurring expense's month
  onClose: () => void
}

// Add, edit or "mark paid". Receipt photos picked before the first save are
// attached once the expense exists.
export function ExpenseDialog({ expense, due, onClose }: Props) {
  const categories = useLiveQuery(expenseCategories)
  const receipts = useLiveQuery(async () => (expense ? receiptsFor(expense.id) : []), [expense?.id])
  const rule = due?.rule
  const [category, setCategory] = useState(expense?.category ?? rule?.category ?? '')
  const [amount, setAmount] = useState(expense ? String(expense.amount) : rule ? String(rule.amount) : '')
  const [date, setDate] = useState(expense?.date ?? todayISO())
  const [mode, setMode] = useState<ExpenseMode>(expense?.mode ?? rule?.mode ?? 'cash')
  const [note, setNote] = useState(expense?.note ?? rule?.note ?? '')
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const offered = categories?.filter((c) => !c.archived || c.id === category) ?? []
  const title = expense ? 'Edit expense' : due ? `${categories ? categoryName(categories, due.rule.category) : 'Expense'} for ${monthName(due.month)}` : 'Add expense'

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const picked = [...(e.target.files ?? [])]
    e.target.value = ''
    const bad = picked.find((f) => categorize(f) === null)
    if (bad) setError(`${bad.name}: ${UNSUPPORTED_MESSAGE}`)
    setFiles((list) => [...list, ...picked.filter((f) => categorize(f) !== null)])
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!category) return setError('Choose a category')
    const amt = parseAmount(amount)
    if (!(amt > 0)) return setError('Enter an amount above zero')
    if (category === OTHER_CATEGORY && !note.trim()) return setError('Add a note saying what this was for')
    setSaving(true)
    setError('')
    try {
      const input = { category, amount: amt, date, mode, note }
      let id = expense?.id
      if (expense) await editExpense(expense.id, input)
      else if (due) id = (await markRecurringPaid(due.rule.id, due.month, { amount: amt, date, mode, note })).id
      else id = (await addExpense(input)).id
      // One at a time: decoding several large photos at once can exhaust memory on phones.
      for (const f of files) await addExpenseReceipt(id!, f)
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  async function remove() {
    if (!expense) return
    await deleteExpense(expense.id)
    onClose()
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {due && (
          <p className="text-sm text-slate-600">
            Due {formatDate(due.dueDate)}. Change the amount or date if this month's payment was different.
          </p>
        )}
        {!due && (
          <div>
            <span className="label">Category</span>
            {categories ? <CategoryPicker categories={offered} value={category} onChange={(c) => (setCategory(c), setError(''))} /> : <p className="text-sm text-slate-500">Loading…</p>}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="expense-amount">
              Amount
            </label>
            <input
              id="expense-amount"
              className="input text-right"
              inputMode="decimal"
              value={amount}
              data-autofocus={due ? true : undefined}
              onChange={(e) => {
                setAmount(e.target.value)
                setError('')
              }}
            />
          </div>
          <div>
            <label className="label" htmlFor="expense-date">
              Date paid
            </label>
            <input id="expense-date" type="date" className="input" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="expense-mode">
            Paid via
          </label>
          <ModeField id="expense-mode" value={mode} onChange={setMode} />
        </div>
        <div>
          <label className="label" htmlFor="expense-note">
            {category === OTHER_CATEGORY ? 'What was it for?' : 'Note or vendor (optional)'}
          </label>
          <input
            id="expense-note"
            className="input"
            value={note}
            placeholder={category === OTHER_CATEGORY ? 'e.g. Plumber, website renewal' : 'e.g. KSEB bill Oct, Bhargava Phytolab'}
            onChange={(e) => {
              setNote(e.target.value)
              setError('')
            }}
          />
        </div>

        <div className="space-y-2">
          <span className="label">Receipt</span>
          {expense && receipts && receipts.length > 0 && <AttachmentGrid items={receipts} className="grid-cols-3" />}
          {files.length > 0 && (
            <ul className="space-y-1 text-sm" aria-label="Receipts to attach">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-2 py-1">
                  <span className="min-w-0 truncate">{f.name}</span>
                  <button type="button" className="btn-ghost px-2 py-0.5 text-slate-500" aria-label={`Remove ${f.name}`} onClick={() => setFiles((l) => l.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <label className="btn-ghost cursor-pointer border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-brand-500">
              Attach receipt
              <input type="file" multiple accept={ACCEPT} className="sr-only" aria-label="Attach receipt" onChange={onPick} />
            </label>
            <label className="btn-ghost cursor-pointer border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-brand-500 md:hidden">
              Take photo
              <input type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Take photo of receipt" onChange={onPick} />
            </label>
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="btn-primary" disabled={saving || !categories}>
            {saving ? 'Saving…' : due ? 'Mark paid' : 'Save'}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          {expense &&
            (confirmDelete ? (
              <span className="ml-auto flex items-center gap-2 text-sm" role="group" aria-label="Confirm delete">
                Delete this expense?
                <button type="button" className="btn-ghost border border-red-300 px-2 py-1 text-red-700" onClick={remove}>
                  Delete
                </button>
                <button type="button" className="btn-ghost px-2 py-1" onClick={() => setConfirmDelete(false)}>
                  Keep
                </button>
              </span>
            ) : (
              <button type="button" className="btn-ghost ml-auto text-red-700" onClick={() => setConfirmDelete(true)}>
                Delete
              </button>
            ))}
        </div>
      </form>
    </Modal>
  )
}
