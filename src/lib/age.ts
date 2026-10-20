import type { Patient } from '../db/types'
import { parseISODate, toISODate } from './format'

// Whole years between dob and today (both ISO dates).
export function ageFromDob(dob: string, today: string): number {
  const b = parseISODate(dob)
  const t = parseISODate(today)
  let age = t.getFullYear() - b.getFullYear()
  if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) age--
  return Math.max(0, age)
}

function monthsFromDob(dob: string, today: string): number {
  const b = parseISODate(dob)
  const t = parseISODate(today)
  let m = (t.getFullYear() - b.getFullYear()) * 12 + t.getMonth() - b.getMonth()
  if (t.getDate() < b.getDate()) m--
  return Math.max(0, m)
}

// Approximate DOB for a patient who only knows their age: same day/month as today.
export function dobFromAge(age: number, today: string): string {
  const t = parseISODate(today)
  t.setFullYear(t.getFullYear() - age)
  return toISODate(t)
}

// Current age in whole years. When only an age was recorded, it is advanced by
// the years elapsed since it was recorded.
export function currentAge(p: Pick<Patient, 'dob' | 'age' | 'ageAsOf' | 'createdAt'>, today: string): number | undefined {
  if (p.dob) return ageFromDob(p.dob, today)
  if (p.age == null) return undefined
  const asOf = p.ageAsOf ?? (p.createdAt ? toISODate(new Date(p.createdAt)) : today)
  return p.age + ageFromDob(asOf, today)
}

// "34y", or "8m" for infants.
export function displayAge(p: Pick<Patient, 'dob' | 'age' | 'ageAsOf' | 'createdAt'>, today: string): string {
  if (p.dob) {
    const years = ageFromDob(p.dob, today)
    return years === 0 ? `${monthsFromDob(p.dob, today)}m` : `${years}y`
  }
  const age = currentAge(p, today)
  return age == null ? '' : `${age}y`
}

export function ageSex(p: Pick<Patient, 'dob' | 'age' | 'ageAsOf' | 'createdAt' | 'sex'>, today: string): string {
  return [displayAge(p, today), p.sex ?? ''].filter(Boolean).join(' / ')
}
