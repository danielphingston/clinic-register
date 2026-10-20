import { describe, expect, it } from 'vitest'
import { ageFromDob, ageSex, currentAge, displayAge, dobFromAge } from './age'
import { addDays, formatDate, formatINR, toISODate } from './format'

describe('age <-> DOB', () => {
  it('computes whole years, counting the birthday itself', () => {
    expect(ageFromDob('1990-10-20', '2026-10-20')).toBe(36)
    expect(ageFromDob('1990-10-21', '2026-10-20')).toBe(35)
    expect(ageFromDob('2000-02-29', '2026-02-28')).toBe(25)
    expect(ageFromDob('2026-10-21', '2026-10-20')).toBe(0)
  })

  it('derives an approximate DOB from an age and round-trips', () => {
    expect(dobFromAge(36, '2026-10-20')).toBe('1990-10-20')
    for (const age of [0, 1, 17, 64]) expect(ageFromDob(dobFromAge(age, '2026-03-05'), '2026-03-05')).toBe(age)
  })

  it('shows months for infants and advances a recorded age over time', () => {
    expect(displayAge({ dob: '2026-02-10', createdAt: 0 }, '2026-10-20')).toBe('8m')
    expect(displayAge({ dob: '1990-01-01', createdAt: 0 }, '2026-10-20')).toBe('36y')
    expect(currentAge({ age: 40, ageAsOf: '2024-06-01', createdAt: 0 }, '2026-10-20')).toBe(42)
    expect(ageSex({ age: 40, ageAsOf: '2026-10-20', sex: 'F', createdAt: 0 }, '2026-10-20')).toBe('40y / F')
    expect(ageSex({ createdAt: 0 }, '2026-10-20')).toBe('')
  })
})

describe('format', () => {
  it('formats dates as DD MMM YYYY and uses the local calendar day', () => {
    expect(formatDate('2026-01-05')).toBe('05 Jan 2026')
    expect(toISODate(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01')
    expect(addDays('2026-12-25', 7)).toBe('2027-01-01')
  })

  it('formats INR with Indian grouping', () => {
    expect(formatINR(123456.5)).toBe('₹1,23,456.50')
  })
})
