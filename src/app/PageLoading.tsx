// Suspense fallback for lazy routes: a quiet placeholder that only shows if
// loading takes a moment (chunks are usually served from the SW cache).
export function PageLoading() {
  return (
    <div role="status" aria-live="polite" className="animate-fade-in-delayed flex items-center gap-2 py-8 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" aria-hidden="true" />
      Loading…
    </div>
  )
}
