import { useEffect, useId, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

export interface NavItem {
  to: string
  label: string
  icon: string
}

const PRIMARY = ['/', '/patients', '/calendar', '/billing']

const isUnder = (path: string, to: string) => (to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`))

// Phone bottom bar: four main sections plus "More", which opens a sheet with
// the rest (Stock, Reports, Settings).
export function MobileNav({ items }: { items: NavItem[] }) {
  const primary = items.filter((n) => PRIMARY.includes(n.to))
  const more = items.filter((n) => !PRIMARY.includes(n.to))
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const moreActive = more.some((n) => isUnder(pathname, n.to))
  const sheetId = useId()
  const titleId = useId()
  const button = useRef<HTMLButtonElement>(null)
  const sheet = useRef<HTMLDivElement>(null)

  // Close when navigation happens (a link in the sheet, or back button).
  useEffect(() => setOpen(false), [pathname])

  useEffect(() => {
    if (!open) return
    const el = sheet.current!
    el.querySelector<HTMLElement>('a')?.focus()
    const trigger = button.current
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        return
      }
      if (e.key !== 'Tab') return
      const links = [...el.querySelectorAll<HTMLElement>('a, button')]
      const first = links[0]
      const last = links[links.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      trigger?.focus()
    }
  }, [open])

  const tab = (active: boolean) => `flex flex-1 flex-col items-center py-2 text-xs ${active ? 'text-brand-700' : 'text-slate-500'}`

  return (
    <>
      {open && (
        <div className="no-print fixed inset-0 z-20 md:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-slate-900/30" aria-hidden="true" />
          <div
            ref={sheet}
            id={sheetId}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-4 pb-[calc(4.5rem+env(safe-area-inset-bottom))] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 id={titleId} className="font-semibold">
                More
              </h2>
              <button type="button" className="btn-ghost px-2 py-1" aria-label="Close menu" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <ul className="mt-2 divide-y divide-slate-100">
              {more.map((n) => (
                <li key={n.to}>
                  <NavLink
                    to={n.to}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) => `flex items-center gap-3 px-2 py-3 text-base ${isActive ? 'font-semibold text-brand-700' : 'text-slate-700'}`}
                  >
                    <span className="w-6 text-center text-lg" aria-hidden="true">
                      {n.icon}
                    </span>
                    {n.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <nav aria-label="Main" className="no-print fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        {primary.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => tab(isActive && !open)}>
            <span className="text-lg leading-none" aria-hidden="true">
              {n.icon}
            </span>
            {n.label}
          </NavLink>
        ))}
        <button
          ref={button}
          type="button"
          className={tab(open || moreActive)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? sheetId : undefined}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="text-lg leading-none" aria-hidden="true">
            ⋯
          </span>
          More
        </button>
      </nav>
    </>
  )
}
