import { lazy, type ComponentType } from 'react'

// A lazy chunk that fails to load (usually a stale chunk name after a deploy,
// or offline before the new build was cached).
export class ChunkLoadError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'ChunkLoadError'
  }
}

export function isChunkLoadError(e: unknown): boolean {
  if (e instanceof ChunkLoadError) return true
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e)
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i.test(msg)
}

// React.lazy for a named (or default) export.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyComponent = ComponentType<any>

export function lazyPage<M extends Record<K, AnyComponent>, K extends keyof M>(load: () => Promise<M>, name: K) {
  return lazy<M[K]>(async () => {
    try {
      const m = await load()
      return { default: m[name] }
    } catch (e) {
      throw new ChunkLoadError(e)
    }
  })
}
