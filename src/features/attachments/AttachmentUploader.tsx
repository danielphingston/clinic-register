import { useId, useRef, useState, type ChangeEvent } from 'react'
import type { AttachmentKind } from '../../db/types'
import { categorize, UNSUPPORTED_MESSAGE } from '../../lib/compress'
import { formatBytes } from '../../lib/format'
import { addAttachment, ATTACHMENT_KINDS, KIND_LABEL } from './attachmentRepo'

type Status = 'ready' | 'working' | 'saved' | 'error'

interface Item {
  key: string
  file: File
  keepOriginal: boolean
  status: Status
  message?: string
  sizes?: string
}

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,application/pdf,.pdf'

export function AttachmentUploader({ patientId, visitId }: { patientId: string; visitId?: string }) {
  const id = useId()
  const [kind, setKind] = useState<AttachmentKind>('lab')
  const [caption, setCaption] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  function patch(key: string, changes: Partial<Item>) {
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...changes } : i)))
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])]
    e.target.value = ''
    setItems((list) => [
      ...list,
      ...files.map<Item>((file) => {
        const ok = categorize(file) !== null
        return {
          key: crypto.randomUUID(),
          file,
          keepOriginal: false,
          status: ok ? 'ready' : 'error',
          message: ok ? undefined : UNSUPPORTED_MESSAGE,
        }
      }),
    ])
  }

  // One at a time: decoding several large photos or PDFs at once can exhaust
  // memory on phones.
  async function saveAll() {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    const queue = items.filter((i) => i.status === 'ready')
    for (const item of queue) {
      patch(item.key, { status: 'working', message: undefined })
      try {
        const { result, deduped } = await addAttachment({
          patientId,
          visitId,
          kind,
          file: item.file,
          caption,
          keepOriginal: item.keepOriginal,
        })
        const notes = [result.note, deduped && 'Same file already stored, reused'].filter(Boolean).join(' · ')
        patch(item.key, {
          status: 'saved',
          sizes: result.compressed ? `${formatBytes(result.originalSize)} → ${formatBytes(result.size)}` : formatBytes(result.size),
          message: notes || undefined,
        })
      } catch (err) {
        patch(item.key, { status: 'error', message: (err as Error).message || "Couldn't save this file" })
      }
    }
    setCaption('')
    busyRef.current = false
    setBusy(false)
  }

  const ready = items.filter((i) => i.status === 'ready').length
  const finished = items.some((i) => i.status === 'saved' || i.status === 'error')

  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3" data-testid="attachment-uploader">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`${id}-kind`}>
            Type
          </label>
          <select id={`${id}-kind`} className="input" value={kind} onChange={(e) => setKind(e.target.value as AttachmentKind)}>
            {ATTACHMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`${id}-caption`}>
            Caption (optional)
          </label>
          <input
            id={`${id}-caption`}
            className="input"
            value={caption}
            placeholder="e.g. CBC, thyroid profile"
            onChange={(e) => setCaption(e.target.value)}
            // Inside the visit form, Enter must not submit the visit.
            onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <label className="btn-ghost cursor-pointer border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-brand-500">
          Choose files
          <input type="file" multiple accept={ACCEPT} className="sr-only" aria-label="Choose files" onChange={onPick} />
        </label>
        <label className="btn-ghost cursor-pointer border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-brand-500 md:hidden">
          Take photo
          <input type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Take photo" onChange={onPick} />
        </label>
      </div>
      <p className="text-xs text-slate-500">Images and PDFs. Photos are resized and PDFs over 1 MB are compressed on this device.</p>

      {items.length > 0 && (
        <ul className="space-y-2" aria-label="Files to attach">
          {items.map((i) => (
            <li key={i.key} className="rounded-md border border-slate-200 bg-white p-2 text-sm" data-testid="upload-item">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 break-all font-medium">{i.file.name}</span>
                {i.status === 'ready' && (
                  <button
                    type="button"
                    className="btn-ghost shrink-0 px-2 py-0.5 text-slate-500"
                    aria-label={`Remove ${i.file.name}`}
                    onClick={() => setItems((list) => list.filter((x) => x.key !== i.key))}
                  >
                    ✕
                  </button>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="text-slate-500">{formatBytes(i.file.size)}</span>
                {(i.status === 'ready' || i.keepOriginal) && i.status !== 'error' && (
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={i.keepOriginal}
                      disabled={i.status !== 'ready'}
                      onChange={(e) => patch(i.key, { keepOriginal: e.target.checked })}
                    />
                    Keep original
                  </label>
                )}
                <span role="status" className={i.status === 'error' ? 'text-red-600' : i.status === 'saved' ? 'text-brand-700' : 'text-slate-600'}>
                  {i.status === 'working' && 'Compressing…'}
                  {i.status === 'saved' && `Saved · ${i.sizes}`}
                  {i.status === 'error' && i.message}
                </span>
              </div>
              {i.status === 'saved' && i.message && <p className="mt-1 text-xs text-slate-500">{i.message}</p>}
            </li>
          ))}
        </ul>
      )}

      {(ready > 0 || finished) && (
        <div className="flex flex-wrap gap-2">
          {ready > 0 && (
            <button type="button" className="btn-primary" disabled={busy} onClick={saveAll}>
              {busy ? 'Saving…' : `Save ${ready} file${ready === 1 ? '' : 's'}`}
            </button>
          )}
          {finished && !busy && (
            <button
              type="button"
              className="btn-ghost border border-slate-300 bg-white"
              onClick={() => setItems((list) => list.filter((i) => i.status === 'ready'))}
            >
              Clear finished
            </button>
          )}
        </div>
      )}
    </div>
  )
}
