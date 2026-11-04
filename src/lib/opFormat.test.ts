import { describe, expect, it } from 'vitest'
import { opFormatHint, opFormatOf, opNumberParser, opScope, renderOpNo, splitOpNo, validateOpFormat } from './opFormat'

const nov2026 = new Date(2026, 10, 4)

describe('OP number formats', () => {
  it('renders the tokens', () => {
    expect(renderOpNo('{YY}{N:4}', nov2026, 183)).toBe('260183')
    expect(renderOpNo('OP-{YYYY}-{N:5}', nov2026, 183)).toBe('OP-2026-00183')
    expect(renderOpNo('{YYYY}/{N}', nov2026, 7)).toBe('2026/7')
    expect(renderOpNo('{YY}{MM}{N:3}', nov2026, 5)).toBe('2611005')
    expect(renderOpNo('{N}', nov2026, 12345)).toBe('12345')
    // Padding is a minimum, not a limit.
    expect(renderOpNo('{YY}{N:4}', nov2026, 12345)).toBe('2612345')
  })

  it('validates', () => {
    expect(validateOpFormat('{YY}{N:4}')).toBeNull()
    expect(validateOpFormat('{N}')).toBeNull()
    expect(validateOpFormat('OP-{YYYY}')).toMatch(/running number/)
    expect(validateOpFormat('{N}-{N}')).toMatch(/once/)
    expect(validateOpFormat('{DD}{N}')).toMatch(/Unknown placeholder \{DD\}/)
    expect(validateOpFormat('{N')).toMatch(/Unmatched/)
  })

  it('hints when an unpadded number touches other digits', () => {
    expect(opFormatHint('{YY}{N}')).toMatch(/Padding/)
    expect(opFormatHint('{YY}-{N}')).toBeNull()
    expect(opFormatHint('{YY}{N:4}')).toBeNull()
  })

  it('scopes restart the number with the date tokens', () => {
    expect(opScope('{YY}{N:4}', nov2026)).toBe('26{N:4}')
    expect(opScope('{YY}{N:4}', new Date(2027, 0, 1))).toBe('27{N:4}')
    expect(opScope('{N}', nov2026)).toBe('{N}')
  })

  it('reads the running number back in the current scope only', () => {
    const read = opNumberParser('{YY}{N:4}', nov2026)
    expect(read('260183')).toBe(183)
    expect(read('2612345')).toBe(12345)
    expect(read('270183')).toBeUndefined()
    expect(read('OP-2026-00183')).toBeUndefined()
    expect(read('2600183')).toBeUndefined() // over-long padding: not made by this format
    expect(opNumberParser('op-{YYYY}-{N:5}', nov2026)('OP-2026-00009')).toBe(9)
  })

  it('splits a number of any date into scope and number', () => {
    const s = splitOpNo('{YY}{N:4}', '250042')!
    expect(s.scope).toBe('25{N:4}')
    expect(s.n).toBe(42)
    expect(s.make(43)).toBe('250043')
    expect(splitOpNo('{YY}{N:4}', 'X-1')).toBeUndefined()
  })

  it('migrates the old prefix setting', () => {
    expect(opFormatOf({ opPrefix: 'HC' })).toBe('HC-{YYYY}-{N:5}')
    expect(opFormatOf({ opPrefix: 'HC', opFormat: '{N}' })).toBe('{N}')
    expect(opFormatOf(undefined)).toBe('OP-{YYYY}-{N:5}')
  })
})
