import { Suspense, useState, type ReactNode } from 'react'
import { createBrowserRouter, createRoutesFromElements, Navigate, Outlet, Route, RouterProvider, useLocation } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { useAuth } from './auth/useAuth'
import { Layout } from './app/Layout'
import { SignIn } from './app/SignIn'
import { ErrorBoundary, RouteError } from './app/ErrorBoundary'
import { PageLoading } from './app/PageLoading'
import { lazyPage } from './app/lazyPage'
import { Dashboard } from './features/dashboard/Dashboard'
import { SyncGate } from './features/sync/SyncGate'

// Only the dashboard (first paint) is in the main chunk; every other route
// is its own chunk. All chunks are precached by the service worker.
const PatientList = lazyPage(() => import('./features/patients/PatientList'), 'PatientList')
const PatientForm = lazyPage(() => import('./features/patients/PatientForm'), 'PatientForm')
const PatientProfile = lazyPage(() => import('./features/patients/PatientProfile'), 'PatientProfile')
const VisitForm = lazyPage(() => import('./features/visits/VisitForm'), 'VisitForm')
const Settings = lazyPage(() => import('./features/settings/Settings'), 'Settings')
// FullCalendar is heavy; only CalendarPage imports it.
const CalendarPage = lazyPage(() => import('./features/appointments/CalendarPage'), 'default')
const BillingPage = lazyPage(() => import('./features/billing/BillingPage'), 'BillingPage')
const StockPage = lazyPage(() => import('./features/stock/StockPage'), 'StockPage')
// Recharts and the report builders load with the reports chunk only.
const ReportsPage = lazyPage(() => import('./features/reports/ReportsPage'), 'ReportsPage')
const PrintRx = lazyPage(() => import('./print/PrintRx'), 'PrintRx')
const PrintOpSlip = lazyPage(() => import('./print/PrintOpSlip'), 'PrintOpSlip')
const PrintReceipt = lazyPage(() => import('./print/PrintReceipt'), 'PrintReceipt')
const PrintBill = lazyPage(() => import('./print/PrintBill'), 'PrintBill')
const PrintReport = lazyPage(() => import('./print/PrintReport'), 'default')
// Dev-only demo data; the DEV check lets production builds drop the chunk.
const SeedPage = import.meta.env.DEV ? lazyPage(() => import('./dev/SeedPage'), 'default') : null

// Signed out → sign-in screen; signed in → the owner/restore gate, then routes.
function Root() {
  const { profile } = useAuth()
  if (!profile) return <SignIn />
  return (
    // Keyed by account so switching accounts re-runs the owner check.
    <SyncGate key={profile.sub}>
      <Outlet />
    </SyncGate>
  )
}

// Error boundary + suspense for a standalone (print) route.
function Page({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  return (
    <ErrorBoundary resetKey={pathname}>
      <Suspense fallback={<PageLoading />}>{children}</Suspense>
    </ErrorBoundary>
  )
}

const routes = createRoutesFromElements(
  <Route element={<Root />} errorElement={<RouteError />}>
    {/* Print views render without the app chrome. */}
    <Route path="print/rx/:visitId" element={<Page><PrintRx /></Page>} />
    <Route path="print/op-slip/:patientId" element={<Page><PrintOpSlip /></Page>} />
    <Route path="print/receipt/:paymentId" element={<Page><PrintReceipt /></Page>} />
    <Route path="print/bill/:billId" element={<Page><PrintBill /></Page>} />
    <Route path="print/report/:type" element={<Page><PrintReport /></Page>} />
    {/* Layout wraps its outlet in the same error boundary and suspense. */}
    <Route element={<Layout />}>
      <Route index element={<Dashboard />} />
      <Route path="patients" element={<PatientList />} />
      <Route path="patients/new" element={<PatientForm />} />
      <Route path="patients/:id" element={<PatientProfile />} />
      <Route path="patients/:id/edit" element={<PatientForm />} />
      <Route path="patients/:id/visits/new" element={<VisitForm />} />
      <Route path="patients/:id/visits/:visitId" element={<VisitForm />} />
      <Route path="calendar" element={<CalendarPage />} />
      <Route path="billing" element={<BillingPage view="bills" />} />
      <Route path="billing/dues" element={<BillingPage view="dues" />} />
      <Route path="stock/*" element={<StockPage />} />
      <Route path="reports" element={<ReportsPage />} />
      {SeedPage && <Route path="dev/seed" element={<SeedPage />} />}
      <Route path="settings" element={<Settings />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>
  </Route>,
)

const FUTURE = {
  v7_relativeSplatPath: true,
  v7_fetcherPersist: true,
  v7_normalizeFormMethod: true,
  v7_partialHydration: true,
  v7_skipActionErrorRevalidation: true,
} as const

// Router paths stay '/patients' etc.; the deploy base ('/clinic-register/' on
// GitHub Pages) is prefixed by the router.
const BASENAME = import.meta.env.BASE_URL.replace(/\/$/, '') || '/'

export default function App() {
  // A data router (needed for useBlocker), created once per mount so tests
  // start at the current URL.
  const [router] = useState(() => createBrowserRouter(routes, { future: FUTURE, basename: BASENAME }))
  return (
    <AuthProvider>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </AuthProvider>
  )
}
