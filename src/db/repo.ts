import type { EntityTable } from 'dexie'
import { db } from './db'
import type { BaseRecord, ClinicSettings } from './types'

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

// OP-2026-00001. The sequence resets each calendar year.
export async function nextOpNo(): Promise<string> {
  const settings = await getSettings()
  const year = new Date().getFullYear()
  const n = await nextSequence(`op:${year}`)
  return `${settings.opPrefix}-${year}-${String(n).padStart(5, '0')}`
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
  opPrefix: 'OP',
  whatsappDueTemplate:
    'Dear {name}, a balance of {balance} is pending at {clinic} ({opNo}, due {dueDate}). Kindly clear it on your next visit. Thank you.',
  consultationFee: 0,
  defaultDueDays: 30,
  encryptDrive: false,
  // Morning and evening sessions are the norm for Indian OPDs.
  sessions: [
    { start: '09:00', end: '13:00' },
    { start: '17:00', end: '20:00' },
  ],
  slotMinutes: 15,
}

export async function getSettings(): Promise<ClinicSettings> {
  const saved = await getKV<Partial<ClinicSettings>>('settings')
  return { ...DEFAULT_SETTINGS, ...saved }
}

export async function saveSettings(settings: ClinicSettings): Promise<void> {
  await setKV('settings', settings)
}
