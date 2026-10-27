import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import * as google from '../../auth/google'
import { ClinicDB, db } from '../../db/db'
import { newRecord } from '../../db/repo'
import type { Patient } from '../../db/types'
import { createDriveClient } from '../../sync/drive'
import { LOCK, MANIFEST, SyncEngine } from '../../sync/engine'
import { FakeDrive } from '../../sync/fakeDrive'
import { syncService, OWNER_KEY, type SyncStatus } from '../../sync/service'
import { chipLabel } from './syncLabels'

vi.mock('../../auth/google', async (importOriginal) => {
  const actual = await importOriginal<typeof google>()
  return { ...actual, requestToken: vi.fn(), fetchProfile: vi.fn(), revokeToken: vi.fn() }
})

const PROFILE = { sub: '1', email: 'd@x.com', name: 'D' }
const YEAR = new Date().getFullYear()
let drive: FakeDrive
let others: ClinicDB[] = []

function otherDevice() {
  const d = new ClinicDB(`ui-other-${crypto.randomUUID()}`)
  others.push(d)
  return { d, engine: new SyncEngine({ db: d, drive, deviceId: 'other', deviceName: () => 'Front desk PC', kdfIterations: 1000 }) }
}

function open(path = '/') {
  localStorage.setItem('auth:profile', JSON.stringify(PROFILE))
  window.history.replaceState(null, '', path)
  return render(<App />)
}

beforeEach(() => {
  drive = new FakeDrive()
  syncService.setDriveFactory(() => drive)
  vi.mocked(google.requestToken).mockReset()
  vi.mocked(google.revokeToken).mockReset().mockResolvedValue()
})

afterEach(async () => {
  syncService.stop()
  syncService.setAuth(null)
  syncService.setDriveFactory(null)
  for (const d of others) await d.delete()
  others = []
})

describe('chip labels', () => {
  const base: SyncStatus = { phase: 'idle', pending: 0, blobsPending: 0, lock: null }
  const now = Date.now()
  it.each([
    [{ phase: 'idle', lastSyncAt: now - 120_000 }, 'Synced 2 min ago'],
    [{ phase: 'idle', lastSyncAt: now - 10_000, pending: 2 }, 'Synced just now · 2 pending'],
    [{ phase: 'syncing' }, 'Syncing…'],
    [{ phase: 'offline', pending: 3 }, 'Offline · 3 changes pending'],
    [{ phase: 'offline', pending: 1 }, 'Offline · 1 change pending'],
    [{ phase: 'error', error: 'Drive busy' }, 'Sync error: Drive busy'],
    [{ phase: 'needs-auth' }, 'Sign in to sync'],
    [{ phase: 'disabled' }, 'Sync not set up'],
    [{ phase: 'needs-passphrase' }, 'Sync paused · passphrase needed'],
  ] as [Partial<SyncStatus>, string][])('%o → %s', (patch, label) => {
    expect(chipLabel({ ...base, ...patch }, now)).toBe(label)
  })
})

