import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { checkReminders, NAVIGATE_EVENT } from './notifications'

const HOUR = 60 * 60 * 1000

// Checks reminders when the app opens and hourly while it stays open, and
// follows notification clicks (relayed by the service worker) to their page.
export function useReminderScheduler() {
  const navigate = useNavigate()

  useEffect(() => {
    const run = () => {
      checkReminders().catch(() => {})
    }
    run()
    const timer = window.setInterval(run, HOUR)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const go = (url: unknown) => {
      if (typeof url === 'string' && url.startsWith('/')) navigate(url)
    }
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'navigate') go(e.data.url)
    }
    const onEvent = (e: Event) => go((e as CustomEvent).detail)
    const sw = 'serviceWorker' in navigator ? navigator.serviceWorker : undefined
    sw?.addEventListener('message', onMessage)
    window.addEventListener(NAVIGATE_EVENT, onEvent)
    return () => {
      sw?.removeEventListener('message', onMessage)
      window.removeEventListener(NAVIGATE_EVENT, onEvent)
    }
  }, [navigate])
}
