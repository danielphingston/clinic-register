import { describe, expect, it, vi } from 'vitest'
import { db } from '../../db/db'
import { addDays, todayISO } from '../../lib/format'
import { createPatient, deletePatient } from '../patients/patientRepo'
import { blankRow, repeatRows, rowsFromItems, rowsToInput } from './rxRows'
import { followUpsDue, itemsForVisit, previousVisit, recentPatients, saveVisit } from './visitRepo'

const rx = (remedyId: string, potency = '30C') => ({ remedyId, potency, dose: '4 pills', repetition: 'TDS', durationDays: 7 })

describe('saveVisit', () => {
  it('round-trips structured case notes', async () => {
    const p = await createPatient({ name: 'Asha' })
    const caseNotes = {
      complaint: 'Headache\nCough',
      complaints: ['Headache', 'Cough'],
      complaintStatus: [{ complaint: 'Acidity', status: 'better' as const }],
      generalsChecklist: { appetite: 'decreased' as const, urine: ['normal' as const] },
    }
    const id = await saveVisit({ patientId: p.id, date: '2026-10-01', caseNotes, items: [] })
    expect((await db.visits.get(id))?.caseNotes).toEqual(caseNotes)
  })

  it('creates a visit with its Rx, then updates and soft-deletes removed rows', async () => {
    const p = await createPatient({ name: 'Asha' })
    const id = await saveVisit({
      patientId: p.id,
      date: '2026-10-01',
      caseNotes: { complaint: 'Headache' },
      advice: ' Avoid coffee ',
      followUpDate: '2026-10-08',
      items: [rx('a'), rx('b', '200C'), rx('c', '1M')],
    })
    const items = await itemsForVisit(id)
    expect(items.map((i) => i.remedyId)).toEqual(['a', 'b', 'c'])
    expect(items[0]).toMatchObject({ patientId: p.id, visitId: id, dose: '4 pills', durationDays: 7 })
    expect((await db.visits.get(id))?.advice).toBe('Avoid coffee')

    // Edit: drop "b", change "a", add "d".
    await saveVisit({
      id,
      patientId: p.id,
      date: '2026-10-01',
      caseNotes: { complaint: 'Headache, better' },
      items: [{ ...rx('a', '200C'), id: items[0].id }, { ...rx('c', '1M'), id: items[2].id }, rx('d', '6X')],
    })
    const after = await itemsForVisit(id)
    expect(after.map((i) => `${i.remedyId} ${i.potency}`)).toEqual(['a 200C', 'c 1M', 'd 6X'])
    const removed = await db.prescriptionItems.get(items[1].id)
    expect(removed?.deleted).toBe(1)
    expect(await db.prescriptionItems.count()).toBe(4)
    expect(await db.visits.count()).toBe(1)
    expect((await db.visits.get(id))?.followUpDate).toBeUndefined()
  })

  it('keeps prescription order even when items share a timestamp', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const p = await createPatient({ name: 'A' })
    const ids = ['e', 'b', 'd', 'a', 'c']
    const v = await saveVisit({ patientId: p.id, date: '2026-10-01', caseNotes: {}, items: ids.map((x) => rx(x)) })
    expect((await itemsForVisit(v)).map((i) => i.remedyId)).toEqual(ids)
  })

  it('rolls back the whole save if any write fails', async () => {
    const p = await createPatient({ name: 'Asha' })
    vi.spyOn(db.prescriptionItems, 'add').mockRejectedValueOnce(new Error('disk full'))
    await expect(saveVisit({ patientId: p.id, date: '2026-10-01', caseNotes: {}, items: [rx('a')] })).rejects.toThrow()
    expect(await db.visits.count()).toBe(0)
    expect(await db.prescriptionItems.count()).toBe(0)
  })
})

