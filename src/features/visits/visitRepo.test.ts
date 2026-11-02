import { describe, expect, it, vi } from 'vitest'
import { db } from '../../db/db'
import { addDays, todayISO } from '../../lib/format'
import { createPatient, deletePatient } from '../patients/patientRepo'
import { blankRow, repeatRows, rowsFromItems, rowsToInput } from './rxRows'
import { insert } from '../../db/repo'
import type { Attachment } from '../../db/types'
import { createBill, voidBill } from '../billing/billingRepo'
import { cancelCertificate, createCertificate } from '../certificates/certificateRepo'
import { createStockItem } from '../stock/stockRepo'
import { deleteVisit, followUpsDue, itemsForVisit, previousVisit, recentPatients, saveVisit, visitDeleteBlockers, VisitDeleteError } from './visitRepo'

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

describe('deleteVisit', () => {
  async function setup() {
    const p = await createPatient({ name: 'A' })
    const id = await saveVisit({ patientId: p.id, date: '2026-09-01', caseNotes: { complaint: 'Cough' }, items: [rx('a')] })
    return { p, id }
  }

  it('is blocked by a later visit until that one is deleted', async () => {
    const { p, id } = await setup()
    const later = await saveVisit({ patientId: p.id, date: '2026-09-15', caseNotes: {}, items: [] })
    const blockers = await visitDeleteBlockers(id)
    expect(blockers).toHaveLength(1)
    expect(blockers[0].reason).toMatch(/^Has a follow-up visit on .*Delete that visit first\.$/)
    expect(blockers[0].to).toBe(`/patients/${p.id}/visits/${later}`)
    await expect(deleteVisit(id)).rejects.toBeInstanceOf(VisitDeleteError)
    expect((await db.visits.get(id))?.deleted).toBe(0)

    await deleteVisit(later)
    await deleteVisit(id)
    expect((await db.visits.get(id))?.deleted).toBe(1)
  })

  it('treats a same-date visit created later as a follow-up', async () => {
    const { p, id } = await setup()
    await saveVisit({ patientId: p.id, date: '2026-09-01', caseNotes: {}, items: [] })
    expect(await visitDeleteBlockers(id)).toHaveLength(1)
  })

  it('is blocked by a bill until it is voided', async () => {
    const { p, id } = await setup()
    const { bill } = await createBill({ patientId: p.id, visitId: id, date: '2026-09-01', items: [{ desc: 'Consultation', amount: 100 }], discount: 0 })
    expect((await visitDeleteBlockers(id)).map((b) => b.reason)).toEqual([`Linked to bill ${bill.billNo} — void it first.`])
    await expect(deleteVisit(id)).rejects.toThrow(/void it first/)
    await voidBill(bill.id)
    await deleteVisit(id)
    expect((await db.visits.get(id))?.deleted).toBe(1)
  })

  it('is blocked by a certificate until it is cancelled', async () => {
    const { p, id } = await setup()
    const cert = await createCertificate({ kind: 'medical', patientId: p.id, visitId: id, date: '2026-09-01', title: 'Medical Certificate', body: 'Rest advised.' })
    expect((await visitDeleteBlockers(id)).map((b) => b.reason)).toEqual([`Certificate ${cert.certNo} — cancel it first.`])
    await cancelCertificate(cert.id)
    await deleteVisit(id)
    expect((await db.visits.get(id))?.deleted).toBe(1)
  })

  it('is blocked by attachments until they are deleted', async () => {
    const { p, id } = await setup()
    const att = await insert<Attachment>(db.attachments, {
      patientId: p.id, visitId: id, kind: 'lab', mime: 'image/jpeg', fileName: 'a.jpg', originalSize: 1, size: 1, blobHash: 'h',
    })
    expect((await visitDeleteBlockers(id)).map((b) => b.reason)).toEqual(['1 attachment(s) — delete them first.'])
    await db.attachments.update(att.id, { deleted: 1 })
    expect(await visitDeleteBlockers(id)).toEqual([])
  })

  it('tombstones the visit and Rx and returns dispensed stock', async () => {
    const p = await createPatient({ name: 'A' })
    const stock = await createStockItem({ remedyId: 'a', potency: '30C', form: 'globules', unit: 'g', lowStockAt: 1, price: 0, openingQty: 10 })
    const id = await saveVisit({
      patientId: p.id, date: '2026-09-01', caseNotes: {},
      items: [{ ...rx('a'), stockItemId: stock.id, qtyDispensed: 4 }],
    })
    expect((await db.stockItems.get(stock.id))?.qty).toBe(6)
    const [item] = await itemsForVisit(id)

    await deleteVisit(id)
    expect((await db.visits.get(id))?.deleted).toBe(1)
    expect((await db.prescriptionItems.get(item.id))?.deleted).toBe(1)
    expect((await db.stockItems.get(stock.id))?.qty).toBe(10)
    // History is kept: the original dispense plus a correcting move.
    expect(await db.stockMoves.where('refId').equals(item.id).count()).toBe(2)
    expect(await itemsForVisit(id)).toEqual([])
  })

  it('stops counting as the previous visit or a due follow-up', async () => {
    const today = todayISO()
    const p = await createPatient({ name: 'A' })
    const v1 = await saveVisit({ patientId: p.id, date: addDays(today, -20), caseNotes: { complaint: 'Cough' }, items: [] })
    const v2 = await saveVisit({ patientId: p.id, date: addDays(today, -10), caseNotes: {}, followUpDate: addDays(today, -1), items: [] })
    expect((await followUpsDue(today))[0].visit.id).toBe(v2)
    await deleteVisit(v2)
    expect((await previousVisit(p.id))?.id).toBe(v1)
    expect(await followUpsDue(today)).toEqual([])
    expect((await recentPatients(5))[0].lastVisit.id).toBe(v1)
  })
})
