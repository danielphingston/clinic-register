import { DriveError, type DriveClient, type DriveFile } from './types'

// Google Drive REST v3 client limited to the hidden appDataFolder.
// Base URLs can be pointed at scripts/mock-drive.mjs for E2E testing.

export const DEFAULT_API_BASE = 'https://www.googleapis.com/drive/v3'
export const DEFAULT_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3'
const FIELDS = 'id,name,version,modifiedTime,createdTime,size'
const RETRY_STATUS = new Set([429, 500, 502, 503, 504])

export interface DriveClientOptions {
  // Returns an access token; `refresh` forces a new one after a 401.
  getToken(refresh?: boolean): Promise<string>
  apiBase?: string
  uploadBase?: string
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  maxRetries?: number
}

export function driveBases(): { apiBase: string; uploadBase: string } {
  return {
    apiBase: import.meta.env.VITE_DRIVE_API_BASE || DEFAULT_API_BASE,
    uploadBase: import.meta.env.VITE_DRIVE_UPLOAD_BASE || DEFAULT_UPLOAD_BASE,
  }
}

// True when the Drive API is the local mock server. Only then may the app
// skip Google sign-in for sync (E2E). It can never be true against
// googleapis.com: the base URL must be an explicit localhost override.
export function isMockDrive(apiBase = import.meta.env.VITE_DRIVE_API_BASE): boolean {
  if (!apiBase) return false
  try {
    const host = new URL(apiBase).hostname
    return host === 'localhost' || host === '127.0.0.1'
  } catch {
    return false
  }
}

function escapeQ(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

export function createDriveClient(opts: DriveClientOptions): DriveClient {
  const api = (opts.apiBase ?? DEFAULT_API_BASE).replace(/\/$/, '')
  const upload = (opts.uploadBase ?? DEFAULT_UPLOAD_BASE).replace(/\/$/, '')
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const maxRetries = opts.maxRetries ?? 4

  async function request(url: string, init: RequestInit = {}): Promise<Response> {
    let refreshed = false
    let token = await opts.getToken()
    for (let attempt = 0; ; attempt++) {
      let res: Response
      try {
        res = await doFetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } })
      } catch (e) {
        // Network blip: retry like a 503.
        if (attempt >= maxRetries) throw new DriveError(0, `Network error: ${e instanceof Error ? e.message : String(e)}`)
        await sleep(backoff(attempt))
        continue
      }
      if (res.ok) return res
      if (res.status === 401 && !refreshed) {
        refreshed = true
        token = await opts.getToken(true)
        attempt--
        continue
      }
      const body = await res.text().catch(() => '')
      const rateLimited = res.status === 403 && /rateLimitExceeded|userRateLimitExceeded/.test(body)
      if ((RETRY_STATUS.has(res.status) || rateLimited) && attempt < maxRetries) {
        await sleep(backoff(attempt))
        continue
      }
      throw new DriveError(res.status, driveMessage(res.status, body))
    }
  }

  async function json<T>(url: string, init?: RequestInit): Promise<T> {
    return (await request(url, init)).json() as Promise<T>
  }

  return {
    async list({ name } = {}) {
      const files: DriveFile[] = []
      let pageToken: string | undefined
      do {
        const p = new URLSearchParams({
          spaces: 'appDataFolder',
          fields: `nextPageToken,files(${FIELDS})`,
          pageSize: '1000',
        })
        if (name) p.set('q', `name = '${escapeQ(name)}' and trashed = false`)
        else p.set('q', 'trashed = false')
        if (pageToken) p.set('pageToken', pageToken)
        const page = await json<{ files?: DriveFile[]; nextPageToken?: string }>(`${api}/files?${p}`)
        files.push(...(page.files ?? []))
        pageToken = page.nextPageToken
      } while (pageToken)
      return files
    },

    getMeta(id) {
      return json<DriveFile>(`${api}/files/${encodeURIComponent(id)}?fields=${FIELDS}`)
    },

    async download(id) {
      const res = await request(`${api}/files/${encodeURIComponent(id)}?alt=media`)
      return new Uint8Array(await res.arrayBuffer())
    },

    create(name, data, mimeType = 'application/octet-stream') {
      const boundary = `clinicreg${crypto.randomUUID().replace(/-/g, '')}`
      const meta = JSON.stringify({ name, parents: ['appDataFolder'], mimeType })
      const body = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`,
        `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
        data as Uint8Array<ArrayBuffer>,
        `\r\n--${boundary}--\r\n`,
      ])
      return json<DriveFile>(`${upload}/files?uploadType=multipart&fields=${FIELDS}`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      })
    },

    update(id, data, mimeType = 'application/octet-stream') {
      return json<DriveFile>(`${upload}/files/${encodeURIComponent(id)}?uploadType=media&fields=${FIELDS}`, {
        method: 'PATCH',
        headers: { 'Content-Type': mimeType },
        body: new Blob([data as Uint8Array<ArrayBuffer>]),
      })
    },

    async remove(id) {
      try {
        await request(`${api}/files/${encodeURIComponent(id)}`, { method: 'DELETE' })
      } catch (e) {
        if (e instanceof DriveError && e.status === 404) return
        throw e
      }
    },
  }
}

function backoff(attempt: number): number {
  return Math.min(16_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250)
}

function driveMessage(status: number, body: string): string {
  try {
    const msg = (JSON.parse(body) as { error?: { message?: string } }).error?.message
    if (msg) return `Drive ${status}: ${msg}`
  } catch {
    /* not JSON */
  }
  if (status === 401) return 'Google sign-in expired'
  if (status === 403) return 'Drive access denied'
  if (status === 404) return 'File not found on Drive'
  return `Drive error ${status}`
}
