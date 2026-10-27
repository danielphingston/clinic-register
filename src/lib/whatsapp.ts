import type { ClinicSettings, Patient } from '../db/types'
import { normalizeIndianMobile } from '../features/patients/patientRepo'
import { formatDate, formatINR, todayISO } from './format'

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

// Placeholders for custom templates, shown as a hint in settings.
export const TEMPLATE_PLACEHOLDERS = '{name} {clinic} {opNo} {doctor} {phone} {date}'

// Clickable tags in the template editors.
export const TEMPLATE_TOKENS = [
  { label: 'Name', token: '{name}' },
  { label: 'Clinic', token: '{clinic}' },
  { label: 'OP No', token: '{opNo}' },
  { label: 'Doctor', token: '{doctor}' },
  { label: 'Clinic phone', token: '{phone}' },
  { label: 'Today', token: '{date}' },
]

export const DUE_TOKENS = [
  { label: 'Name', token: '{name}' },
  { label: 'Balance', token: '{balance}' },
  { label: 'Clinic', token: '{clinic}' },
  { label: 'OP No', token: '{opNo}' },
  { label: 'Due date', token: '{dueDate}' },
]

type TemplateSettings = Pick<ClinicSettings, 'clinicName'> & Partial<Pick<ClinicSettings, 'doctorName' | 'phone'>>

// Generic fill for custom messages. {phone} is the clinic's number and {date}
// is today (or `on`); unknown placeholders are left as typed.
export function fillTemplate(
  body: string,
  patient: Pick<Patient, 'name' | 'opNo'>,
  settings: TemplateSettings,
  on: string = todayISO(),
): string {
  const values: Record<string, string> = {
    name: patient.name,
    clinic: settings.clinicName || 'our clinic',
    opNo: patient.opNo,
    doctor: settings.doctorName ?? '',
    phone: settings.phone ?? '',
    date: formatDate(on),
  }
  return body.replace(/\{(name|clinic|opNo|doctor|phone|date)\}/g, (_, k: string) => values[k])
}

// wa.me link with a custom template prefilled, or null without a valid mobile.
export function templateLink(patient: Pick<Patient, 'name' | 'opNo' | 'phone'>, body: string, settings: TemplateSettings): string | null {
  const num = whatsappNumber(patient.phone)
  if (!num) return null
  return `https://wa.me/${num}?text=${encodeURIComponent(fillTemplate(body, patient, settings))}`
}
