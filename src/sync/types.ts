import type { SyncedTable } from '../db/db'

export interface DriveFile {
  id: string
  name: string
  // Drive's monotonically increasing file version (a string of digits).
  version?: string
  modifiedTime?: string
  createdTime?: string
  size?: string
}

// The subset of Drive v3 the sync engine uses, always inside appDataFolder.
// Implemented by the REST client (drive.ts) and an in-memory fake for tests.
export interface DriveClient {
  list(opts?: { name?: string }): Promise<DriveFile[]>
  getMeta(id: string): Promise<DriveFile>
  download(id: string): Promise<Uint8Array>
  create(name: string, data: Uint8Array, mimeType?: string): Promise<DriveFile>
  update(id: string, data: Uint8Array, mimeType?: string): Promise<DriveFile>
  remove(id: string): Promise<void>
}

export class DriveError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'DriveError'
  }
}

export type SyncTableName = SyncedTable | 'kv'

export interface ManifestTableEntry {
  rev: number
  updatedAt: number
  // Each push writes a new file, so the file id doubles as a content id: a
  // device compares it with the id it last saw to decide whether to pull.
  fileId: string
}

export interface Manifest {
  schema: 1
  appVersion: string
  encrypted: boolean
  // Bumped when every file is rewritten (encryption on/off, passphrase
  // change); blob names carry it so old and new sets never collide.
  gen: number
  kdf?: { salt: string; iterations: number }
  keyCheck?: string
  tables: Partial<Record<SyncTableName, ManifestTableEntry>>
  lastWriter: { deviceId: string; deviceName: string; at: number }
}

export interface LockInfo {
  deviceId: string
  deviceName: string
  since: number
  heartbeat: number
}

export interface RenumberNotice {
  at: number
  table: 'patients' | 'bills' | 'certificates'
  id: string
  from: string
  to: string
}
