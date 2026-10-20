import { DriveError, type DriveClient, type DriveFile } from './types'

// In-memory Drive for tests. `hook` runs before every operation so a test can
// inject failures or simulate another device writing mid-sync.
export interface FakeFile extends DriveFile {
  data: Uint8Array
}

export type FakeOp = 'list' | 'getMeta' | 'download' | 'create' | 'update' | 'remove'

export class FakeDrive implements DriveClient {
  files = new Map<string, FakeFile>()
  calls: { op: FakeOp; arg?: string }[] = []
  hook?: (op: FakeOp, arg?: string) => void | Promise<void>
  private nextId = 1

  private async before(op: FakeOp, arg?: string) {
    this.calls.push({ op, arg })
    await this.hook?.(op, arg)
  }

  private meta(f: FakeFile): DriveFile {
    return { id: f.id, name: f.name, version: f.version, modifiedTime: f.modifiedTime, createdTime: f.createdTime, size: f.size }
  }

  private stamp() {
    return new Date().toISOString()
  }

  private get(id: string): FakeFile {
    const f = this.files.get(id)
    if (!f) throw new DriveError(404, 'File not found on Drive')
    return f
  }

  // Ages every file, so grace-period sweeps can be tested.
  age(ms: number) {
    for (const f of this.files.values()) {
      f.modifiedTime = new Date(Date.parse(f.modifiedTime!) - ms).toISOString()
      f.createdTime = new Date(Date.parse(f.createdTime!) - ms).toISOString()
    }
  }

  byName(name: string): FakeFile[] {
    return [...this.files.values()].filter((f) => f.name === name)
  }

  text(name: string): string {
    const f = this.byName(name)[0]
    return f ? new TextDecoder().decode(f.data) : ''
  }

  async list(opts: { name?: string } = {}) {
    await this.before('list', opts.name)
    return [...this.files.values()].filter((f) => !opts.name || f.name === opts.name).map((f) => this.meta(f))
  }

  async getMeta(id: string) {
    await this.before('getMeta', id)
    return this.meta(this.get(id))
  }

  async download(id: string) {
    await this.before('download', id)
    return this.get(id).data.slice()
  }

  async create(name: string, data: Uint8Array) {
    await this.before('create', name)
    const t = this.stamp()
    const f: FakeFile = {
      id: `f${this.nextId++}`,
      name,
      version: '1',
      createdTime: t,
      modifiedTime: t,
      size: String(data.length),
      data: data.slice(),
    }
    this.files.set(f.id, f)
    return this.meta(f)
  }

  async update(id: string, data: Uint8Array) {
    await this.before('update', id)
    const f = this.get(id)
    f.data = data.slice()
    f.version = String(Number(f.version) + 1)
    f.modifiedTime = this.stamp()
    f.size = String(data.length)
    return this.meta(f)
  }

  async remove(id: string) {
    await this.before('remove', id)
    this.files.delete(id)
  }
}
