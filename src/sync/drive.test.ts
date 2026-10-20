import { describe, expect, it, vi } from 'vitest'
import { createDriveClient, DEFAULT_API_BASE, DEFAULT_UPLOAD_BASE, isMockDrive } from './drive'
import { DriveError } from './types'

interface Call {
  url: string
  init: RequestInit & { headers: Record<string, string> }
}

function mockFetch(responses: (Response | Error)[]) {
  const calls: Call[] = []
  const fn = vi.fn(async (url: string, init: Call['init']) => {
    calls.push({ url, init })
    const r = responses.shift()
    if (!r) throw new Error('no more responses')
    if (r instanceof Error) throw r
    return r
  })
  return { fetch: fn as unknown as typeof fetch, calls }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function client(responses: (Response | Error)[], getToken = vi.fn(async (refresh?: boolean) => (refresh ? 'fresh' : 'tok'))) {
  const f = mockFetch(responses)
  const sleep = vi.fn(async () => {})
  return { drive: createDriveClient({ getToken, fetch: f.fetch, sleep }), ...f, getToken, sleep }
}

describe('Drive REST client', () => {
  it('lists appDataFolder with pagination and bearer auth', async () => {
    const { drive, calls } = client([
      json({ files: [{ id: '1', name: 'a' }], nextPageToken: 'p2' }),
      json({ files: [{ id: '2', name: 'b' }] }),
    ])
    const files = await drive.list()
    expect(files.map((f) => f.id)).toEqual(['1', '2'])
    const u1 = new URL(calls[0].url)
    expect(`${u1.origin}${u1.pathname}`).toBe(`${DEFAULT_API_BASE}/files`)
    expect(u1.searchParams.get('spaces')).toBe('appDataFolder')
    expect(u1.searchParams.get('fields')).toContain('nextPageToken')
    expect(u1.searchParams.get('fields')).toContain('version')
    expect(u1.searchParams.get('pageToken')).toBeNull()
    expect(new URL(calls[1].url).searchParams.get('pageToken')).toBe('p2')
    expect(calls[0].init.headers.Authorization).toBe('Bearer tok')
  })

  it('filters by name with an escaped query', async () => {
    const { drive, calls } = client([json({ files: [] })])
    await drive.list({ name: "it's.json" })
    expect(new URL(calls[0].url).searchParams.get('q')).toBe("name = 'it\\'s.json' and trashed = false")
  })

  it('creates with a multipart/related body: JSON metadata in appDataFolder, then the bytes', async () => {
    const { drive, calls } = client([json({ id: 'new', name: 'blob-x', version: '1' })])
    const bytes = new Uint8Array([0, 1, 2, 255])
    const f = await drive.create('blob-x', bytes)
    expect(f.id).toBe('new')
    const { url, init } = calls[0]
    expect(url).toContain(`${DEFAULT_UPLOAD_BASE}/files?uploadType=multipart`)
    expect(init.method).toBe('POST')
    const boundary = /boundary=(\S+)/.exec(init.headers['Content-Type'])![1]
    expect(init.headers['Content-Type']).toMatch(/^multipart\/related; boundary=/)
    const body = new Uint8Array(await (init.body as Blob).arrayBuffer())
    const text = new TextDecoder('latin1').decode(body)
    const parts = text.split(`--${boundary}`)
    expect(parts).toHaveLength(4) // preamble, meta, media, closing "--"
    expect(parts[1]).toContain('Content-Type: application/json')
    const meta = JSON.parse(parts[1].split('\r\n\r\n')[1])
    expect(meta).toEqual({ name: 'blob-x', parents: ['appDataFolder'], mimeType: 'application/octet-stream' })
    expect(parts[2]).toContain('Content-Type: application/octet-stream')
    const media = parts[2].split('\r\n\r\n')[1].replace(/\r\n$/, '')
    expect([...media].map((c) => c.charCodeAt(0))).toEqual([0, 1, 2, 255])
    expect(parts[3].trim()).toBe('--')
  })

  it('updates file content with PATCH uploadType=media', async () => {
    const { drive, calls } = client([json({ id: 'm', name: 'manifest.json', version: '7' })])
    await drive.update('m', new TextEncoder().encode('{}'), 'application/json')
    expect(calls[0].url).toContain(`${DEFAULT_UPLOAD_BASE}/files/m?uploadType=media`)
    expect(calls[0].init.method).toBe('PATCH')
    expect(calls[0].init.headers['Content-Type']).toBe('application/json')
  })

  it('reads version metadata and downloads with alt=media', async () => {
    const { drive, calls } = client([json({ id: 'm', version: '12' }), new Response(new Uint8Array([9, 8]))])
    expect((await drive.getMeta('m')).version).toBe('12')
    expect(new URL(calls[0].url).searchParams.get('fields')).toContain('version')
    expect(await drive.download('m')).toEqual(new Uint8Array([9, 8]))
    expect(calls[1].url).toBe(`${DEFAULT_API_BASE}/files/m?alt=media`)
  })

  it('on 401 refreshes the token once and retries', async () => {
    const { drive, calls, getToken } = client([new Response('', { status: 401 }), json({ files: [] })])
    await drive.list()
    expect(getToken).toHaveBeenLastCalledWith(true)
    expect(calls[1].init.headers.Authorization).toBe('Bearer fresh')
  })

  it('gives up after a second 401', async () => {
    const { drive } = client([new Response('', { status: 401 }), new Response('', { status: 401 })])
    await expect(drive.list()).rejects.toMatchObject({ status: 401 })
  })

  it('retries 429/5xx and network errors with exponential backoff', async () => {
    const { drive, sleep } = client([
      new Response('', { status: 503 }),
      new Response('', { status: 429 }),
      new TypeError('Failed to fetch'),
      json({ files: [{ id: 'ok', name: 'x' }] }),
    ])
    expect(await drive.list()).toHaveLength(1)
    const waits = sleep.mock.calls.map((c) => (c as unknown as [number])[0])
    expect(waits).toHaveLength(3)
    expect(waits[1]).toBeGreaterThan(waits[0])
    expect(waits[2]).toBeGreaterThan(waits[1])
  })

  it('stops retrying after a few 5xx and reports the Drive error', async () => {
    const r = () => json({ error: { message: 'Backend Error' } }, 500)
    const { drive } = client([r(), r(), r(), r(), r()])
    const err = await drive.list().catch((e) => e)
    expect(err).toBeInstanceOf(DriveError)
    expect(err.message).toContain('Backend Error')
  })

  it('does not retry other 4xx errors', async () => {
    const { drive, sleep } = client([new Response('', { status: 400 })])
    await expect(drive.getMeta('x')).rejects.toMatchObject({ status: 400 })
    expect(sleep).not.toHaveBeenCalled()
  })

  it('treats deleting a missing file as done', async () => {
    const { drive, calls } = client([new Response('', { status: 404 })])
    await drive.remove('gone')
    expect(calls[0].init.method).toBe('DELETE')
  })

  it('only bypasses Google when the API base is localhost', () => {
    expect(isMockDrive(undefined)).toBe(false)
    expect(isMockDrive('https://www.googleapis.com/drive/v3')).toBe(false)
    expect(isMockDrive('https://localhost.evil.com/drive/v3')).toBe(false)
    expect(isMockDrive('http://localhost:4180/drive/v3')).toBe(true)
    expect(isMockDrive('http://127.0.0.1:4180/drive/v3')).toBe(true)
  })
})
