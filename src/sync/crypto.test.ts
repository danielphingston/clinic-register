import { describe, expect, it } from 'vitest'
import { decrypt, deriveKey, encrypt, fromBase64, isEncrypted, KDF_ITERATIONS, makeKeyCheck, newKdfParams, toBase64, verifyKeyCheck, WrongKeyError } from './crypto'

describe('crypto', () => {
  it('derives a non-extractable AES-GCM key with 600k PBKDF2 iterations and a 16-byte salt', async () => {
    const kdf = newKdfParams()
    expect(kdf.iterations).toBe(KDF_ITERATIONS)
    expect(KDF_ITERATIONS).toBe(600_000)
    expect(fromBase64(kdf.salt)).toHaveLength(16)
    const key = await deriveKey('correct horse', kdf)
    expect(key.extractable).toBe(false)
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 })
  })

  it('round-trips with the CRE1 | iv | ciphertext format and a fresh IV per file', async () => {
    const key = await deriveKey('pw-12345678', newKdfParams(1000))
    const plain = new TextEncoder().encode('Ramesh Kumar')
    const a = await encrypt(key, plain)
    const b = await encrypt(key, plain)
    expect(new TextDecoder().decode(a.slice(0, 4))).toBe('CRE1')
    expect(isEncrypted(a)).toBe(true)
    expect(a.length).toBe(4 + 12 + plain.length + 16)
    expect(toBase64(a.slice(4, 16))).not.toBe(toBase64(b.slice(4, 16)))
    expect(new TextDecoder().decode(a)).not.toContain('Ramesh')
    expect(new TextDecoder().decode(await decrypt(key, a))).toBe('Ramesh Kumar')
  })

  it('rejects a wrong passphrase via the key check and on decrypt', async () => {
    const kdf = newKdfParams(1000)
    const right = await deriveKey('right-pass', kdf)
    const wrong = await deriveKey('wrong-pass', kdf)
    const check = await makeKeyCheck(right)
    expect(await verifyKeyCheck(right, check)).toBe(true)
    expect(await verifyKeyCheck(wrong, check)).toBe(false)
    await expect(decrypt(wrong, await encrypt(right, new Uint8Array([1, 2, 3])))).rejects.toBeInstanceOf(WrongKeyError)
  })

  it('base64 helpers round-trip large buffers', () => {
    const big = Uint8Array.from({ length: 100_000 }, (_, i) => (i * 7919) % 256)
    expect(fromBase64(toBase64(big))).toEqual(big)
  })
})
