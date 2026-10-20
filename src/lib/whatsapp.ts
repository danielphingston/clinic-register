import type { ClinicSettings, Patient } from '../db/types'
import { normalizeIndianMobile } from '../features/patients/patientRepo'
import { formatDate, formatINR } from './format'

// Placeholders: {name} {balance} {clinic} {opNo} {dueDate}. A literal "₹"
// before {balance} is dropped because the formatted amount carries its own.
export function fillDueTemplate(
  template: string,
  patient: Pick<Patient, 'name' | 'opNo'>,
  balance: number,
  settings: Pick<ClinicSettings, 'clinicName'>,
  dueDate?: string,
): string {
  const values: Record<string, string> = {
    name: patient.name,
    balance: formatINR(balance),
    clinic: settings.clinicName || 'our clinic',
    opNo: patient.opNo,
    dueDate: dueDate ? formatDate(dueDate) : '',
  }
  return template
    .replace(/₹\s*\{balance\}/g, '{balance}')
    .replace(/\{(name|balance|clinic|opNo|dueDate)\}/g, (_, k: string) => values[k])
}

export function whatsappNumber(phone?: string): string | null {
  const n = phone ? normalizeIndianMobile(phone) : null
  return n ? `91${n}` : null
}

// wa.me link with the due reminder prefilled, or null without a valid mobile.
// Opening it only drafts the message; the user still presses Send in WhatsApp.
export function dueReminderLink(
  patient: Pick<Patient, 'name' | 'opNo' | 'phone'>,
  balance: number,
  settings: Pick<ClinicSettings, 'clinicName' | 'whatsappDueTemplate'>,
  dueDate?: string,
): string | null {
  const num = whatsappNumber(patient.phone)
  if (!num) return null
  const text = fillDueTemplate(settings.whatsappDueTemplate, patient, balance, settings, dueDate)
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`
}
