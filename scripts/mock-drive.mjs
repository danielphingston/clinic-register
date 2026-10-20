#!/usr/bin/env node
// Dev/E2E only: a tiny stand-in for the Google Drive v3 endpoints the app's
// Drive client uses (appDataFolder only). Never bundled into the app.
//
//   node scripts/mock-drive.mjs [--port 4180] [--dir /tmp/mock-drive]
//
// Build the app against it with
//   VITE_DRIVE_API_BASE=http://localhost:4180/drive/v3
//   VITE_DRIVE_UPLOAD_BASE=http://localhost:4180/upload/drive/v3
// (a localhost API base also lets the app skip Google sign-in for sync).
//
// With --dir every file is mirrored to <dir>/<name>__<id> so tests can grep
// the stored bytes. Admin endpoints for tests:
//   GET  /__admin/files            JSON list (id, name, version, size)
//   GET  /__admin/file?name=x      raw bytes of the newest file with that name
//   POST /__admin/fail?status=503&count=2   fail the next N API calls
//   POST /__admin/reset            delete everything

import { createServer } from 'node:http'
import { mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const args = process.argv.slice(2)
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : def
}
const PORT = Number(arg('port', process.env.MOCK_DRIVE_PORT ?? 4180))
const DIR = arg('dir', process.env.MOCK_DRIVE_DIR)
const PAGE_SIZE = Number(arg('page-size', 100))

const files = new Map()
let failNext = { count: 0, status: 503 }

if (DIR) {
  mkdirSync(DIR, { recursive: true })
  for (const f of readdirSync(DIR)) rmSync(join(DIR, f))
}

const meta = (f) => ({
  kind: 'drive#file',
  id: f.id,
  name: f.name,
  mimeType: f.mimeType,
  version: String(f.version),
  createdTime: f.createdTime,
  modifiedTime: f.modifiedTime,
  size: String(f.data.length),
})

function mirror(f, removed = false) {
  if (!DIR) return
  const path = join(DIR, `${f.name}__${f.id}`)
  if (removed) rmSync(path, { force: true })
  else writeFileSync(path, f.data)
}

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body)
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'Content-Type',
    ...(body === undefined ? {} : { 'Content-Type': isBuf ? 'application/octet-stream' : 'application/json' }),
    ...headers,
  })
  res.end(body === undefined ? undefined : isBuf ? body : JSON.stringify(body))
}

const err = (res, status, message) => send(res, status, { error: { code: status, message } })

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return Buffer.concat(chunks)
}

function parseMultipart(body, contentType) {
  const m = /boundary=([^;]+)/.exec(contentType ?? '')
  if (!m) throw new Error('missing boundary')
  const delim = Buffer.from(`--${m[1]}`)
  const parts = []
  let pos = body.indexOf(delim)
  while (pos !== -1) {
    const start = pos + delim.length
    if (body.slice(start, start + 2).toString() === '--') break
    const next = body.indexOf(delim, start)
    if (next === -1) break
    // part = \r\n headers \r\n\r\n content \r\n
    const part = body.slice(start + 2, next - 2)
    const sep = part.indexOf('\r\n\r\n')
    parts.push({ headers: part.slice(0, sep).toString(), content: part.slice(sep + 4) })
    pos = next
  }
  return parts
}

function nameFilter(q) {
  if (!q) return null
  const m = /name\s*=\s*'((?:[^'\\]|\\.)*)'/.exec(q)
  return m ? m[1].replace(/\\(.)/g, '$1') : null
}

