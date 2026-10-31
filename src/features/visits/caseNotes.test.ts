import { describe, expect, it } from 'vitest'
import { checklistSummary, cleanChecklist, cleanStatuses, complaintLines, normaliseComplaints, previousComplaints, statusSummary } from './caseNotes'

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
