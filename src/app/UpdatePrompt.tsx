import { useRegisterSW } from 'virtual:pwa-register/react'

// Shows a banner when a new app version has been downloaded, so an update
// never reloads the page mid-consultation without the user's say.
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh && !offlineReady) return null

  return (
    <aside aria-label="App update" className="no-print fixed bottom-20 right-4 z-20 max-w-sm rounded-lg border border-slate-200 bg-white p-4 shadow-lg md:bottom-4">
      <p className="text-sm" role="status">
        {needRefresh ? 'A new version is available.' : 'App is ready to work offline.'}
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <button
          className="btn-ghost"
          onClick={() => {
            setNeedRefresh(false)
            setOfflineReady(false)
          }}
        >
          Close
        </button>
        {needRefresh && (
          <button className="btn-primary" onClick={() => updateServiceWorker(true)}>
            Update
          </button>
        )}
      </div>
    </aside>
  )
}
