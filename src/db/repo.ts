import type { EntityTable } from 'dexie'
import { db } from './db'
import type { BaseRecord, Branding, CertificateKind, ClinicSettings } from './types'
import { DEFAULT_OP_FORMAT, opFormatOf, opNumberParser, opScope, renderOpNo } from '../lib/opFormat'

type NewRecord<T extends BaseRecord> = Omit<T, keyof BaseRecord>

export function newRecord<T extends BaseRecord>(data: NewRecord<T>): T {
  const now = Date.now()
  return { ...data, id: crypto.randomUUID(), createdAt: now, updatedAt: now, deleted: 0 } as T
}

export async function insert<T extends BaseRecord>(table: EntityTable<T, 'id'>, data: NewRecord<T>): Promise<T> {
  const rec = newRecord<T>(data)
  await table.add(rec)
  return rec
}

export async function update<T extends BaseRecord>(
  table: EntityTable<T, 'id'>,
  id: string,
  changes: Partial<NewRecord<T>>,
): Promise<void> {
  // Casts needed: Dexie can't resolve IDType/UpdateSpec for a generic T.
  await table.update(id as never, { ...changes, updatedAt: Date.now() } as never)
}

export async function softDelete<T extends BaseRecord>(table: EntityTable<T, 'id'>, id: string): Promise<void> {
  await table.update(id as never, { deleted: 1, updatedAt: Date.now() } as never)
}

// ---- key/value helpers ----

export async function getKV<T>(key: string): Promise<T | undefined> {
  return (await db.kv.get(key))?.value as T | undefined
}

export async function setKV<T>(key: string, value: T): Promise<void> {
  await db.kv.put({ key, value, updatedAt: Date.now() })
}

// ---- sequences ----

// Atomically increments a named counter and returns the new value.
export async function nextSequence(name: string): Promise<number> {
  return db.transaction('rw', db.kv, async () => {
    const key = `seq:${name}`
    const current = ((await db.kv.get(key))?.value as number | undefined) ?? 0
    const next = current + 1
    await db.kv.put({ key, value: next, updatedAt: Date.now() })
    return next
  })
}

// The running number an OP number in the current scope would get next: one
// past the highest of the patients already numbered in this scope (any device,
// deleted ones too), this device's counter and the "Next OP number" setting.
// Read-only; nextOpNo reserves it. `format` previews an unsaved format.
export async function peekOpNumber(now = new Date(), format?: string): Promise<{ scope: string; n: number; format: string }> {
  const settings = await getSettings()
  const fmt = format ?? settings.opFormat
  const scope = opScope(fmt, now)
  const read = opNumberParser(fmt, now)
  let max = ((await db.kv.get(`seq:op:${scope}`))?.value as number | undefined) ?? 0
  for (const k of await db.patients.orderBy('opNo').keys()) {
    const n = read(String(k))
    if (n !== undefined && n > max) max = n
  }
  const floor = settings.opNextFloor
  if (floor?.scope === scope && floor.n - 1 > max) max = floor.n - 1
  return { scope, n: max + 1, format: fmt }
}

// The next OP number in the configured format (lib/opFormat), e.g.
// OP-2026-00001 or 260183. Reserved on this device, so two calls never return
// the same number.
export async function nextOpNo(): Promise<string> {
  const now = new Date()
  return db.transaction('rw', [db.patients, db.kv], async () => {
    const { scope, n, format } = await peekOpNumber(now)
    await db.kv.put({ key: `seq:op:${scope}`, value: n, updatedAt: Date.now() })
    return renderOpNo(format, now, n)
  })
}

// ---- settings ----

export const DEFAULT_SETTINGS: ClinicSettings = {
  clinicName: '',
  doctorName: '',
  qualification: '',
  regNo: '',
  address: '',
  phone: '',
  email: '',
  opFormat: DEFAULT_OP_FORMAT,
  whatsappDueTemplate:
    'Dear {name}, a balance of {balance} is pending at {clinic} ({opNo}, due {dueDate}). Kindly clear it on your next visit. Thank you.',
  whatsappTemplates: [
    { id: 'tpl-good-morning', name: 'Good morning', body: 'Good morning {name}! Wishing you a healthy day. — {clinic}' },
    {
      id: 'tpl-follow-up',
      name: 'Follow-up reminder',
      body: 'Dear {name}, this is a gentle reminder for your follow-up at {clinic}. Please call {phone} to book a time. — {doctor}',
    },
  ],
  consultationFee: 0,
  courierFee: 0,
  defaultDueDays: 30,
  encryptDrive: false,
  // Morning and evening sessions are the norm for Indian OPDs.
  sessions: [
    { start: '09:00', end: '13:00' },
    { start: '17:00', end: '20:00' },
  ],
  slotMinutes: 15,
  letterheadStyle: 'classic',
  certPlace: '',
  certWatermark: false,
  certTypes: {
    medicine: {
      title: 'To Whom It May Concern',
      template:
        'This is to certify that {name} ({age}, OP No. {opNo}) is under my treatment for {condition}.\n\nI also certify that the medicines listed below are prepared according to homoeopathic principles and do not contain alcoholic or sedative contents.',
      letterheadStyle: 'default',
      watermark: 'default',
      candidateLine: 'none',
    },
    medical: {
      title: 'Medical Certificate',
      template:
        'This is to certify that {name} ({age}, OP No. {opNo}) was under my treatment for {condition} and was advised rest from {from} to {to}.',
      letterheadStyle: 'default',
      watermark: 'default',
      candidateLine: 'bottom',
    },
  },
}

export async function getSettings(): Promise<ClinicSettings> {
  const saved = await getKV<Partial<ClinicSettings> & { opPrefix?: string }>('settings')
  const merged: ClinicSettings & { opPrefix?: string } = { ...DEFAULT_SETTINGS, ...saved, opFormat: opFormatOf(saved) }
  delete merged.opPrefix
  // Per-type certificate settings merge field by field, so a type or field
  // added later gets its default.
  const types = { ...DEFAULT_SETTINGS.certTypes }
  for (const k of Object.keys(types) as CertificateKind[]) types[k] = { ...types[k], ...saved?.certTypes?.[k] }
  return { ...merged, certTypes: types }
}

export async function saveSettings(settings: ClinicSettings): Promise<void> {
  await setKV('settings', settings)
}

// ---- branding (logo, signature, seal) ----

export async function getBranding(): Promise<Branding> {
  return (await getKV<Branding>('branding')) ?? {}
}

export async function setBrandingImage(key: keyof Branding, dataUrl: string | undefined): Promise<void> {
  await db.transaction('rw', db.kv, async () => {
    const next = { ...(await getBranding()) }
    if (dataUrl) next[key] = dataUrl
    else delete next[key]
    await setKV('branding', next)
  })
}
