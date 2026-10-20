import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Attachment, AttachmentKind } from '../../db/types'
import { formatBytes, formatDate, toISODate } from '../../lib/format'
import { ATTACHMENT_KINDS, KIND_LABEL } from './attachmentRepo'
import { AttachmentViewer } from './AttachmentViewer'
import { useBlobUrl } from './useBlobUrl'

function Thumb({ a }: { a: Attachment }) {
  const isPdf = a.mime === 'application/pdf'
  // PDFs never load their blob for the grid.
  const { url, missing } = useBlobUrl(isPdf ? undefined : a.blobHash)
  if (isPdf) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 bg-red-50 text-red-700">
        <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
        </svg>
        <span className="text-xs font-semibold">PDF{a.pages ? ` · ${a.pages} p` : ''}</span>
      </div>
    )
  }
  if (missing) return <div className="flex h-full items-center justify-center p-2 text-center text-xs text-slate-500">Not downloaded yet</div>
  return url ? <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" /> : null
}

interface Props {
  items: Attachment[]
  visitDates?: Map<string, string>
  filter?: boolean
  className?: string
  empty?: string
}

export function AttachmentGrid({ items, visitDates, filter, className = 'grid-cols-2 sm:grid-cols-3', empty = 'No attachments yet.' }: Props) {
  const [kind, setKind] = useState<AttachmentKind | 'all'>('all')
  const [openId, setOpenId] = useState<string>()
  const shown = kind === 'all' ? items : items.filter((a) => a.kind === kind)

  return (
    <div className="space-y-2">
      {filter && items.length > 0 && (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter attachments">
          {(['all', ...ATTACHMENT_KINDS] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${kind === k ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
            >
              {k === 'all' ? 'All' : KIND_LABEL[k]}
            </button>
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="text-sm text-slate-500">{items.length ? 'None of this type.' : empty}</p>
      ) : (
        <ul className={`grid gap-2 ${className}`}>
          {shown.map((a) => (
            <li key={a.id} className="overflow-hidden rounded-md border border-slate-200 bg-white text-xs" data-testid="attachment-tile">
              <button
                type="button"
                className="block aspect-square w-full bg-slate-100"
                onClick={() => setOpenId(a.id)}
              >
                {/* Named by content so the visible text (e.g. "PDF · 2 p") is part of it. */}
                <span className="sr-only">Open {a.caption || a.fileName}</span>
                <Thumb a={a} />
              </button>
              <div className="space-y-0.5 p-1.5">
                <p className="truncate font-medium text-slate-800" title={a.caption || a.fileName}>
                  {a.caption || a.fileName}
                </p>
                <p className="text-slate-500">
                  {formatDate(toISODate(new Date(a.createdAt)))} · {formatBytes(a.size)}
                </p>
                {a.visitId && visitDates?.has(a.visitId) && (
                  <Link to={`/patients/${a.patientId}/visits/${a.visitId}`} className="text-brand-700 hover:underline">
                    Visit {formatDate(visitDates.get(a.visitId))}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {openId && <AttachmentViewer items={shown} openId={openId} onOpen={setOpenId} onClose={() => setOpenId(undefined)} visitDates={visitDates} />}
    </div>
  )
}
