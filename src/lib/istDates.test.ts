import { afterEach, describe, expect, it, vi } from 'vitest'
import { combineDateTime, formatTime } from '../features/appointments/time'
import { addDays, daysBetween, formatDate, parseISODate, todayISO, toISODate } from './format'
import { presetRange } from './dateRange'

// The clinic is in IST (UTC+5:30); vitest.config.ts sets TZ=Asia/Kolkata.
afterEach(() => {
  vi.useRealTimers()
})

describe('dates around midnight in IST', () => {
  it('runs in IST', () => {
    expect(new Date('2026-10-20T00:00:00Z').getTimezoneOffset()).toBe(-330)
  })

  it('today is the local date, not the UTC one, just after midnight', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-20T18:45:00Z')) // 00:15 IST on 21 Oct
    expect(todayISO()).toBe('2026-10-21')
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-10-20')
    vi.setSystemTime(new Date('2026-10-20T18:29:00Z')) // 23:59 IST on 20 Oct
    expect(todayISO()).toBe('2026-10-20')
  })

  it('early-morning times stay on the same day (before 05:30 the UTC date is a day behind)', () => {
    const d = new Date(2026, 9, 21, 2, 30) // 02:30 IST
    expect(toISODate(d)).toBe('2026-10-21')
    expect(d.toISOString().slice(0, 10)).toBe('2026-10-20')
    const start = combineDateTime('2026-10-21', '00:15').getTime()
    expect(toISODate(new Date(start))).toBe('2026-10-21')
    expect(formatTime(start)).toMatch(/12:15/)
  })

  it('date arithmetic and display do not shift', () => {
    expect(parseISODate('2026-10-21').getDate()).toBe(21)
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(daysBetween('2026-10-20', '2026-10-21')).toBe(1)
    expect(formatDate('2026-10-21')).toBe('21 Oct 2026')
  })

  it('"today" report range follows the local date after midnight', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-31T19:00:00Z')) // 00:30 IST on 1 Nov
    expect(presetRange('today', todayISO())).toEqual({ from: '2026-11-01', to: '2026-11-01' })
    expect(presetRange('thisMonth', todayISO()).from).toBe('2026-11-01')
  })
})
