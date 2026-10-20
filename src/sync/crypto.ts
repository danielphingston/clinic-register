// Drive backup encryption (WebCrypto only).
// File format: "CRE1" | 12-byte IV | AES-GCM ciphertext (with its tag).

export const KDF_ITERATIONS = 600_000
const MAGIC = new TextEncoder().encode('CRE1')
const KEY_CHECK_TEXT = 'clinic-register key check v1'

export class WrongKeyError extends Error {
  constructor() {
    super('Wrong passphrase')
  }
}

export interface KdfParams {
  salt: string // base64
  iterations: number
}

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

export function newKdfParams(iterations = KDF_ITERATIONS): KdfParams {
  return { salt: toBase64(crypto.getRandomValues(new Uint8Array(16))), iterations }
}

// Non-extractable: the key can be stored in IndexedDB and used, but its raw
// bytes can never be read back out.
export async function deriveKey(passphrase: string, kdf: KdfParams): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase.normalize('NFC')), 'PBKDF2', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: fromBase64(kdf.salt), iterations: kdf.iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export function isEncrypted(data: Uint8Array): boolean {
  return data.length >= 4 && MAGIC.every((b, i) => data[i] === b)
}

export async function encrypt(key: CryptoKey, data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data as Uint8Array<ArrayBuffer>))
  const out = new Uint8Array(MAGIC.length + iv.length + ct.length)
  out.set(MAGIC, 0)
  out.set(iv, MAGIC.length)
  out.set(ct, MAGIC.length + iv.length)
  return out
}

export async function decrypt(key: CryptoKey, data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  if (!isEncrypted(data)) throw new Error('File is not encrypted')
  const iv = data.slice(4, 16)
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data.slice(16)))
  } catch {
    throw new WrongKeyError()
  }
}

export async function makeKeyCheck(key: CryptoKey): Promise<string> {
  return toBase64(await encrypt(key, new TextEncoder().encode(KEY_CHECK_TEXT)))
}

export async function verifyKeyCheck(key: CryptoKey, keyCheck: string): Promise<boolean> {
  try {
    const plain = await decrypt(key, fromBase64(keyCheck))
    return new TextDecoder().decode(plain) === KEY_CHECK_TEXT
  } catch {
    return false
  }
}
