import { describe, expect, it } from 'vitest'
import { addTerm, checklistSummary, cleanChecklist, cleanDetail, cleanDetails, cleanEntries, cleanStatuses, complaintLines, complaintSummary, defaultGenerals, detailsFromNotes, hasTerm, toggleTerm, normaliseComplaints, previousComplaints, statusSummary } from './caseNotes'

describe('complaints', () => {
  it('normalises lines by trimming and dropping blanks', () => {
    expect(normaliseComplaints([' Headache ', '', '  ', 'Cough'])).toEqual(['Headache', 'Cough'])
  })

  it('reads the list, or splits an old free-text complaint', () => {
    expect(complaintLines({ complaints: ['A', 'B'], complaint: 'A\nB' })).toEqual(['A', 'B'])
    expect(complaintLines({ complaint: 'Headache\n\nCough ' })).toEqual(['Headache', 'Cough'])
    expect(complaintLines({})).toEqual([])
    expect(complaintLines(undefined)).toEqual([])
  })

  it('carries forward unresolved statuses, deduped case-insensitively', () => {
    expect(
      previousComplaints({
        complaints: ['Headache', 'Cough'],
        complaintStatus: [
          { complaint: 'headache', status: 'persists' },
          { complaint: 'Acidity', status: 'better' },
          { complaint: 'Rash', status: 'resolved' },
        ],
      }),
    ).toEqual(['Headache', 'Cough', 'Acidity'])
  })

  it('keeps only set statuses of listed complaints', () => {
    expect(cleanStatuses(['Headache', 'Cough'], { headache: 'better', other: 'worse' })).toEqual([{ complaint: 'Headache', status: 'better' }])
  })

  it('summarises statuses', () => {
    expect(statusSummary([{ complaint: 'Headache', status: 'better' }, { complaint: 'Cough', status: 'worse' }])).toEqual(['Headache — Better', 'Cough — Worsened'])
    expect(statusSummary(undefined)).toEqual([])
  })
})

describe('generals checklist', () => {
  it('drops empty fields and details of unchosen options', () => {
    expect(cleanChecklist({ urine: [], stool: 'regular', constipationDays: 3, sweat: 'normal', sweatParts: 'palms' })).toEqual({ stool: 'regular', sweat: 'normal' })
    expect(cleanChecklist({ sweat: 'increased', sweatParts: ' palms ', stool: 'constipation', constipationDays: 2 })).toEqual({ sweat: 'increased', sweatParts: 'palms', stool: 'constipation', constipationDays: 2 })
    expect(cleanChecklist({})).toBeUndefined()
    expect(cleanChecklist(undefined)).toBeUndefined()
  })

  it('summarises on one line', () => {
    expect(checklistSummary({ appetite: 'decreased', thirst: 'increased', urine: ['frequent', 'nocturnal'], stool: 'constipation', constipationDays: 3, sweat: 'increased', sweatParts: 'palms' })).toBe(
      'Appetite: Decreased · Thirst: Increased · Urine: Frequent micturition, Nocturnal urination · Stool: Constipation (every 3 days) · Sweat: Increased (palms)',
    )
    expect(checklistSummary(undefined)).toBe('')
  })
})

describe('complaint cards', () => {
  it('trims fields and entries and drops empty ones and empty cards', () => {
    expect(cleanDetail({ complaint: ' Head ', duration: '  ', aggravation: [' Sun ', '', 'sun', 'Noise'], amelioration: [' '], ailmentsFrom: [' Grief ', 'grief'] })).toEqual({ complaint: 'Head', aggravation: ['Sun', 'Noise'], ailmentsFrom: ['Grief'] })
    expect(cleanDetails([{ complaint: ' ' }, { duration: '2 days' }, { aggravation: [] }, {}])).toEqual([{ duration: '2 days' }])
    expect(cleanEntries(undefined)).toEqual([])
  })

  it('writes a summary line without dangling separators', () => {
    expect(
      complaintSummary({
        complaint: 'Throbbing headache, right temple',
        duration: '3 months',
        aggravation: ['Sun', 'Noise', 'Damp weather'],
        amelioration: ['Pressure'],
      }),
    ).toBe('Throbbing headache, right temple; since 3 months; < sun, noise, damp weather; > pressure')
    expect(complaintSummary({ complaint: 'Knee pain', aggravation: ['Night'] })).toBe('Knee pain; < night')
    expect(complaintSummary({ complaint: 'Cough' })).toBe('Cough')
    expect(complaintSummary({ duration: '2 days', amelioration: ['Rest'] })).toBe('since 2 days; > rest')
    expect(complaintSummary({ complaint: 'Fever', aggravation: ['AC room'] })).toBe('Fever; < AC room')
    expect(complaintSummary({ complaint: 'Insomnia', amelioration: ['Rest'], ailmentsFrom: ['Grief', 'Loss of sleep'] })).toBe('Insomnia; > rest; A/F grief, loss of sleep')
    expect(complaintSummary({})).toBe('')
  })

  it('turns old complaint lines into cards', () => {
    expect(detailsFromNotes({ complaints: ['Headache', 'Cough'] })).toEqual([{ complaint: 'Headache' }, { complaint: 'Cough' }])
    expect(detailsFromNotes({ complaint: 'Cold\nFever' })).toEqual([{ complaint: 'Cold' }, { complaint: 'Fever' }])
    expect(detailsFromNotes({ complaintDetails: [{ complaint: 'Knee' }], complaints: ['Knee'] })).toEqual([{ complaint: 'Knee' }])
    expect(detailsFromNotes(undefined)).toEqual([])
  })

  it('adds and toggles entries case-insensitively', () => {
    expect(addTerm(undefined, ' Sun ')).toEqual(['Sun'])
    expect(addTerm(['Sun'], 'sun')).toEqual(['Sun'])
    expect(addTerm(['Sun'], '  ')).toEqual(['Sun'])
    expect(toggleTerm([], 'Sun')).toEqual(['Sun'])
    expect(toggleTerm(['Sun'], 'Noise')).toEqual(['Sun', 'Noise'])
    expect(toggleTerm(['sun', 'Noise'], 'Sun')).toEqual(['Noise'])
    expect(hasTerm(['Cold', 'damp weather'], 'Damp weather')).toBe(true)
    expect(hasTerm(['Cold'], 'Col')).toBe(false)
    expect(hasTerm(undefined, 'Cold')).toBe(false)
  })
})

describe('default generals', () => {
  it('prefills every row at its normal option', () => {
    expect(defaultGenerals()).toEqual({ appetite: 'normal', thirst: 'normal', urine: ['normal'], sleep: 'sound', stool: 'regular', sweat: 'normal' })
    expect(cleanChecklist(defaultGenerals())).toEqual(defaultGenerals())
  })
})
