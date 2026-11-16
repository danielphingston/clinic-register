import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type FormEvent } from 'react'
import { Modal } from '../../app/Modal'
import { isBuiltinCategory } from './expenseLogic'
import { addCategory, expenseCategories, removeCategory, updateCategory } from './expenseRepo'

// The built-in categories are fixed; the clinic can add its own (salary,
// internet, maintenance…) and mark them as fixed or variable costs.
export function CategoriesDialog({ onClose }: { onClose: () => void }) {
  const categories = useLiveQuery(expenseCategories)
  const [name, setName] = useState('')
  const [fixed, setFixed] = useState(false)
  const [error, setError] = useState('')

  async function add(e: FormEvent) {
    e.preventDefault()
    try {
      await addCategory(name, fixed)
      setName('')
      setFixed(false)
      setError('')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Modal title="Expense categories" onClose={onClose}>
      <p className="mb-3 text-sm text-slate-600">
        <span className="font-medium">Fixed</span> costs stay the same however many patients come (rent). They set the break-even point in the Profit & loss report.
      </p>
      <ul className="divide-y divide-slate-100 rounded-md border border-slate-200" aria-label="Categories">
        {categories
          ?.filter((c) => !c.archived)
          .map((c) => {
            const builtin = isBuiltinCategory(c.id)
            return (
              <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 truncate font-medium">{c.name}</span>
                {builtin ? (
                  <span className="text-xs text-slate-500">{c.fixed ? 'Fixed' : 'Variable'} · built-in</span>
                ) : (
                  <span className="flex shrink-0 items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs">
                      <input type="checkbox" checked={c.fixed} aria-label={`${c.name} is a fixed cost`} onChange={(e) => updateCategory(c.id, { fixed: e.target.checked })} />
                      Fixed
                    </label>
                    <button type="button" className="btn-ghost px-2 py-0.5 text-red-700" aria-label={`Remove ${c.name}`} onClick={() => removeCategory(c.id)}>
                      Remove
                    </button>
                  </span>
                )}
              </li>
            )
          })}
      </ul>
      <form onSubmit={add} className="mt-4 space-y-2" noValidate>
        <label className="label" htmlFor="category-name">
          New category
        </label>
        <div className="flex gap-2">
          <input id="category-name" className="input" value={name} placeholder="e.g. Salary, Internet, Maintenance" onChange={(e) => (setName(e.target.value), setError(''))} />
          <button type="submit" className="btn-primary shrink-0">
            Add
          </button>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={fixed} onChange={(e) => setFixed(e.target.checked)} />
          Fixed cost
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <p className="text-xs text-slate-500">Removing a category hides it from new expenses; past expenses keep it.</p>
      </form>
    </Modal>
  )
}
