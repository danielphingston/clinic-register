import { describe, expect, it } from 'vitest'
import { checklistSummary, cleanChecklist, cleanDetail, cleanDetails, cleanStatuses, complaintLines, complaintSummary, defaultGenerals, detailsFromNotes, hasTerm, toggleTerm, normaliseComplaints, previousComplaints, statusSummary } from './caseNotes'

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
  it('trims fields and drops empty ones and empty cards', () => {
    expect(cleanDetail({ location: ' Head ', sensation: '  ', worse: 'Sun' })).toEqual({ location: 'Head', worse: 'Sun' })
    expect(cleanDetails([{ location: ' ' }, { sensation: 'Dull' }, {}])).toEqual([{ sensation: 'Dull' }])
  })

  it('writes a summary line without dangling separators', () => {
    expect(
      complaintSummary({
        location: 'Head, right temple',
        sensation: 'Throbbing, bursting',
        duration: '3 months, after a fall',
        worse: 'Sun, Noise',
        better: 'Pressure',
        concomitants: 'Nausea',
      }),
    ).toBe('Head, right temple: throbbing, bursting; since 3 months, after a fall; < sun, noise; > pressure; with nausea')
    expect(complaintSummary({ sensation: 'Throbbing', worse: 'Night' })).toBe('Throbbing; < night')
    expect(complaintSummary({ location: 'Knee' })).toBe('Knee')
    expect(complaintSummary({ duration: '2 days', concomitants: 'Fever' })).toBe('since 2 days; with fever')
    expect(complaintSummary({ location: 'Head', note: 'Worse after meals' })).toBe('Head; Worse after meals')
    expect(complaintSummary({ note: 'Old line' })).toBe('Old line')
    expect(complaintSummary({})).toBe('')
  })

  it('turns old complaint lines into note cards', () => {
    expect(detailsFromNotes({ complaints: ['Headache', 'Cough'] })).toEqual([{ note: 'Headache' }, { note: 'Cough' }])
    expect(detailsFromNotes({ complaint: 'Cold\nFever' })).toEqual([{ note: 'Cold' }, { note: 'Fever' }])
    expect(detailsFromNotes({ complaintDetails: [{ location: 'Knee' }], complaints: ['Knee'] })).toEqual([{ location: 'Knee' }])
    expect(detailsFromNotes(undefined)).toEqual([])
  })

  it('toggles comma-separated terms case-insensitively', () => {
    expect(toggleTerm('', 'Sun')).toBe('Sun')
    expect(toggleTerm('Sun', 'Noise')).toBe('Sun, Noise')
    expect(toggleTerm('sun, Noise', 'Sun')).toBe('Noise')
    expect(hasTerm('Cold, damp weather', 'Damp weather')).toBe(true)
    expect(hasTerm('Cold', 'Col')).toBe(false)
  })
})

describe('default generals', () => {
  it('prefills every row at its normal option', () => {
    expect(defaultGenerals()).toEqual({ appetite: 'normal', thirst: 'normal', urine: ['normal'], sleep: 'sound', stool: 'regular', sweat: 'normal' })
    expect(cleanChecklist(defaultGenerals())).toEqual(defaultGenerals())
  })
})
