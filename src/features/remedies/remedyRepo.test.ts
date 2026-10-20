import { describe, expect, it } from 'vitest'
import { db } from '../../db/db'
import { newRecord } from '../../db/repo'
import type { Remedy } from '../../db/types'
import seed from '../../data/remedies.json'
import {
  REMEDY_SEED_FLAG,
  addCustomRemedy,
  deleteRemedy,
  editRemedy,
  listRemedies,
  searchRemedies,
  seedRemedies,
} from './remedyRepo'

const r = (name: string, abbrev?: string) => newRecord<Remedy>({ name, abbrev, isCustom: 0 })

describe('remedy search ranking', () => {
  const list = [
    r('Natrum muriaticum', 'Nat-m.'),
    r('Arsenicum album', 'Ars.'),
    r('Arnica montana', 'Arn.'),
    r('Kali arsenicosum', 'Kali-ar.'),
    r('Calcarea arsenicosa', 'Calc-ar.'),
    r('Tarentula hispanica', 'Tarent.'),
  ]

  it('puts prefix matches first, then word prefixes, then substrings', () => {
    expect(searchRemedies(list, 'ars').map((x) => x.name)).toEqual([
      'Arsenicum album',
      'Calcarea arsenicosa',
      'Kali arsenicosum',
    ])
    expect(searchRemedies(list, 'ar').map((x) => x.name)).toEqual([
      'Arnica montana',
      'Arsenicum album',
      'Calcarea arsenicosa',
      'Kali arsenicosum',
      'Tarentula hispanica',
    ])
  })

  it('matches abbreviations case-insensitively', () => {
    expect(searchRemedies(list, 'NAT-M')[0].name).toBe('Natrum muriaticum')
    expect(searchRemedies(list, 'kali-a')[0].name).toBe('Kali arsenicosum')
  })

  it('ignores deleted remedies and empty queries', () => {
    const del = { ...r('Arum triphyllum', 'Arum-t.'), deleted: 1 as const }
    expect(searchRemedies([...list, del], 'arum')).toEqual([])
    expect(searchRemedies(list, '  ')).toEqual([])
  })
})

describe('remedy seed', () => {
  it('seeds once and is idempotent across re-runs', async () => {
    const n = await seedRemedies()
    expect(n).toBe(seed.length)
    expect(n).toBeGreaterThanOrEqual(250)
    expect(await seedRemedies()).toBe(0)
    await Promise.all([seedRemedies(), seedRemedies()])
    expect(await db.remedies.count()).toBe(seed.length)
    expect(await db.kv.get(REMEDY_SEED_FLAG)).toBeTruthy()
  })

  it('does not resurrect or duplicate remedies when the flag is lost', async () => {
    await seedRemedies()
    const ars = (await listRemedies()).find((x) => x.name === 'Arsenicum album')!
    await deleteRemedy(ars.id)
    await db.kv.delete(REMEDY_SEED_FLAG)
    await seedRemedies()
    expect(await db.remedies.count()).toBe(seed.length)
    expect((await db.remedies.get(ars.id))?.deleted).toBe(1)
  })

  it('includes the polychrests and the 12 biochemic salts', async () => {
    await seedRemedies()
    const names = new Set((await listRemedies()).map((x) => x.name))
    for (const n of ['Sulphur', 'Pulsatilla nigricans', 'Lycopodium clavatum', 'Nux vomica', 'Calcarea fluorica',
      'Calcarea phosphorica', 'Calcarea sulphurica', 'Ferrum phosphoricum', 'Kali muriaticum', 'Kali phosphoricum',
      'Kali sulphuricum', 'Magnesia phosphorica', 'Natrum muriaticum', 'Natrum phosphoricum', 'Natrum sulphuricum', 'Silicea'])
      expect(names).toContain(n)
  })
})

describe('custom remedies', () => {
  it('adds, edits and soft-deletes, rejecting duplicate names', async () => {
    await seedRemedies()
    const c = await addCustomRemedy('  Covid nosode ', 'Cov-n.')
    expect(c).toMatchObject({ name: 'Covid nosode', isCustom: 1 })
    await expect(addCustomRemedy('sulphur')).rejects.toThrow(/already exists/)
    await editRemedy(c.id, 'Covid nosode 2', '')
    const edited = await db.remedies.get(c.id)
    expect(edited?.name).toBe('Covid nosode 2')
    expect(edited?.abbrev).toBeUndefined()
    await deleteRemedy(c.id)
    expect((await listRemedies()).some((x) => x.id === c.id)).toBe(false)
    expect((await db.remedies.get(c.id))?.deleted).toBe(1)
    // A deleted name can be reused.
    await expect(addCustomRemedy('Covid nosode 2')).resolves.toBeTruthy()
  })
})
