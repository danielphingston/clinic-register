import { useLayoutEffect, useRef } from 'react'

// A textarea with clickable placeholder tags. Clicking a tag inserts its token
// at the caret (replacing any selection) and leaves the caret after it.
export function PlaceholderTextarea({
  id,
  rows,
  value,
  onChange,
  tokens,
}: {
  id: string
  rows: number
  value: string
  onChange: (v: string) => void
  tokens: { label: string; token: string }[]
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const caret = useRef<number | null>(null)

  // Runs after the new value is rendered, so the caret position sticks.
  useLayoutEffect(() => {
    if (caret.current === null || !ref.current) return
    ref.current.focus()
    ref.current.setSelectionRange(caret.current, caret.current)
    caret.current = null
  }, [value])

  function insert(token: string) {
    const el = ref.current
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    caret.current = start + token.length
    onChange(value.slice(0, start) + token + value.slice(end))
  }

  return (
    <>
      <textarea ref={ref} id={id} rows={rows} className="input" value={value} onChange={(e) => onChange(e.target.value)} />
      <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label="Insert placeholder">
        {tokens.map((t) => (
          <button
            key={t.token}
            type="button"
            className="rounded-full border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100"
            title={`Insert ${t.token}`}
            onClick={() => insert(t.token)}
          >
            + {t.label}
          </button>
        ))}
      </div>
    </>
  )
}
