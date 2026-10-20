import type { PrescriptionItem } from '../../db/types'

export const POTENCY_PRESETS = ['3X', '6X', '6C', '12X', '30C', '200C', '1M', '10M', '50M', 'Q']
export const REPETITION_PRESETS = ['OD', 'BD', 'TDS', 'QID', 'HS', 'SOS', 'Weekly', 'Fortnightly', 'Single dose']

export function rxDetails(i: Pick<PrescriptionItem, 'dose' | 'repetition' | 'durationDays'>): string {
  return [i.dose, i.repetition, i.durationDays ? `${i.durationDays} days` : ''].filter(Boolean).join(' · ')
}
