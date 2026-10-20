import Dexie, { type EntityTable } from 'dexie'
import { toISODate } from '../lib/format'
import { installChangeTracking } from '../sync/tracking'
import type {
  Appointment,
  Attachment,
  Bill,
  KV,
  Patient,
  Payment,
  PrescriptionItem,
  Remedy,
  StockItem,
  StockMove,
  StoredBlob,
  Visit,
} from './types'

export class ClinicDB extends Dexie {
  patients!: EntityTable<Patient, 'id'>
  visits!: EntityTable<Visit, 'id'>
  prescriptionItems!: EntityTable<PrescriptionItem, 'id'>
  attachments!: EntityTable<Attachment, 'id'>
  blobs!: EntityTable<StoredBlob, 'hash'>
  appointments!: EntityTable<Appointment, 'id'>
  bills!: EntityTable<Bill, 'id'>
  payments!: EntityTable<Payment, 'id'>
  remedies!: EntityTable<Remedy, 'id'>
  stockItems!: EntityTable<StockItem, 'id'>
  stockMoves!: EntityTable<StockMove, 'id'>
  kv!: EntityTable<KV, 'key'>

  // A name other than the default is only used by tests (e.g. a second
  // "device" in sync simulations).
  constructor(name = 'clinic-register') {
    super(name)
    this.version(1).stores({
      patients: 'id, &opNo, name, phone, updatedAt, deleted',
      visits: 'id, patientId, date, followUpDate, updatedAt, deleted',
      prescriptionItems: 'id, visitId, patientId, remedyId, stockItemId, updatedAt, deleted',
      attachments: 'id, patientId, visitId, blobHash, updatedAt, deleted',
      blobs: 'hash, synced',
      appointments: 'id, patientId, start, status, updatedAt, deleted',
      bills: 'id, &billNo, patientId, visitId, date, dueDate, balance, updatedAt, deleted',
      payments: 'id, billId, patientId, date, updatedAt, deleted',
      remedies: 'id, name, abbrev, updatedAt, deleted',
      stockItems: 'id, remedyId, [remedyId+potency], updatedAt, deleted',
      stockMoves: 'id, stockItemId, reason, updatedAt, deleted',
      kv: 'key',
    })
    // v2: stock moves get a business date (for usage reports) and a refId
    // index so a prescription row's dispense moves can be found.
    this.version(2)
      .stores({ stockMoves: 'id, stockItemId, reason, refId, date, updatedAt, deleted' })
      .upgrade((tx) =>
        tx
          .table('stockMoves')
          .toCollection()
          .modify((m: StockMove) => {
            if (!m.date) m.date = toISODate(new Date(m.createdAt))
          }),
      )
    installChangeTracking(this, SYNCED_TABLES)
  }
}

// Tables that are synced as record sets (everything except blobs and kv).
export const SYNCED_TABLES = [
  'patients',
  'visits',
  'prescriptionItems',
  'attachments',
  'appointments',
  'bills',
  'payments',
  'remedies',
  'stockItems',
  'stockMoves',
] as const

export type SyncedTable = (typeof SYNCED_TABLES)[number]

export const db = new ClinicDB()

// Ask the browser not to evict our data under storage pressure.
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  if (await navigator.storage.persisted()) return true
  return navigator.storage.persist()
}
