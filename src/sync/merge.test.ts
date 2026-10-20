import { describe, expect, it } from 'vitest'
import { diffMerge, mergeRecords, pickWinner, stableStringify } from './merge'

const rec = (id: string, updatedAt: number, extra: Record<string, unknown> = {}) => ({
  id,
  updatedAt,
  createdAt: 1,
  deleted: 0 as 0 | 1,
  ...extra,
})

const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id))

describe('mergeRecords', () => {
  it('keeps the newer updatedAt per id and the union of ids', () => {
    const local = [rec('a', 5, { name: 'A-local' }), rec('b', 1, { name: 'B-local' })]
    const remote = [rec('a', 3, { name: 'A-remote' }), rec('b', 2, { name: 'B-remote' }), rec('c', 1)]
    const m = byId(mergeRecords(local, remote))
    expect(m.map((r) => (r as { name?: string }).name ?? r.id)).toEqual(['A-local', 'B-remote', 'c'])
  })

  it('prefers the tombstone on an updatedAt tie', () => {
    const edit = rec('a', 10, { name: 'edited' })
    const del = rec('a', 10, { name: 'old', deleted: 1 })
    expect(mergeRecords([edit], [del])[0].deleted).toBe(1)
    expect(mergeRecords([del], [edit])[0].deleted).toBe(1)
  })

  it('breaks other ties deterministically regardless of order', () => {
    const x = rec('a', 10, { name: 'x' })
    const y = rec('a', 10, { name: 'y' })
    expect(pickWinner(x, y)).toEqual(pickWinner(y, x))
    expect(mergeRecords([x], [y])).toEqual(mergeRecords([y], [x]))
  })

  it('a newer edit beats an older delete, and a newer delete beats an older edit', () => {
    expect(mergeRecords([rec('a', 1, { deleted: 1 })], [rec('a', 2, { name: 'back' })])[0]).toMatchObject({ deleted: 0 })
    expect(mergeRecords([rec('a', 1, { name: 'edit' })], [rec('a', 2, { deleted: 1 })])[0]).toMatchObject({ deleted: 1 })
  })

  it('is idempotent and commutative', () => {
    const local = [rec('a', 5, { n: 1 }), rec('b', 3, { n: 2 }), rec('d', 4, { deleted: 1 })]
    const remote = [rec('a', 5, { n: 9 }), rec('b', 4, { n: 3 }), rec('c', 1)]
    const m1 = byId(mergeRecords(local, remote))
    expect(byId(mergeRecords(m1, remote))).toEqual(m1)
    expect(byId(mergeRecords(m1, m1))).toEqual(m1)
    expect(byId(mergeRecords(remote, local))).toEqual(m1)
  })

  it('is associative across three devices', () => {
    const a = [rec('x', 1, { v: 'a' }), rec('y', 9, { v: 'a' })]
    const b = [rec('x', 2, { v: 'b' }), rec('z', 1, { v: 'b' })]
    const c = [rec('x', 2, { v: 'c' }), rec('y', 3, { v: 'c', deleted: 1 })]
    const left = byId(mergeRecords(mergeRecords(a, b), c))
    const right = byId(mergeRecords(a, mergeRecords(b, c)))
    expect(left).toEqual(right)
  })
})

describe('diffMerge', () => {
  it('lists remote winners to write and flags local-only or newer records', () => {
    const local = [rec('a', 5), rec('b', 1), rec('only-local', 1)]
    const remote = [rec('a', 3), rec('b', 2), rec('c', 1)]
    const d = diffMerge(local, remote)
    expect(d.toWrite.map((r) => r.id).sort()).toEqual(['b', 'c'])
    expect(d.localNewer).toBe(true)
  })

  it('reports nothing when both sides are equal, whatever the key order', () => {
    const local = [{ updatedAt: 1, id: 'a', deleted: 0 as const, caption: undefined, n: { y: 1, x: 2 } }]
    const remote = [{ id: 'a', deleted: 0 as const, updatedAt: 1, n: { x: 2, y: 1 } }]
    expect(diffMerge(local, remote)).toEqual({ toWrite: [], localNewer: false })
  })

  it('collapses duplicate ids within the remote set', () => {
    const d = diffMerge([], [rec('a', 1, { v: 1 }), rec('a', 2, { v: 2 })])
    expect(d.toWrite).toEqual([rec('a', 2, { v: 2 })])
  })
})

describe('stableStringify', () => {
  it('sorts keys and drops undefined', () => {
    expect(stableStringify({ b: 1, a: [1, { d: undefined, c: 2 }] })).toBe('{"a":[1,{"c":2}],"b":1}')
  })
})
