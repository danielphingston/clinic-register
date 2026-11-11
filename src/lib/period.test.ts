import { describe, expect, it } from 'vitest'
import { bucketKey, bucketKeys } from './dateRange'
import { isCurrentPeriod, periodGranularity, periodLabel, periodOf, periodRange, samePeriodLastYear, shiftPeriod, trendWindows } from './period'

describe('periods', () => {
  it('finds the period holding a date', () => {
    expect(periodRange(periodOf('week', '2026-11-11'))).toEqual({ from: '2026-11-09', to: '2026-11-15' }) // Wed -> Mon..Sun
    expect(periodRange(periodOf('week', '2026-11-15'))).toEqual({ from: '2026-11-09', to: '2026-11-15' }) // Sunday
    expect(periodRange(periodOf('month', '2026-02-14'))).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(periodRange(periodOf('quarter', '2026-11-11'))).toEqual({ from: '2026-10-01', to: '2026-12-31' })
    expect(periodRange(periodOf('quarter', '2026-03-31', true))).toEqual({ from: '2026-01-01', to: '2026-03-31' })
    expect(periodRange(periodOf('year', '2026-11-11'))).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })

  it('runs financial years from April to March', () => {
    expect(periodRange(periodOf('year', '2026-11-11', true))).toEqual({ from: '2026-04-01', to: '2027-03-31' })
    expect(periodRange(periodOf('year', '2027-03-31', true))).toEqual({ from: '2026-04-01', to: '2027-03-31' })
    expect(periodRange(periodOf('year', '2026-03-31', true))).toEqual({ from: '2025-04-01', to: '2026-03-31' })
  })

  it('steps back and forward across month and year ends', () => {
    expect(shiftPeriod(periodOf('week', '2026-01-01'), -1).start).toBe('2025-12-22')
    expect(shiftPeriod(periodOf('month', '2026-01-31'), -1).start).toBe('2025-12-01')
    expect(shiftPeriod(periodOf('month', '2026-12-01'), 1).start).toBe('2027-01-01')
    expect(shiftPeriod(periodOf('quarter', '2026-02-01'), -1).start).toBe('2025-10-01')
    expect(shiftPeriod(periodOf('year', '2026-05-01', true), 1).start).toBe('2027-04-01')
  })

  it('compares weeks with the week 52 weeks back, so weekdays line up', () => {
    const lastYear = samePeriodLastYear(periodOf('week', '2026-11-11'))
    expect(lastYear.start).toBe('2025-11-10') // also a Monday
    expect(samePeriodLastYear(periodOf('quarter', '2026-11-11')).start).toBe('2025-10-01')
    expect(samePeriodLastYear(periodOf('year', '2026-11-11', true)).start).toBe('2025-04-01')
  })

  it('names periods, with financial-year quarters numbered from April', () => {
    expect(periodLabel(periodOf('week', '2026-11-11'))).toBe('Week of 09 Nov 2026')
    expect(periodLabel(periodOf('month', '2026-11-11'))).toBe('November 2026')
    expect(periodLabel(periodOf('quarter', '2026-11-11'))).toBe('Q4 2026 (Oct–Dec)')
    expect(periodLabel(periodOf('quarter', '2026-11-11', true))).toBe('Q3 FY 2026–27 (Oct–Dec)')
    expect(periodLabel(periodOf('quarter', '2026-05-11', true))).toBe('Q1 FY 2026–27 (Apr–Jun)')
    expect(periodLabel(periodOf('quarter', '2027-02-11', true))).toBe('Q4 FY 2026–27 (Jan–Mar)')
    expect(periodLabel(periodOf('year', '2026-11-11'))).toBe('2026')
    expect(periodLabel(periodOf('year', '2026-11-11', true))).toBe('FY 2026–27')
  })

  it('buckets weeks and months by day, quarters by week and years by month', () => {
    expect(periodGranularity('week')).toBe('day')
    expect(periodGranularity('month')).toBe('day')
    expect(periodGranularity('quarter')).toBe('week')
    expect(periodGranularity('year')).toBe('month')
    // Q4 2026 starts on a Thursday: its first week is keyed by Monday 28 Sep.
    expect(bucketKey('2026-10-01', 'week')).toBe('2026-09-28')
    const weeks = bucketKeys(periodRange(periodOf('quarter', '2026-11-11')), 'week')
    expect(weeks[0]).toBe('2026-09-28')
    expect(weeks[weeks.length - 1]).toBe('2026-12-28')
    expect(weeks).toHaveLength(14)
  })
})

describe('trend windows', () => {
  it('compares a period in progress with the same days of the earlier periods', () => {
    const w = trendWindows(periodOf('month', '2026-11-11'), '2026-11-11')
    expect(w.partial).toBe(true)
    expect(w.current.range).toEqual({ from: '2026-11-01', to: '2026-11-11' })
    expect(w.previous).toMatchObject({ label: 'October 2026', range: { from: '2026-10-01', to: '2026-10-11' } })
    expect(w.lastYear).toMatchObject({ label: 'November 2025', range: { from: '2025-11-01', to: '2025-11-11' } })
  })

  it('cuts a comparison at its own period end when it is shorter', () => {
    const w = trendWindows(periodOf('month', '2026-03-31'), '2026-03-30')
    expect(w.previous.range).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  })

  it('compares a finished period with whole periods', () => {
    const w = trendWindows(periodOf('month', '2026-02-01'), '2026-11-11')
    expect(w.partial).toBe(false)
    expect(w.current.range).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(w.previous.range).toEqual({ from: '2026-01-01', to: '2026-01-31' })
    expect(w.lastYear.range).toEqual({ from: '2025-02-01', to: '2025-02-28' })
  })

  it('treats the last day of a period as complete', () => {
    const p = periodOf('week', '2026-11-15')
    expect(isCurrentPeriod(p, '2026-11-15')).toBe(true)
    expect(trendWindows(p, '2026-11-15').partial).toBe(false)
  })
})
