import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useRouteError } from 'react-router-dom'
import { isChunkLoadError } from './lazyPage'

interface Props {
  children: ReactNode
  // Changing it (e.g. the route path) clears the error.
  resetKey?: string
}

interface State {
  error: Error | null
  stack?: string
}

// Route-level error screen. It only offers a reload or a way back; it never
// touches stored data.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Page crashed', error)
    this.setState({ stack: info.componentStack ?? undefined })
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null, stack: undefined })
  }

  render() {
    const { error, stack } = this.state
    if (!error) return this.props.children
    return <ErrorScreen error={error} stack={stack} />
  }
}

// Errors that escape the page boundary (e.g. in the layout itself).
export function RouteError() {
  const e = useRouteError()
  const error = e instanceof Error ? e : new Error(typeof e === 'object' && e && 'statusText' in e ? String(e.statusText) : String(e))
  return (
    <div className="p-4">
      <ErrorScreen error={error} stack={error.stack} />
    </div>
  )
}

function ErrorScreen({ error, stack }: { error: Error; stack?: string }) {
  const chunk = isChunkLoadError(error)
  return (
    <div role="alert" className="card mx-auto max-w-lg space-y-3" data-testid="error-boundary">
      <h1 className="text-lg font-semibold">{chunk ? 'A newer version is available' : 'Something went wrong'}</h1>
      <p className="text-sm text-slate-600">
        {chunk
          ? "This page couldn't load, probably because the app was updated. Reload to get the latest version."
          : 'This page hit an unexpected error. Your saved data is safe on this device.'}
      </p>
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" onClick={() => void reloadApp(chunk)}>
          Reload
        </button>
        <a href={import.meta.env.BASE_URL} className="btn-ghost border border-slate-300">
          Go to dashboard
        </a>
      </div>
      <details className="text-xs text-slate-500">
        <summary className="cursor-pointer">Error details</summary>
        <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words">
          {error.name}: {error.message}
          {stack}
        </pre>
      </details>
    </div>
  )
}

// After a deploy, the new build sits in a waiting (or still installing)
// service worker: fetch it, activate it, then reload so the chunks match.
async function reloadApp(activateUpdate: boolean) {
  const within = (p: Promise<unknown>, ms: number) => Promise.race([p, new Promise((r) => setTimeout(r, ms))])
  try {
    if (activateUpdate && 'serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration()
      if (reg) {
        await within(reg.update(), 5000).catch(() => {})
        const installing = reg.installing
        if (installing) {
          await within(new Promise<void>((r) => installing.addEventListener('statechange', () => installing.state !== 'installing' && r())), 10_000)
        }
        if (reg.waiting) {
          const changed = new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }))
          reg.waiting.postMessage({ type: 'SKIP_WAITING' })
          await within(changed, 3000)
        }
      }
    }
  } finally {
    window.location.reload()
  }
}
