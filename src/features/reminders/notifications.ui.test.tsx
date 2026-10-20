import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { getKV } from '../../db/repo'
import { createStockItem } from '../stock/stockRepo'
import { seedRemedies, seedRemedyId } from '../remedies/remedyRepo'
import { todayISO } from '../../lib/format'
import { NotificationSettings } from './NotificationSettings'
import { notifiedKey, PREFS_KEY } from './reminderLogic'

// A stand-in for window.Notification with a controllable permission.
function mockNotification(permission: NotificationPermission, onRequest: NotificationPermission = permission) {
  const created: { title: string; options?: NotificationOptions }[] = []
  class FakeNotification {
    static permission = permission
    static requestPermission = vi.fn(async () => {
      FakeNotification.permission = onRequest
      return onRequest
    })
    onclick: (() => void) | null = null
    constructor(title: string, options?: NotificationOptions) {
      created.push({ title, options })
    }
    close() {}
  }
  vi.stubGlobal('Notification', FakeNotification)
  return { FakeNotification, created }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const renderSettings = () =>
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <NotificationSettings />
    </MemoryRouter>,
  )

describe('notification settings', () => {
  it('asks for permission from the toggle, saves prefs and sends the first summary', async () => {
    const user = userEvent.setup()
    await seedRemedies()
    await createStockItem({ remedyId: seedRemedyId('Sulphur'), potency: '30C', form: 'dilution', unit: 'ml', lowStockAt: 10, price: 1, openingQty: 1 })
    const { FakeNotification, created } = mockNotification('default', 'granted')
    renderSettings()
    const toggle = await screen.findByRole('checkbox', { name: 'Enable reminder notifications' })
    expect(toggle).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Low stock' })).toBeDisabled()

    await user.click(toggle)
    expect(FakeNotification.requestPermission).toHaveBeenCalled()
    await waitFor(() => expect(toggle).toBeChecked())
    expect(await screen.findByRole('status')).toHaveTextContent('Sent 1 reminder notification.')
    expect(created).toEqual([{ title: 'Low stock', options: expect.objectContaining({ body: '1 stock item low or out', data: { url: '/stock?filter=low' } }) }])
    expect(await getKV(notifiedKey('lowStock', todayISO()))).toBeDefined()
    expect(screen.getByText(/works only when installed on Android\/Chrome/)).toBeInTheDocument()
    expect(screen.getByTestId('periodic-status')).toHaveTextContent('not available')

    // Same day: deduped.
    await user.click(screen.getByRole('button', { name: 'Check now' }))
    expect(await screen.findByText(/Nothing new to notify today/)).toBeInTheDocument()
    expect(created).toHaveLength(1)

    await user.click(screen.getByRole('checkbox', { name: 'Overdue dues' }))
    await waitFor(async () => expect((await getKV<{ types: { dues: boolean } }>(PREFS_KEY))?.types.dues).toBe(false))
    await user.click(toggle)
    await waitFor(async () => expect((await getKV<{ enabled: boolean }>(PREFS_KEY))?.enabled).toBe(false))
  })

  it('explains a denied permission and keeps the toggle off', async () => {
    mockNotification('denied')
    renderSettings()
    expect(await screen.findByTestId('notify-denied')).toHaveTextContent(/blocked for this site/)
    expect(screen.getByRole('checkbox', { name: 'Enable reminder notifications' })).toBeDisabled()
  })

  it('stays off when the user dismisses the prompt', async () => {
    const user = userEvent.setup()
    mockNotification('default', 'denied')
    renderSettings()
    await user.click(await screen.findByRole('checkbox', { name: 'Enable reminder notifications' }))
    expect(await screen.findByTestId('notify-denied')).toBeInTheDocument()
    expect(await getKV(PREFS_KEY)).toBeUndefined()
  })

  it('explains unsupported browsers', async () => {
    vi.stubGlobal('Notification', undefined)
    // jsdom defines it on window; remove it entirely for this case.
    delete (window as { Notification?: unknown }).Notification
    renderSettings()
    expect(await screen.findByTestId('notify-unsupported')).toHaveTextContent(/does not support notifications/)
  })
})
