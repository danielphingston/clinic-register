import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import type { Attachment } from '../../db/types'
import { formatBytes, formatDate, toISODate } from '../../lib/format'
import { deleteAttachment, KIND_LABEL, updateCaption } from './attachmentRepo'
import { useBlobUrl } from './useBlobUrl'

interface Props {
  items: Attachment[]
  openId: string
  onOpen: (id: string) => void
  onClose: () => void
  visitDates?: Map<string, string>
}

// Full-screen viewer. Portalled to <body> so form controls here are never
// part of an enclosing visit <form>.
export function AttachmentViewer({ items, openId, onOpen, onClose, visitDates }: Props) {
  const index = items.findIndex((a) => a.id === openId)
  const current = index >= 0 ? items[index] : undefined
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!current) closeRef.current()
  }, [current])

  if (!current) return null
  return createPortal(
    <ViewerBody
      key={current.id}
      a={current}
      position={`${index + 1} / ${items.length}`}
      prev={index > 0 ? () => onOpen(items[index - 1].id) : undefined}
      next={index < items.length - 1 ? () => onOpen(items[index + 1].id) : undefined}
      onClose={onClose}
      onDeleted={() => {
        const neighbour = items[index + 1] ?? items[index - 1]
        if (neighbour) onOpen(neighbour.id)
        else onClose()
      }}
      visitDate={current.visitId ? visitDates?.get(current.visitId) : undefined}
    />,
    document.body,
  )
}

function ViewerBody({
  a,
  position,
  prev,
  next,
  onClose,
  onDeleted,
  visitDate,
}: {
  a: Attachment
  position: string
  prev?: () => void
  next?: () => void
  onClose: () => void
  onDeleted: () => void
  visitDate?: string
}) {
  const { url, missing, downloading } = useBlobUrl(a.blobHash)
  const [zoom, setZoom] = useState(false)
  const [caption, setCaption] = useState(a.caption ?? '')
  const [captionSaved, setCaptionSaved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const touchX = useRef<number | null>(null)
  const isPdf = a.mime === 'application/pdf'
  const nav = useRef({ prev, next, onClose })
  nav.current = { prev, next, onClose }

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    closeBtn.current?.focus()
    function onKey(e: KeyboardEvent) {
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea, select')
      if (e.key === 'Escape') nav.current.onClose()
      else if (!typing && e.key === 'ArrowLeft') nav.current.prev?.()
      else if (!typing && e.key === 'ArrowRight') nav.current.next?.()
    }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      before?.focus?.()
    }
  }, [])

  async function saveCaption(e: FormEvent) {
    e.preventDefault()
    await updateCaption(a.id, caption)
    setCaptionSaved(true)
  }

  async function remove() {
    await deleteAttachment(a.id)
    onDeleted()
  }

  const title = a.caption || a.fileName
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Attachment: ${title}`}
      className="no-print fixed inset-0 z-50 flex flex-col bg-slate-950 text-white"
    >
      <div className="flex items-center gap-2 px-3 py-2" style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{title}</p>
          <p className="text-xs text-slate-300">{position}</p>
        </div>
        <button ref={closeBtn} type="button" className="btn px-3 py-1 text-white hover:bg-white/10" aria-label="Close viewer" onClick={onClose}>
          ✕
        </button>
      </div>

      <div
        className="relative min-h-0 flex-1"
        onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          const start = touchX.current
          touchX.current = null
          if (start === null || zoom || isPdf) return
          const dx = e.changedTouches[0].clientX - start
          if (dx > 60) prev?.()
          else if (dx < -60) next?.()
        }}
      >
        {missing ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-300" data-testid="viewer-missing">
            {downloading
              ? 'Downloading from Google Drive…'
              : "This file isn't on this device yet. It will appear after Drive sync downloads it."}
          </div>
        ) : !url ? null : isPdf ? (
          <iframe src={url} title={a.fileName} className="h-full w-full bg-white" />
        ) : (
          <div className={`h-full w-full ${zoom ? 'overflow-auto' : 'flex items-center justify-center overflow-hidden'}`}>
            <img
              src={url}
              alt={title}
              onClick={() => setZoom((z) => !z)}
              className={zoom ? 'max-w-none cursor-zoom-out' : 'max-h-full max-w-full cursor-zoom-in object-contain'}
            />
          </div>
        )}
        {prev && (
          <button
            type="button"
            aria-label="Previous"
            className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 px-3 py-2 text-xl hover:bg-black/70"
            onClick={prev}
          >
            ‹
          </button>
        )}
        {next && (
          <button
            type="button"
            aria-label="Next"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 px-3 py-2 text-xl hover:bg-black/70"
            onClick={next}
          >
            ›
          </button>
        )}
      </div>

      <div className="space-y-2 bg-slate-900 px-3 py-3 text-sm" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <p className="text-slate-300">
          {KIND_LABEL[a.kind]} · {formatDate(toISODate(new Date(a.createdAt)))} ·{' '}
          {a.size < a.originalSize ? `${formatBytes(a.originalSize)} → ${formatBytes(a.size)}` : formatBytes(a.size)}
          {a.pages ? ` · ${a.pages} page${a.pages === 1 ? '' : 's'}` : ''}
          {a.visitId && (
            <>
              {' · '}
              <Link to={`/patients/${a.patientId}/visits/${a.visitId}`} className="text-brand-100 underline" onClick={onClose}>
                Visit{visitDate ? ` ${formatDate(visitDate)}` : ''}
              </Link>
            </>
          )}
        </p>
        <form onSubmit={saveCaption} className="flex gap-2">
          <input
            className="input min-w-0 flex-1 text-slate-900"
            aria-label="Caption"
            placeholder="Caption"
            value={caption}
            onChange={(e) => {
              setCaption(e.target.value)
              setCaptionSaved(false)
            }}
          />
          <button type="submit" className="btn-primary shrink-0" disabled={caption.trim() === (a.caption ?? '')}>
            {captionSaved && caption.trim() === (a.caption ?? '') ? 'Saved' : 'Save caption'}
          </button>
        </form>
        <div className="flex flex-wrap items-center gap-2">
          {url && (
            <>
              <a href={url} download={a.fileName} className="btn border border-white/30 text-white hover:bg-white/10">
                Download
              </a>
              {isPdf && (
                <a href={url} target="_blank" rel="noopener" className="btn border border-white/30 text-white hover:bg-white/10">
                  Open in new tab
                </a>
              )}
            </>
          )}
          {confirmDelete ? (
            <span className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirm delete">
              <span>Delete this attachment?</span>
              <button type="button" className="btn bg-red-600 text-white hover:bg-red-700" onClick={remove}>
                Delete
              </button>
              <button type="button" className="btn text-white hover:bg-white/10" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className="btn text-red-300 hover:bg-white/10" onClick={() => setConfirmDelete(true)}>
              Delete…
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
