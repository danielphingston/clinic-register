import { describe, expect, it } from 'vitest'
import { amountInWords, numberInWords } from './amountInWords'

describe('numberInWords (Indian system)', () => {
  it.each([
    [0, 'Zero'],
    [1, 'One'],
    [15, 'Fifteen'],
    [20, 'Twenty'],
    [99, 'Ninety Nine'],
    [100, 'One Hundred'],
    [101, 'One Hundred One'],
    [1001, 'One Thousand One'],
    [1250, 'One Thousand Two Hundred Fifty'],
    [10_000, 'Ten Thousand'],
    [99_999, 'Ninety Nine Thousand Nine Hundred Ninety Nine'],
    [1_00_000, 'One Lakh'],
    [1_00_001, 'One Lakh One'],
    [12_34_567, 'Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven'],
    [1_00_00_000, 'One Crore'],
    [1_05_00_000, 'One Crore Five Lakh'],
    [99_99_99_999, 'Ninety Nine Crore Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine'],
    [999_99_99_999, 'Nine Hundred Ninety Nine Crore Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine'],
  ])('%i -> %s', (n, words) => {
    expect(numberInWords(n)).toBe(words)
  })

  it('rejects fractions and negatives', () => {
    expect(() => numberInWords(1.5)).toThrow()
    expect(() => numberInWords(-1)).toThrow()
  })
})

describe('amountInWords', () => {
  it('wraps rupees', () => {
    expect(amountInWords(0)).toBe('Rupees Zero Only')
    expect(amountInWords(1250)).toBe('Rupees One Thousand Two Hundred Fifty Only')
    expect(amountInWords(12_34_567)).toBe('Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Only')
  })

  it('adds paise, rounded to two places', () => {
    expect(amountInWords(10.5)).toBe('Rupees Ten and Fifty Paise Only')
    expect(amountInWords(0.05)).toBe('Rupees Zero and Five Paise Only')
    expect(amountInWords(99.999)).toBe('Rupees One Hundred Only')
    expect(amountInWords(1.1)).toBe('Rupees One and Ten Paise Only')
  })

  it('rejects invalid amounts', () => {
    expect(() => amountInWords(-5)).toThrow()
    expect(() => amountInWords(NaN)).toThrow()
  })
})
