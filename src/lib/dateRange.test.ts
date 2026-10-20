import { describe, expect, it } from 'vitest'
import { bucketKeys, bucketLabel, granularityFor, isISODate, presetRange, rangeDays, rangeLabel } from './dateRange'

describe('date range presets', () => {
  const today = '2026-10-20' // a Tuesday
  it('computes inclusive local ranges', () => {
    expect(presetRange('today', today)).toEqual({ from: today, to: today })
    expect(presetRange('yesterday', today)).toEqual({ from: '2026-10-19', to: '2026-10-19' })
    expect(presetRange('thisWeek', today)).toEqual({ from: '2026-10-19', to: today })
    expect(presetRange('thisWeek', '2026-10-25')).toEqual({ from: '2026-10-19', to: '2026-10-25' }) // Sunday
    expect(presetRange('thisMonth', today)).toEqual({ from: '2026-10-01', to: today })
    expect(presetRange('lastMonth', today)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(presetRange('lastMonth', '2026-03-05')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(presetRange('lastMonth', '2026-01-10')).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    expect(presetRange('thisYear', today)).toEqual({ from: '2026-01-01', to: today })
  })

  it('validates ISO dates', () => {
    expect(isISODate('2026-02-28')).toBe(true)
    expect(isISODate('2026-02-30')).toBe(false)
    expect(isISODate('2026-2-3')).toBe(false)
    expect(isISODate(null)).toBe(false)
  })

  it('buckets by day up to 62 days, else by month', () => {
    expect(rangeDays({ from: '2026-10-01', to: '2026-10-31' })).toBe(31)
    expect(granularityFor({ from: '2026-09-01', to: '2026-11-01' })).toBe('day') // 62 days
    expect(granularityFor({ from: '2026-09-01', to: '2026-11-02' })).toBe('month')
    expect(bucketKeys({ from: '2026-10-30', to: '2026-11-02' }, 'day')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
    expect(bucketKeys({ from: '2025-11-15', to: '2026-02-01' }, 'month')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
    expect(bucketLabel('2026-10-05')).toBe('5 Oct')
    expect(bucketLabel('2026-10')).toBe('Oct 2026')
    expect(rangeLabel({ from: '2026-10-01', to: '2026-10-01' })).toBe('01 Oct 2026')
    expect(rangeLabel({ from: '2026-10-01', to: '2026-10-31' })).toBe('01 Oct 2026 to 31 Oct 2026')
  })
})
