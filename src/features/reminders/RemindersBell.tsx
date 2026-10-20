import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { db } from '../../db/db'
import { todayISO } from '../../lib/format'
import { followUpsDue } from '../visits/visitRepo'
import { reminderCounts } from './reminderCheck'
import { REMINDER_LABEL, REMINDER_TYPES, REMINDER_URL, reminderText, totalReminders } from './reminderLogic'

// Header bell: today's open appointments, follow-ups, overdue dues, low stock.
export function RemindersBell() {
  const counts = useLiveQuery(async () => reminderCounts(db))
  const [open, setOpen] = useState(false)
  const today = todayISO()
  const followUps = useLiveQuery(async () => (open ? followUpsDue(today) : Promise.resolve([])), [open, today])
  const panelId = useId()
  const wrap = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const total = counts ? totalReminders(counts) : 0

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        button.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="relative rounded-full p-2 text-slate-600 hover:bg-slate-100"
        aria-label={total ? `Reminders, ${total} pending` : 'Reminders'}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" strokeLinecap="round" />
        </svg>
        {total > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-[1.1rem] rounded-full bg-red-600 px-1 text-center text-[10px] font-semibold leading-[1.1rem] text-white" data-testid="reminder-badge">
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>
      {open && (
        <div id={panelId} role="region" aria-label="Reminders" className="absolute right-0 z-30 mt-2 w-72 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
          {total === 0 && <p className="p-2 text-sm text-slate-500">Nothing needs attention right now.</p>}
          <ul>
            {counts &&
              REMINDER_TYPES.filter((t) => counts[t] > 0).map((t) => (
                <li key={t}>
                  <Link to={REMINDER_URL[t]} onClick={() => setOpen(false)} className="flex items-start justify-between gap-3 rounded-md p-2 text-sm hover:bg-slate-50">
                    <span>
                      <span className="block font-medium text-slate-800">{REMINDER_LABEL[t]}</span>
                      <span className="block text-xs text-slate-500">{reminderText(t, counts[t])}</span>
                    </span>
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">{counts[t]}</span>
                  </Link>
                  {t === 'followups' && followUps && followUps.length > 0 && (
                    <ul className="mb-1 ml-2 border-l border-slate-100 pl-2" aria-label="Patients due for follow-up">
                      {followUps.slice(0, 5).map((f) => (
                        <li key={f.patient.id}>
                          <Link to={`/patients/${f.patient.id}`} onClick={() => setOpen(false)} className="block truncate rounded px-2 py-1 text-xs text-brand-700 hover:bg-slate-50">
                            {f.patient.name}
                          </Link>
                        </li>
                      ))}
                      {followUps.length > 5 && <li className="px-2 py-1 text-xs text-slate-500">and {followUps.length - 5} more</li>}
                    </ul>
                  )}
                </li>
              ))}
          </ul>
          <Link to="/settings#notifications" onClick={() => setOpen(false)} className="mt-1 block border-t border-slate-100 px-2 pt-2 text-xs text-brand-700 hover:underline">
            Notification settings
          </Link>
        </div>
      )}
    </div>
  )
}
