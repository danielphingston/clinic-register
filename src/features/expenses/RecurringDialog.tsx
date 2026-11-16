import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type FormEvent } from 'react'
import { Modal } from '../../app/Modal'
import type { ExpenseMode, RecurringExpense } from '../../db/types'
import { parseAmount, todayISO } from '../../lib/format'
import { OTHER_CATEGORY } from './expenseLogic'
import { addRecurring, deleteRecurring, editRecurring, expenseCategories } from './expenseRepo'
import { CategoryPicker, ModeField } from './ExpenseDialog'

// A monthly expense (rent, a retainer). Each month it shows as due from its
// day until "Mark paid" or "Skip".
export function RecurringDialog({ rule, onClose }: { rule?: RecurringExpense; onClose: () => void }) {
  const categories = useLiveQuery(expenseCategories)
  const [category, setCategory] = useState(rule?.category ?? 'rent')
  const [amount, setAmount] = useState(rule ? String(rule.amount) : '')
  const [day, setDay] = useState(rule ? String(rule.day) : '1')
  const [mode, setMode] = useState<ExpenseMode>(rule?.mode ?? 'bank')
  const [note, setNote] = useState(rule?.note ?? '')
  const [startMonth, setStartMonth] = useState(rule?.startMonth ?? todayISO().slice(0, 7))
  const [paused, setPaused] = useState(!!rule?.paused)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const input = { category, amount: parseAmount(amount), day: Number(day), mode, note, startMonth }
    try {
      if (rule) await editRecurring(rule.id, { ...input, paused })
      else await addRecurring(input)
      onClose()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function remove() {
    if (!rule) return
    await deleteRecurring(rule.id)
    onClose()
  }

  const offered = categories?.filter((c) => !c.archived || c.id === category) ?? []

  return (
    <Modal title={rule ? 'Edit recurring expense' : 'Add recurring expense'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <span className="label">Category</span>
          <CategoryPicker categories={offered} value={category} onChange={(c) => (setCategory(c), setError(''))} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="recurring-amount">
              Usual amount
            </label>
            <input id="recurring-amount" className="input text-right" inputMode="decimal" value={amount} onChange={(e) => (setAmount(e.target.value), setError(''))} />
          </div>
          <div>
            <label className="label" htmlFor="recurring-day">
              Due on day
            </label>
            <input id="recurring-day" type="number" min={1} max={31} className="input" value={day} onChange={(e) => (setDay(e.target.value), setError(''))} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="recurring-mode">
              Usually paid via
            </label>
            <ModeField id="recurring-mode" value={mode} onChange={setMode} />
          </div>
          <div>
            <label className="label" htmlFor="recurring-start">
              Starting
            </label>
            <input id="recurring-start" type="month" className="input" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="recurring-note">
            {category === OTHER_CATEGORY ? 'What is it for?' : 'Note or payee (optional)'}
          </label>
          <input id="recurring-note" className="input" value={note} placeholder="e.g. Landlord, Mr. Varghese" onChange={(e) => (setNote(e.target.value), setError(''))} />
        </div>
        <p className="text-xs text-slate-500">Days past the end of a short month fall on its last day. Nothing is recorded until you mark a month paid.</p>
        {rule && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
            Paused (stop showing it as due)
          </label>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="btn-primary" disabled={!categories}>
            Save
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          {rule &&
            (confirmDelete ? (
              <span className="ml-auto flex items-center gap-2 text-sm" role="group" aria-label="Confirm delete">
                Delete? Past payments stay.
                <button type="button" className="btn-ghost border border-red-300 px-2 py-1 text-red-700" onClick={remove}>
                  Delete
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