describe('sync UI', () => {
  it('first device: syncs on start and the chip says Synced', async () => {
    await db.patients.add(newRecord<Patient>({ opNo: `OP-${YEAR}-00001`, name: 'Asha' }))
    open()
    expect(await screen.findByText(/Synced just now/)).toBeInTheDocument()
    expect(drive.byName(MANIFEST)).toHaveLength(1)
    expect(drive.text('data-patients.json')).toContain('Asha')
    expect((await db.kv.get(OWNER_KEY))?.value).toBe('1')
  })

  it('shows offline with pending changes and syncs when back online', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await db.kv.put({ key: OWNER_KEY, value: '1', updatedAt: 1 })
    await db.patients.add(newRecord<Patient>({ opNo: `OP-${YEAR}-00001`, name: 'Asha' }))
    open()
    expect(await screen.findByText('Offline · 1 change pending')).toBeInTheDocument()
    expect(drive.calls).toHaveLength(0)
    online.mockReturnValue(true)
    window.dispatchEvent(new Event('online'))
    expect(await screen.findByText(/Synced just now/)).toBeInTheDocument()
    expect(drive.text('data-patients.json')).toContain('Asha')
  })

  it('restores a fresh device from Drive before showing the app', async () => {
    const a = otherDevice()
    await a.d.patients.add(newRecord<Patient>({ opNo: `OP-${YEAR}-00007`, name: 'Restored Patient' }))
    await a.engine.sync()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    drive.hook = async (op, arg) => {
      if (op === 'download' && arg === drive.byName('data-patients.json')[0]?.id) await gate
    }
    open('/patients')
    expect(await screen.findByTestId('restore-screen')).toHaveTextContent('Restoring your clinic data…')
    release()
    expect((await screen.findAllByText('Restored Patient')).length).toBeGreaterThan(0)
    expect(screen.queryByTestId('restore-screen')).not.toBeInTheDocument()
    // Seeding ran after the restore.
    await waitFor(async () => expect(await db.remedies.count()).toBeGreaterThan(0))
  })

  it('asks for the passphrase on restore when Drive is encrypted, rejecting a wrong one', async () => {
    const a = otherDevice()
    await a.d.patients.add(newRecord<Patient>({ opNo: `OP-${YEAR}-00001`, name: 'Secret Patient' }))
    await a.engine.sync()
    await a.engine.setEncryption('right-passphrase')
    const user = userEvent.setup()
    open('/patients')
    const screenEl = await screen.findByTestId('restore-screen')
    await user.type(await within(screenEl).findByLabelText('Backup passphrase'), 'wrong-passphrase')
    await user.click(within(screenEl).getByRole('button', { name: 'Unlock' }))
    expect(await within(screenEl).findByText('Wrong passphrase')).toBeInTheDocument()
    await user.clear(within(screenEl).getByLabelText('Backup passphrase'))
    await user.type(within(screenEl).getByLabelText('Backup passphrase'), 'right-passphrase')
    await user.click(within(screenEl).getByRole('button', { name: 'Unlock' }))
    expect((await screen.findAllByText('Secret Patient')).length).toBeGreaterThan(0)
  })

  it('shows the lock banner when another device was active recently', async () => {
    await db.kv.put({ key: OWNER_KEY, value: '1', updatedAt: 1 })
    await db.patients.add(newRecord<Patient>({ opNo: `OP-${YEAR}-00001`, name: 'Asha' }))
    await drive.create(LOCK, new TextEncoder().encode(JSON.stringify({ deviceId: 'other', deviceName: 'Front desk PC', since: Date.now() - 60_000, heartbeat: Date.now() - 120_000 })))
    const user = userEvent.setup()
    open()
    const banner = await screen.findByTestId('lock-banner')
    expect(banner).toHaveTextContent("This clinic's data was last used on Front desk PC 2 min ago. Sync now before making changes?")
    await user.click(within(banner).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByTestId('lock-banner')).not.toBeInTheDocument()
  })

  it('does not show the banner for a stale lock', async () => {
    await db.kv.put({ key: OWNER_KEY, value: '1', updatedAt: 1 })
    await db.patients.add(newRecord<Patient>({ opNo: `OP-${YEAR}-00001`, name: 'Asha' }))
    await drive.create(LOCK, new TextEncoder().encode(JSON.stringify({ deviceId: 'other', deviceName: 'Old PC', since: 0, heartbeat: Date.now() - 11 * 60_000 })))
    open()
    expect(await screen.findByText(/Synced just now/)).toBeInTheDocument()
    expect(screen.queryByTestId('lock-banner')).not.toBeInTheDocument()
  })

  it('warns about another account’s data and never merges it', async () => {
    await db.kv.put({ key: OWNER_KEY, value: 'someone-else', updatedAt: 1 })
    await db.patients.add(newRecord<Patient>({ opNo: `OP-${YEAR}-00001`, name: 'Other Account Patient' }))
    const a = otherDevice()
    await a.d.patients.add(newRecord<Patient>({ opNo: `OP-${YEAR}-00001`, name: 'Mine On Drive' }))
    await a.engine.sync()
    const callsBefore = drive.calls.length
    const user = userEvent.setup()
    open('/patients')
    expect(await screen.findByTestId('account-mismatch')).toBeInTheDocument()
    expect(drive.calls.length).toBe(callsBefore)
    // Sync refuses even if asked directly.
    expect(await syncService.syncNow()).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Erase local data and restore from this account' }))
    await user.click(screen.getByRole('button', { name: 'Yes, erase this device' }))
    expect((await screen.findAllByText('Mine On Drive')).length).toBeGreaterThan(0)
    expect(await db.patients.filter((p) => p.name === 'Other Account Patient').count()).toBe(0)
    expect((await db.kv.get(OWNER_KEY))?.value).toBe('1')
  })

  it('cancel on the account warning signs out and keeps the data', async () => {
    await db.kv.put({ key: OWNER_KEY, value: 'someone-else', updatedAt: 1 })
    await db.patients.add(newRecord<Patient>({ opNo: `OP-${YEAR}-00001`, name: 'Keep me' }))
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText(/Google sign-in is not configured/)).toBeInTheDocument()
    expect(await db.patients.count()).toBe(1)
  })

  it('turns on encryption from Settings with validation and the warning', async () => {
    await db.patients.add(newRecord<Patient>({ opNo: `OP-${YEAR}-00001`, name: 'Plain Name' }))
    const user = userEvent.setup()
    open('/settings?tab=data')
    const section = await screen.findByTestId('encryption-section')
    expect(await within(section).findByText('not encrypted')).toBeInTheDocument()
    await user.click(within(section).getByRole('button', { name: 'Turn on encryption' }))
    const form = within(section).getByTestId('passphrase-setup')
    expect(form).toHaveTextContent('If you forget this passphrase, your Drive backup cannot be recovered. Data on this device is not affected.')
    const submit = within(form).getByRole('button', { name: 'Turn on encryption' })

    await user.type(within(form).getByLabelText('Passphrase'), 'short')
    await user.type(within(form).getByLabelText('Repeat passphrase'), 'short')
    await user.click(submit)
    expect(within(form).getByRole('alert')).toHaveTextContent('Use at least 8 characters')

    await user.type(within(form).getByLabelText('Passphrase'), '-and-long')
    await user.click(submit)
    expect(within(form).getByRole('alert')).toHaveTextContent('do not match')

    await user.type(within(form).getByLabelText('Repeat passphrase'), '-and-long')
    await user.click(submit)
    expect(within(form).getByRole('alert')).toHaveTextContent('I understand')

    await user.click(within(form).getByLabelText('I understand'))
    await user.click(submit)
    expect(await within(section).findByText(/Encryption is on/)).toBeInTheDocument()
    expect(within(section).getByTestId('encryption-state')).toHaveTextContent('encrypted')
    expect(JSON.parse(drive.text(MANIFEST)).encrypted).toBe(true)
    expect([...drive.files.values()].map((f) => new TextDecoder().decode(f.data)).join()).not.toContain('Plain Name')

    // Forget key → sync pauses and the passphrase banner appears.
    await user.click(await within(section).findByRole('button', { name: 'Forget key on this device' }))
    expect(await screen.findByTestId('passphrase-banner')).toBeInTheDocument()
  })

  it('needs-auth: the chip offers "Sign in again to sync", which asks Google from the click', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'cid')
    syncService.setDriveFactory((getToken) =>
      createDriveClient({ getToken, fetch: (async () => new Response(JSON.stringify({ files: [] }))) as typeof fetch }),
    )
    vi.mocked(google.requestToken).mockRejectedValue(new Error('popup_failed_to_open'))
    await db.kv.put({ key: OWNER_KEY, value: '1', updatedAt: 1 })
    await db.patients.add(newRecord<Patient>({ opNo: `OP-${YEAR}-00001`, name: 'Asha' }))
    const user = userEvent.setup()
    open()
    const chip = await screen.findByText('Sign in to sync')
    vi.mocked(google.requestToken).mockResolvedValue({ token: 't', expiresAt: Date.now() + 3600_000 })
    await user.click(chip)
    await user.click(within(screen.getByRole('dialog', { name: 'Sync status' })).getByRole('button', { name: 'Sign in again to sync' }))
    expect(google.requestToken).toHaveBeenLastCalledWith({ prompt: '', hint: 'd@x.com' })
    expect(await screen.findByText(/Synced just now/)).toBeInTheDocument()
  })

  it('shows a renumber notice after a duplicate OP number is fixed', async () => {
    const a = otherDevice()
    await a.d.patients.add({ ...newRecord<Patient>({ opNo: `OP-${YEAR}-00001`, name: 'First' }), createdAt: 1, updatedAt: 1 })
    await a.engine.sync()
    await db.kv.put({ key: OWNER_KEY, value: '1', updatedAt: 1 })
    await db.patients.add(newRecord<Patient>({ opNo: `OP-${YEAR}-00001`, name: 'Second' }))
    open()
    const notice = await screen.findByTestId('renumber-notice')
    expect(notice).toHaveTextContent(`Patient OP-${YEAR}-00001 → OP-${YEAR}-00002`)
    expect(await db.patients.count()).toBe(2)
  })
})
