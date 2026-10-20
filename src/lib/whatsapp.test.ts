import { describe, expect, it } from 'vitest'
import { dueReminderLink, fillDueTemplate, whatsappNumber } from './whatsapp'

const patient = { name: 'Asha Menon', opNo: 'OP-2026-00007', phone: '98765 43210' }
const settings = { clinicName: 'Sunrise Homeo & Care', whatsappDueTemplate: 'Dear {name}, ₹{balance} due by {dueDate} at {clinic} ({opNo}).' }

describe('whatsapp reminders', () => {
  it('fills every placeholder and avoids a double rupee sign', () => {
    expect(fillDueTemplate(settings.whatsappDueTemplate, patient, 1250, settings, '2026-11-05')).toBe(
      'Dear Asha Menon, ₹1,250 due by 05 Nov 2026 at Sunrise Homeo & Care (OP-2026-00007).',
    )
    expect(fillDueTemplate('{balance}', patient, 99.5, settings)).toBe('₹99.50')
  })

  it('normalises Indian mobiles to 91XXXXXXXXXX', () => {
    expect(whatsappNumber('+91 98765-43210')).toBe('919876543210')
    expect(whatsappNumber('09876543210')).toBe('919876543210')
    expect(whatsappNumber('919876543210')).toBe('919876543210')
    expect(whatsappNumber('12345')).toBeNull()
    expect(whatsappNumber(undefined)).toBeNull()
  })

  it('builds an encoded wa.me link', () => {
    const url = dueReminderLink(patient, 1250, settings, '2026-11-05')!
    expect(url.startsWith('https://wa.me/919876543210?text=')).toBe(true)
    const text = new URL(url).searchParams.get('text')
    expect(text).toBe('Dear Asha Menon, ₹1,250 due by 05 Nov 2026 at Sunrise Homeo & Care (OP-2026-00007).')
    expect(url).toContain('%26') // "&" must not split the query
    expect(url).not.toContain(' ')
  })

  it('returns null without a valid phone', () => {
    expect(dueReminderLink({ ...patient, phone: undefined }, 100, settings)).toBeNull()
    expect(dueReminderLink({ ...patient, phone: '555' }, 100, settings)).toBeNull()
  })
})
