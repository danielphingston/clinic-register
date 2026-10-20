import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import { db } from '../db/db'

// jsdom's Blob has no arrayBuffer() and can't be structured-cloned into
// fake-indexeddb; Node's native classes can.
globalThis.Blob = NodeBlob as unknown as typeof Blob
globalThis.File = NodeFile as unknown as typeof File
// jsdom has no object URLs.
URL.createObjectURL ??= () => `blob:test/${crypto.randomUUID()}`
URL.revokeObjectURL ??= () => {}

beforeEach(async () => {
  localStorage.clear()
  window.history.replaceState(null, '', '/')
  await db.delete()
  await db.open()
})

afterEach(async () => {
  cleanup()
  // Background sync must not outlive the test: the next test deletes the db.
  // Imported lazily so test files' vi.mock calls still apply to its imports.
  const { syncService } = await import('../sync/service')
  await syncService.shutdown()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
