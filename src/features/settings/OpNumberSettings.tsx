import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { peekOpNumber } from '../../db/repo'
import { OP_FORMAT_EXAMPLES, OP_TOKENS, opFormatHint, renderOpNo, validateOpFormat } from '../../lib/opFormat'

// The OP number format with clickable tags, a live preview of the next number
// and the "Next OP number" override. Saved with the rest of the settings form.
export function OpNumberSettings({
  format,
  onFormat,
  nextN,
  onNextN,
  version,
}: {
  format: string
  onFormat: (v: string) => void
  nextN: string
  onNextN: (v: string) => void
  // Changes after each save, so the preview re-reads the stored numbers.
  version: number
}) {
  const ref = useRef<HTMLInputElement>(null)
  const caret = useRef<number | null>(null)
  const [peek, setPeek] = useState<number | null>(null)
  const [showExamples, setShowExamples] = useState(false)
  const error = validateOpFormat(format)
  const hint = error ? null : opFormatHint(format)
  const now = new Date()

  useLayoutEffect(() => {
    if (caret.current === null || !ref.current) return
    ref.current.focus()
    ref.current.setSelectionRange(caret.current, caret.current)
    caret.current = null
  }, [format])

  useEffect(() => {
    if (error) return setPeek(null)
    let live = true
    // Only a preview: if the read fails (e.g. the database closed while it ran), show none.
    peekOpNumber(new Date(), format).then(
      (p) => live && setPeek(p.n),
      () => live && setPeek(null),
    )
    return () => {
      live = false
    }
  }, [format, error, version])

  function insert(token: string) {
    const el = ref.current
    const start = el?.selectionStart ?? format.length
    const end = el?.selectionEnd ?? format.length
    caret.current = start + token.length
    onFormat(format.slice(0, start) + token + format.slice(end))
  }

  const typed = /^\d+$/.test(nextN.trim()) ? Number(nextN.trim()) : undefined
  const next = peek === null ? null : Math.max(peek, typed ?? 0)

  return (
    <fieldset className="space-y-3 rounded-md border border-slate-200 p-3">
      <legend className="px-1 text-sm font-semibold">OP numbers</legend>
      <div>
        <label className="label" htmlFor="opFormat">
          OP number format
        </label>
        <input
          ref={ref}
          id="opFormat"
          className="input font-mono"
          value={format}
          aria-invalid={error ? true : undefined}
          aria-describedby="opFormat-help"
          onChange={(e) => onFormat(e.target.value)}
        />
        <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label="Insert placeholder">
          {OP_TOKENS.map((t) => (
            <span key={t.token} className="group relative">
              <button
                type="button"
                className="rounded-full border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100"
                aria-describedby={`tip-${t.token}`}
                onClick={() => insert(t.token)}
              >
                + {t.label}
              </button>
              <span
                id={`tip-${t.token}`}
                role="tooltip"
                className="pointer-events-none invisible absolute left-0 top-full z-20 mt-1 w-56 rounded-md bg-slate-800 px-2 py-1.5 text-xs text-white opacity-0 shadow-lg transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
              >
                <span className="font-mono">{t.token}</span>: {t.meaning}. e.g. <span className="font-mono">{t.example}</span>
              </span>
            </span>
          ))}
          <button
            type="button"
            className="rounded-full px-2 py-0.5 text-xs text-brand-700 underline-offset-2 hover:underline"
            aria-expanded={showExamples}
            aria-controls="opFormat-examples"
            onClick={() => setShowExamples((v) => !v)}
          >
            {showExamples ? 'Hide examples' : 'Show examples'}
          </button>
        </div>
        {showExamples && (
          <div id="opFormat-examples" className="mt-2 space-y-2 rounded-md bg-slate-50 p-2 text-xs text-slate-700">
            <table className="w-full">
              <tbody>
                {OP_TOKENS.map((t) => (
                  <tr key={t.token}>
                    <td className="py-0.5 pr-2 font-mono">{t.token}</td>
                    <td className="py-0.5 pr-2">{t.meaning}</td>
                    <td className="py-0.5 font-mono">{t.example}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="font-medium">Ready-made formats (click to use):</p>
            <ul className="space-y-1">
              {OP_FORMAT_EXAMPLES.map((x) => (
                <li key={x.format}>
                  <button
                    type="button"
                    className="w-full rounded px-1 py-0.5 text-left hover:bg-white"
                    onClick={() => onFormat(x.format)}
                  >
                    <span className="font-mono">{x.format}</span> → <span className="font-mono font-medium">{renderOpNo(x.format, now, 183)}</span>{' '}
                    <span className="text-slate-500">({x.note})</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="text-slate-500">Any other text, or none, is printed as it is. Existing patients keep their numbers when the format changes.</p>
          </div>
        )}
        <div id="opFormat-help" className="mt-1 text-xs">
          {error ? (
            <p className="text-red-600">{error}</p>
          ) : (
            <>
              {next !== null && (
                <p className="text-slate-600" data-testid="op-preview">
                  Next new patient: <span className="font-mono font-medium">{renderOpNo(format, now, next)}</span>
                </p>
              )}
              {hint && <p className="text-amber-700">{hint}</p>}
            </>
          )}
        </div>
      </div>
      <div className="max-w-xs">
        <label className="label" htmlFor="opNextN">
          Next OP number
        </label>
        <input
          id="opNextN"
          className="input"
          inputMode="numeric"
          placeholder={peek === null ? '' : String(peek)}
          value={nextN}
          onChange={(e) => onNextN(e.target.value)}
        />
        <p className="mt-1 text-xs text-slate-500">
          Usually automatic: one after the last patient&apos;s number. Set it to carry on from a paper register, e.g. 184.
          {typed !== undefined && peek !== null && typed < peek && ` ${peek - 1} is already used, so numbering continues from ${peek}.`}
        </p>
      </div>
    </fieldset>
  )
}
