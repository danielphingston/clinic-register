import { useEffect, useState } from 'react'
import { checkReminders, getNotifyPrefs, notificationSupport, saveNotifyPrefs, setPeriodicSync, type NotifySupport } from './notifications'
import { REMINDER_LABEL, REMINDER_TYPES, type NotifyPrefs, type ReminderType } from './reminderLogic'

const PERIODIC_TEXT: Record<string, string> = {
  registered: 'Daily background check is on.',
  denied: 'Background checks are not allowed for this site (install the app first).',
  unsupported: 'Background checks are not available on this device.',
  off: 'Background check is off.',
}

export function NotificationSettings() {
  const [prefs, setPrefs] = useState<NotifyPrefs | null>(null)
  const [support, setSupport] = useState<NotifySupport>(notificationSupport)
  const [periodic, setPeriodic] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    getNotifyPrefs().then(setPrefs)
  }, [])

  // Arriving from the bell's "Notification settings" link.
  useEffect(() => {
    if (prefs && window.location.hash === '#notifications') document.getElementById('notifications')?.scrollIntoView()
  }, [prefs])

  if (!prefs) return null

  async function save(next: NotifyPrefs) {
    setPrefs(next)
    await saveNotifyPrefs(next)
  }

  async function toggle(on: boolean) {
    setStatus('')
    if (!on) {
      await save({ ...prefs!, enabled: false })
      setPeriodic(await setPeriodicSync(false))
      return
    }
    // Must run straight from the click: browsers only show the permission
    // prompt in response to a user gesture.
    let perm = notificationSupport()
    if (perm === 'default') perm = await Notification.requestPermission()
    setSupport(perm)
    if (perm !== 'granted') return
    await save({ ...prefs!, enabled: true })
    setPeriodic(await setPeriodicSync(true))
    const shown = await checkReminders()
    setStatus(shown.length ? `Sent ${shown.length} reminder notification${shown.length === 1 ? '' : 's'}.` : 'Notifications are on.')
  }

  async function checkNow() {
    const shown = await checkReminders()
    setStatus(shown.length ? `Sent ${shown.length} reminder notification${shown.length === 1 ? '' : 's'}.` : 'Nothing new to notify today (each kind is sent at most once a day).')
  }

  const enabled = prefs.enabled && support === 'granted'

  return (
    <section id="notifications" className="card mt-4 space-y-3" aria-labelledby="notify-heading">
      <h2 id="notify-heading" className="font-semibold">
        Notifications
      </h2>
      <p className="text-sm text-slate-500">
        A daily summary of today's appointments, follow-ups due, overdue dues and low stock. Checked when the app opens and every hour while it is
        open; each kind is notified at most once a day. This setting applies to this device only.
      </p>

      {support === 'unsupported' ? (
        <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-700" data-testid="notify-unsupported">
          This browser does not support notifications. On iPhone, add the app to the Home Screen first. Reminders still appear under the bell icon.
        </p>
      ) : (
        <>
          {support === 'denied' && (
            <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900" data-testid="notify-denied">
              Notifications are blocked for this site. To turn them on, allow notifications in the browser's site settings (the icon next to the address),
              then reload. Reminders still appear under the bell icon.
            </p>
          )}
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={enabled} disabled={support === 'denied'} onChange={(e) => toggle(e.target.checked)} />
            Enable reminder notifications
          </label>

          <fieldset className="space-y-1" disabled={!enabled}>
            <legend className="label">Notify me about</legend>
            {REMINDER_TYPES.map((t: ReminderType) => (
              <label key={t} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={prefs.types[t]} onChange={(e) => save({ ...prefs, types: { ...prefs.types, [t]: e.target.checked } })} />
                {REMINDER_LABEL[t]}
              </label>
            ))}
          </fieldset>

          <fieldset className="flex flex-wrap items-end gap-3" disabled={!enabled}>
            <legend className="label">Quiet hours (optional)</legend>
            <div>
              <label className="text-xs text-slate-600" htmlFor="quiet-start">
                From
              </label>
              <input id="quiet-start" type="time" className="input w-auto" value={prefs.quietStart} onChange={(e) => save({ ...prefs, quietStart: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-slate-600" htmlFor="quiet-end">
                To
              </label>
              <input id="quiet-end" type="time" className="input w-auto" value={prefs.quietEnd} onChange={(e) => save({ ...prefs, quietEnd: e.target.value })} />
            </div>
            {(prefs.quietStart || prefs.quietEnd) && (
              <button type="button" className="btn-ghost" onClick={() => save({ ...prefs, quietStart: '', quietEnd: '' })}>
                Clear
              </button>
            )}
          </fieldset>

          {enabled && (
            <button type="button" className="btn-ghost border border-slate-300" onClick={checkNow}>
              Check now
            </button>
          )}
          {status && (
            <p className="text-sm text-brand-700" role="status">
              {status}
            </p>
          )}
          <p className="text-xs text-slate-500">
            Background reminders: works only when installed on Android/Chrome; on other devices reminders show when the app is open.
          </p>
          {periodic && (
            <p className="text-xs text-slate-500" data-testid="periodic-status">
              {PERIODIC_TEXT[periodic]}
            </p>
          )}
        </>
      )}
    </section>
  )
}
