import { useLiveQuery } from 'dexie-react-hooks'
import { useId, useMemo, useState } from 'react'
import { getBranding, setBrandingImage } from '../../db/repo'
import type { Branding } from '../../db/types'
import { extractInk, INK_COLORS, InkError, loadPixels, pixelsToPngDataUrl, type Pixels } from '../../lib/inkImage'
import { useDebounced } from '../../lib/useDebounced'
import { useSyncStatus } from '../../sync/service'

interface Slot {
  key: keyof Branding
  label: string
  hint: string
  // Signatures and stamps are cleaned to ink on transparent; a logo is only resized.
  ink: boolean
  defaultColor: number // index into INK_COLORS
}

const SLOTS: Slot[] = [
  { key: 'logo', label: 'Logo', hint: 'Shown on the letterhead of every printout.', ink: false, defaultColor: 0 },
  {
    key: 'signature',
    label: 'Signature',
    hint: 'Sign on plain white paper with a dark pen and take a sharp, well-lit photo from straight above.',
    ink: true,
    defaultColor: 0,
  },
  {
    key: 'seal',
    label: 'Seal / stamp',
    hint: 'Stamp on plain white paper and photograph it the same way.',
    ink: true,
    defaultColor: 2,
  },
]

// Logo, signature and seal images for printouts. They are stored on this
// device and synced to the clinic's Drive like settings; the photo as
// uploaded is never kept, only the cleaned image.
export function BrandingSettings() {
  const branding = useLiveQuery(getBranding)
  const { encrypted } = useSyncStatus()
  if (!branding) return null
  return (
    <section className="card mt-4 space-y-4" aria-labelledby="branding-heading" data-testid="branding-settings">
      <div>
        <h2 id="branding-heading" className="font-semibold">
          Logo, signature and seal
        </h2>
        <p className="text-sm text-slate-500">
          Used on certificates (the logo on all printouts). Stored on this device and in your clinic's Google Drive, never in
          the app itself. The signature and seal are added only when you tick them on the print page.
        </p>
        {encrypted === false && (branding.signature || branding.seal) && (
          <p className="mt-2 rounded-md bg-amber-50 p-2 text-sm text-amber-900">
            Your Drive backup is not encrypted, so the signature is stored there as a plain image. Consider turning on
            encryption under Sync &amp; Security.
          </p>
        )}
      </div>
      {SLOTS.map((s) => (
        <ImageSlot key={s.key} slot={s} current={branding[s.key]} />
      ))}
    </section>
  )
}

function ImageSlot({ slot, current }: { slot: Slot; current?: string }) {
  const inputId = useId()
  const [source, setSource] = useState<Pixels | null>(null)
  const [strength, setStrength] = useState(0.5)
  const [color, setColor] = useState(slot.defaultColor)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const debouncedStrength = useDebounced(strength, 150)

  const result = useMemo(() => {
    if (!source) return null
    try {
      const pixels = slot.ink ? extractInk(source, { strength: debouncedStrength, color: INK_COLORS[color].value }) : source
      return { url: pixelsToPngDataUrl(pixels), error: '' }
    } catch (err) {
      return { url: '', error: err instanceof InkError ? err.message : "Couldn't process this image." }
    }
  }, [source, debouncedStrength, color, slot.ink])

  async function pick(file: File | undefined) {
    if (!file) return
    setError('')
    setBusy(true)
    try {
      setSource(await loadPixels(file, slot.ink ? 1200 : 600))
    } catch (err) {
      setError(err instanceof InkError ? err.message : "Couldn't read this image.")
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!result?.url) return
    await setBrandingImage(slot.key, result.url)
    setSource(null)
  }

  const shown = result?.url || (!source ? current : undefined)

  return (
    <div className="space-y-2 border-t border-slate-100 pt-4" data-testid={`branding-${slot.key}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{slot.label}</h3>
        <div className="flex gap-2">
          <label htmlFor={inputId} className="btn-ghost cursor-pointer border border-slate-300 px-3 py-1">
            {current ? 'Replace' : 'Upload'}
          </label>
          <input
            id={inputId}
            type="file"
            accept="image/*"
            className="sr-only"
            aria-label={`Upload ${slot.label.toLowerCase()}`}
            onChange={(e) => {
              void pick(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          {current && !source && (
            <button type="button" className="btn-ghost px-3 py-1 text-red-700" onClick={() => void setBrandingImage(slot.key, undefined)}>
              Remove
            </button>
          )}
        </div>
      </div>
      <p className="text-xs text-slate-500">{slot.hint}</p>

      {/* Previewed on white, as it will print. */}
      <div className="flex min-h-[5rem] items-center justify-center rounded-md border border-slate-200 bg-white p-3">
        {busy ? (
          <span className="text-sm text-slate-500">Reading…</span>
        ) : shown ? (
          <img src={shown} alt={`${slot.label} preview`} className="max-h-32 max-w-full object-contain mix-blend-multiply" />
        ) : (
          <span className="text-sm text-slate-400">None</span>
        )}
      </div>

      {source && (
        <div className="space-y-3 rounded-md bg-slate-50 p-3">
          {slot.ink && (
            <div className="flex flex-wrap items-end gap-4">
              <div className="min-w-[12rem] flex-1">
                <label className="label" htmlFor={`${inputId}-strength`}>
                  Strength
                </label>
                <input
                  id={`${inputId}-strength`}
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={strength}
                  onChange={(e) => setStrength(Number(e.target.value))}
                  className="w-full"
                />
                <p className="text-xs text-slate-500">Lower removes more of the paper; higher keeps fainter strokes.</p>
              </div>
              <div>
                <label className="label" htmlFor={`${inputId}-color`}>
                  Colour
                </label>
                <select id={`${inputId}-color`} className="input" value={color} onChange={(e) => setColor(Number(e.target.value))}>
                  {INK_COLORS.map((c, i) => (
                    <option key={c.label} value={i}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {(result?.error || error) && (
            <p role="alert" className="text-sm text-red-700">
              {result?.error || error}
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" className="btn-primary px-3 py-1" disabled={!result?.url} onClick={() => void save()}>
              Save {slot.label.toLowerCase()}
            </button>
            <button type="button" className="btn-ghost px-3 py-1" onClick={() => setSource(null)}>
              Discard
            </button>
          </div>
        </div>
      )}
      {!source && error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}
