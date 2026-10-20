import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { createPatient } from '../patients/patientRepo'
import { saveVisit } from '../visits/visitRepo'
import { createBill } from '../billing/billingRepo'
import { seedRemedies, seedRemedyId } from '../remedies/remedyRepo'
import { buildReport, type ReportResult } from './reportDefs'
import { buildReportWorkbook, buildSheetsWorkbook, reportFileName, safeSheetName } from './excel'
import { allDataSheets } from './exportAll'
import { readReportState, reportSearch } from './reportUrl'

function roundTrip(wb: XLSX.WorkBook): XLSX.WorkBook {
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return XLSX.read(buf, { type: 'buffer', cellNF: true })
}

async function fixture() {
  await seedRemedies()
  const p = await createPatient({ name: 'Asha', sex: 'F', age: 30, ageAsOf: '2026-10-01' })
  const v = await saveVisit({ patientId: p.id, date: '2026-10-01', caseNotes: { complaint: 'Headache' }, items: [{ remedyId: seedRemedyId('Nux vomica'), potency: '30C' }] })
  await createBill({ patientId: p.id, visitId: v, date: '2026-10-01', items: [{ desc: 'Consultation', amount: 300.5 }], discount: 0, payNow: { amount: 300.5, mode: 'upi' } })
  return p
}

describe('Excel export', () => {
  it('writes the OP register with a title row, headers, numbers and text dates', async () => {
    const p = await fixture()
    const report = await buildReport('op-register', { from: '2026-10-01', to: '2026-10-31' })
    const wb = roundTrip(buildReportWorkbook(XLSX, report, 'Sunrise Clinic'))
    expect(wb.SheetNames).toEqual(['Summary', 'OP Register'])
    const ws = wb.Sheets['OP Register']
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 })
    expect(rows[0]).toEqual(['Sunrise Clinic — OP Register — 01 Oct 2026 to 31 Oct 2026'])
    expect(rows[2]).toEqual(['S.No', 'Date', 'OP No', 'Name', 'Age/Sex', 'New/Revisit', 'Complaint', 'Remedies', 'Consultation fee', 'Bill total', 'Paid'])
    expect(rows[3]).toEqual([1, '01 Oct 2026', p.opNo, 'Asha', '30y / F', 'New', 'Headache', 'Nux vomica 30C', 300.5, 300.5, 300.5])
    // Numbers are real numeric cells with a money format, not strings.
    expect(ws.I4.t).toBe('n')
    expect(ws.I4.v).toBe(300.5)
    expect(ws.I4.z).toBe('#,##0.00')
    expect(ws.B4.t).toBe('s')
    // Totals row.
    expect(rows[4]).toEqual([undefined, undefined, undefined, 'Total', undefined, undefined, undefined, undefined, 300.5, 300.5, 300.5].map((v) => v ?? ''))
    const summary = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Summary, { header: 1 })
    expect(summary[3]).toEqual(['Visits', 1])
    expect(reportFileName(report)).toBe('op-register-2026-10-01-to-2026-10-31.xlsx')
  })

  it('writes every table of a multi-table report as its own sheet', async () => {
    await fixture()
    const report = await buildReport('revenue', { from: '2026-10-01', to: '2026-10-31' })
    const wb = roundTrip(buildReportWorkbook(XLSX, report, ''))
    expect(wb.SheetNames).toEqual(['Summary', 'Billed vs collected per day', 'Collections by mode', 'Billing split'])
    const modes = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Collections by mode'], { header: 1 })
    expect(modes[0]).toEqual(['Clinic — Revenue — 01 Oct 2026 to 31 Oct 2026'])
    expect(modes.slice(2)).toEqual([['Mode', 'Amount'], ['Cash', 0], ['UPI', 300.5], ['Card', 0], ['Other', 0], ['Total', 300.5]])
  })

  it('keeps sheet names valid and unique', () => {
    const taken = new Set<string>()
    expect(safeSheetName('A/B: c?', taken)).toBe('A B  c')
    expect(safeSheetName('x'.repeat(40), taken)).toHaveLength(31)
    expect(safeSheetName('x'.repeat(40), taken)).toBe(`${'x'.repeat(28)} 2`)
  })

  it('exports all data, one sheet per table', async () => {
    await fixture()
    const wb = roundTrip(buildSheetsWorkbook(XLSX, await allDataSheets()))
    expect(wb.SheetNames).toEqual(['Patients', 'Visits', 'Prescriptions', 'Bills', 'Payments', 'Stock', 'Stock moves'])
    const bills = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Bills)
    expect(bills[0]).toMatchObject({ Date: '2026-10-01', Name: 'Asha', Total: 300.5, Paid: 300.5, Balance: 0 })
    expect(XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Stock, { header: 1 })).toEqual([['(no records)']])
  })
})

describe('report URL state', () => {
  const today = '2026-10-20'
  it('reads presets and custom ranges, with safe fallbacks', () => {
    expect(readReportState(new URLSearchParams(''), today)).toEqual({ type: 'op-register', preset: 'thisMonth', range: { from: '2026-10-01', to: today } })
    expect(readReportState(new URLSearchParams('report=revenue&range=lastMonth'), today)).toMatchObject({ type: 'revenue', range: { from: '2026-09-01', to: '2026-09-30' } })
    expect(readReportState(new URLSearchParams('report=x&range=custom&from=2026-10-31&to=2026-10-02'), today)).toMatchObject({
      type: 'op-register',
      preset: 'custom',
      range: { from: '2026-10-02', to: '2026-10-31' },
    })
    expect(readReportState(new URLSearchParams('range=custom&from=bad'), today).range).toEqual({ from: '2026-10-01', to: today })
    const s: ReportResult['range'] = { from: '2026-01-01', to: '2026-01-31' }
    expect(reportSearch({ type: 'stock', preset: 'custom', range: s })).toBe('?report=stock&range=custom&from=2026-01-01&to=2026-01-31')
    expect(reportSearch({ type: 'stock', preset: 'today', range: s })).toBe('?report=stock&range=today')
  })
})