const now = () => new Date().toISOString()

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const path = url.pathname
  if (req.method === 'OPTIONS') {
    return send(res, 204, undefined, {
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '600',
    })
  }

  // ---- admin ----
  if (path === '/__admin/files') {
    return send(res, 200, [...files.values()].map(meta))
  }
  if (path === '/__admin/file') {
    const name = url.searchParams.get('name')
    const f = [...files.values()].filter((x) => x.name === name).sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime))[0]
    return f ? send(res, 200, f.data) : err(res, 404, 'not found')
  }
  if (path === '/__admin/fail' && req.method === 'POST') {
    failNext = { count: Number(url.searchParams.get('count') ?? 1), status: Number(url.searchParams.get('status') ?? 503) }
    return send(res, 200, failNext)
  }
  if (path === '/__admin/reset' && req.method === 'POST') {
    for (const f of files.values()) mirror(f, true)
    files.clear()
    return send(res, 200, { ok: true })
  }

  // ---- Drive API ----
  if (!/^Bearer \S+/.test(req.headers.authorization ?? '')) return err(res, 401, 'Request had invalid authentication credentials.')
  if (failNext.count > 0) {
    failNext.count--
    return err(res, failNext.status, 'Injected failure')
  }

  try {
    if (path === '/drive/v3/files' && req.method === 'GET') {
      if (url.searchParams.get('spaces') !== 'appDataFolder') return err(res, 400, 'spaces=appDataFolder required')
      const name = nameFilter(url.searchParams.get('q'))
      const all = [...files.values()].filter((f) => !name || f.name === name).sort((a, b) => a.seq - b.seq)
      const size = Math.min(Number(url.searchParams.get('pageSize') ?? 100), PAGE_SIZE)
      const offset = Number(url.searchParams.get('pageToken') ?? 0)
      const page = all.slice(offset, offset + size)
      const body = { files: page.map(meta) }
      if (offset + size < all.length) body.nextPageToken = String(offset + size)
      return send(res, 200, body)
    }

    const fileMatch = /^\/drive\/v3\/files\/([^/]+)$/.exec(path)
    if (fileMatch) {
      const f = files.get(decodeURIComponent(fileMatch[1]))
      if (!f) return err(res, 404, 'File not found')
      if (req.method === 'GET') return url.searchParams.get('alt') === 'media' ? send(res, 200, f.data) : send(res, 200, meta(f))
      if (req.method === 'DELETE') {
        files.delete(f.id)
        mirror(f, true)
        return send(res, 204)
      }
    }

    if (path === '/upload/drive/v3/files' && req.method === 'POST') {
      if (url.searchParams.get('uploadType') !== 'multipart') return err(res, 400, 'uploadType=multipart required')
      const parts = parseMultipart(await readBody(req), req.headers['content-type'])
      if (parts.length !== 2) return err(res, 400, `expected 2 parts, got ${parts.length}`)
      const m = JSON.parse(parts[0].content.toString())
      if (!Array.isArray(m.parents) || m.parents[0] !== 'appDataFolder') return err(res, 400, 'parents must be appDataFolder')
      const t = now()
      const f = {
        id: randomUUID().replace(/-/g, '').slice(0, 20),
        seq: files.size + Date.now(),
        name: m.name,
        mimeType: m.mimeType ?? 'application/octet-stream',
        version: 1,
        createdTime: t,
        modifiedTime: t,
        data: parts[1].content,
      }
      files.set(f.id, f)
      mirror(f)
      return send(res, 200, meta(f))
    }

    const upMatch = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(path)
    if (upMatch && req.method === 'PATCH') {
      if (url.searchParams.get('uploadType') !== 'media') return err(res, 400, 'uploadType=media required')
      const f = files.get(decodeURIComponent(upMatch[1]))
      if (!f) return err(res, 404, 'File not found')
      f.data = await readBody(req)
      f.version++
      f.modifiedTime = now()
      mirror(f)
      return send(res, 200, meta(f))
    }

    return err(res, 404, `No route for ${req.method} ${path}`)
  } catch (e) {
    return err(res, 500, String(e?.message ?? e))
  }
})

server.listen(PORT, () => console.log(`mock Drive on http://localhost:${PORT}${DIR ? ` (mirroring to ${DIR})` : ''}`))