describe('previous visit and repeat last Rx', () => {
  it('finds the visit before the current one', async () => {
    const p = await createPatient({ name: 'A' })
    const v1 = await saveVisit({ patientId: p.id, date: '2026-09-01', caseNotes: {}, items: [rx('a')] })
    const v2 = await saveVisit({ patientId: p.id, date: '2026-09-15', caseNotes: {}, items: [rx('b')] })
    expect((await previousVisit(p.id))?.id).toBe(v2)
    expect((await previousVisit(p.id, await db.visits.get(v2)))?.id).toBe(v1)
    expect(await previousVisit(p.id, await db.visits.get(v1))).toBeUndefined()
  })

  it('copies the previous Rx without ids, keeping rows already entered', async () => {
    const p = await createPatient({ name: 'A' })
    const v1 = await saveVisit({ patientId: p.id, date: '2026-09-01', caseNotes: {}, items: [rx('a'), rx('b', '1M')] })
    const prevItems = await itemsForVisit(v1)

    const fromBlank = repeatRows([blankRow()], prevItems)
    expect(fromBlank.map((r) => [r.remedyId, r.potency, r.id])).toEqual([
      ['a', '30C', undefined],
      ['b', '1M', undefined],
    ])
    const typed = { ...blankRow(), remedyId: 'z', potency: '6C' }
    expect(repeatRows([typed, blankRow()], prevItems).map((r) => r.remedyId)).toEqual(['z', 'a', 'b'])

    const { items } = rowsToInput(fromBlank)
    const v2 = await saveVisit({ patientId: p.id, date: '2026-09-15', caseNotes: {}, items })
    expect((await itemsForVisit(v2)).map((i) => i.remedyId)).toEqual(['a', 'b'])
    expect((await itemsForVisit(v1)).map((i) => i.deleted)).toEqual([0, 0])
  })

  it('validates grid rows', () => {
    const rows = rowsFromItems([], true)
    expect(rowsToInput([...rows, blankRow()])).toEqual({ items: [] })
    expect(rowsToInput([{ ...blankRow(), potency: '30C' }]).error).toMatch(/Row 1: choose a remedy/)
    expect(rowsToInput([{ ...blankRow(), remedyId: 'a' }]).error).toMatch(/potency/)
    expect(rowsToInput([{ ...blankRow(), remedyId: 'a', potency: '30', duration: '1.5' }]).error).toMatch(/whole days/)
  })
})

describe('dashboard queries', () => {
  it('lists follow-ups due today or overdue with no later visit', async () => {
    const today = todayISO()
    const [a, b, c, d, e] = await Promise.all(['A', 'B', 'C', 'D', 'E'].map((name) => createPatient({ name })))
    await saveVisit({ patientId: a.id, date: addDays(today, -7), caseNotes: {}, followUpDate: today, items: [] })
    await saveVisit({ patientId: b.id, date: addDays(today, -20), caseNotes: {}, followUpDate: addDays(today, -5), items: [] })
    // C came back after the follow-up was set.
    await saveVisit({ patientId: c.id, date: addDays(today, -20), caseNotes: {}, followUpDate: addDays(today, -5), items: [] })
    await saveVisit({ patientId: c.id, date: addDays(today, -4), caseNotes: {}, items: [] })
    // D's follow-up is in the future.
    await saveVisit({ patientId: d.id, date: today, caseNotes: {}, followUpDate: addDays(today, 7), items: [] })
    // E is deleted.
    await saveVisit({ patientId: e.id, date: addDays(today, -7), caseNotes: {}, followUpDate: today, items: [] })
    await deletePatient(e.id)

    const due = await followUpsDue(today)
    expect(due.map((f) => [f.patient.name, f.overdue])).toEqual([
      ['B', true],
      ['A', false],
    ])
  })

  it('lists the last 5 distinct patients visited, newest first', async () => {
    const ps = await Promise.all(['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((name) => createPatient({ name })))
    for (const [i, p] of ps.entries()) {
      await saveVisit({ patientId: p.id, date: `2026-09-${String(10 + i).padStart(2, '0')}`, caseNotes: {}, items: [] })
    }
    await saveVisit({ patientId: ps[0].id, date: '2026-09-30', caseNotes: {}, items: [] })
    await deletePatient(ps[6].id)
    expect((await recentPatients(5)).map((r) => r.patient.name)).toEqual(['A', 'F', 'E', 'D', 'C'])
  })
})
