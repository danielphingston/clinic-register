import { Suspense } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { RemindersBell } from '../features/reminders/RemindersBell'
import { useReminderScheduler } from '../features/reminders/useReminderScheduler'
import { MobileNav } from './MobileNav'
import { SyncChip } from '../features/sync/SyncChip'
import { SyncBanners } from '../features/sync/SyncBanners'
import { UpdatePrompt } from './UpdatePrompt'
import { ErrorBoundary } from './ErrorBoundary'
import { PageLoading } from './PageLoading'

const NAV = [
  { to: '/', label: 'Dashboard', icon: '▦' },
  { to: '/patients', label: 'Patients', icon: '☺' },
  { to: '/calendar', label: 'Calendar', icon: '▤' },
  { to: '/billing', label: 'Billing', icon: '₹' },
  { to: '/stock', label: 'Stock', icon: '⚗' },
  { to: '/reports', label: 'Reports', icon: '▥' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
]

function navClass({ isActive }: { isActive: boolean }) {
  return `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${
    isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
  }`
}

export function Layout() {
  const { profile } = useAuth()
  const { pathname } = useLocation()
  useReminderScheduler()

  return (
    <div className="flex min-h-screen">
      <aside aria-label="Sidebar" className="no-print hidden w-56 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="px-4 py-5 text-lg font-semibold text-brand-700">Clinic Register</div>
        <nav className="flex flex-1 flex-col gap-1 px-2">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={navClass}>
              <span className="w-5 text-center">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        {profile && (
          <div className="flex items-center gap-2 border-t border-slate-200 p-3 text-xs text-slate-600">
            {profile.picture && <img src={profile.picture} alt="" className="h-7 w-7 rounded-full" />}
            <span className="truncate">{profile.email}</span>
          </div>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur">
          <span className="font-semibold text-brand-700 md:hidden">Clinic Register</span>
          <span className="hidden md:block" />
          <div className="flex items-center gap-2">
            <RemindersBell />
            <SyncChip />
          </div>
        </header>

        <main className="flex-1 p-4 pb-24 md:p-6 md:pb-6">
          <SyncBanners />
          <ErrorBoundary resetKey={pathname}>
            <Suspense fallback={<PageLoading />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>

      <MobileNav items={NAV} />

      <UpdatePrompt />
    </div>
  )
}
