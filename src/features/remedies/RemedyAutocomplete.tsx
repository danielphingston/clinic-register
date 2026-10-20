import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react'
import { db } from '../../db/db'
import type { Remedy } from '../../db/types'
import { searchRemedies } from './remedyRepo'

interface Props {
  value: string // remedyId, '' when none
  onChange: (remedyId: string) => void
  id?: string
  label?: string // accessible name when there is no visible <label>
  placeholder?: string
  className?: string
}

export function RemedyAutocomplete({ value, onChange, id, label, placeholder = 'Search remedy…', className }: Props) {
  // All remedies, deleted included, so a past selection still shows its name.
  const all = useLiveQuery(async () => db.remedies.toArray(), [], [] as Remedy[])
  const selected = useMemo(() => all.find((r) => r.id === value), [all, value])
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()

  const selectedName = selected?.name ?? ''
  useEffect(() => {
    setText(selectedName)
  }, [selectedName])

  const matches = useMemo(() => (open ? searchRemedies(all, text, 12) : []), [all, text, open])
  const showList = open && matches.length > 0

  function pick(r: Remedy) {
    onChange(r.id)
    setText(r.name)
    setOpen(false)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) setOpen(true)
      else setActive((a) => Math.min(a + 1, matches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if ((e.key === 'Enter' || e.key === 'Tab') && showList) {
      if (e.key === 'Enter') e.preventDefault()
      pick(matches[active])
    } else if (e.key === 'Escape' && open) {
      e.preventDefault()
      setOpen(false)
    }
  }

  function onBlur() {
    setOpen(false)
    if (!text.trim()) {
      if (value) onChange('')
    } else {
      setText(selectedName)
    }
  }

  return (
    <div className={`relative ${className ?? ''}`}>
      <input
        id={id}
        className="input"
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList ? `${listId}-${active}` : undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 z-20 mt-1 max-h-64 min-w-[14rem] overflow-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg"
        >
          {matches.map((r, i) => (
            <li
              key={r.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 ${
                i === active ? 'bg-brand-50 text-brand-800' : ''
              }`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(r)}
            >
              <span>{r.name}</span>
              <span className="shrink-0 text-xs text-slate-500">
                {r.abbrev}
                {r.isCustom ? ' · custom' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
