import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requestToken } from './google'

type Cfg = { callback: (r: object) => void; error_callback: (e: { type: string }) => void }

let cfg: Cfg
const requestAccessToken = vi.fn()

beforeEach(() => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'cid')
  requestAccessToken.mockReset()
  window.google = {
    accounts: {
      oauth2: {
        initTokenClient: ((c: Cfg) => {
          cfg = c
          return { requestAccessToken }
        }) as never,
        revoke: vi.fn(),
      },
    },
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  delete window.google
})

describe('requestToken', () => {
  it('requests the token synchronously when GIS is already loaded', () => {
    void requestToken({ prompt: 'select_account' })
    expect(requestAccessToken).toHaveBeenCalledWith({ prompt: 'select_account', login_hint: undefined })
  })

  it('maps GIS popup errors to friendly messages', async () => {
    const blocked = requestToken()
    cfg.error_callback({ type: 'popup_failed_to_open' })
    await expect(blocked).rejects.toThrow('Your browser blocked the Google sign-in pop-up. Allow pop-ups for this site and try again.')

    const closed = requestToken()
    cfg.error_callback({ type: 'popup_closed' })
    await expect(closed).rejects.toThrow('Sign-in was cancelled.')
  })

  it('rejects when the popup is ignored for two minutes', async () => {
    vi.useFakeTimers()
    const p = requestToken()
    const assertion = expect(p).rejects.toThrow(/timed out/)
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
    await assertion
  })
})
