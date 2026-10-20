import { db } from '../db/db'
import { getSettings, insert, saveSettings } from '../db/repo'
import type { Appointment, PaymentMode, Sex, StockForm } from '../db/types'
import { addDays, parseISODate, todayISO } from '../lib/format'
import { createPatient } from '../features/patients/patientRepo'
import { saveVisit, type RxInput } from '../features/visits/visitRepo'
import { createBill, recordPayment } from '../features/billing/billingRepo'
import { createStockItem, purchase } from '../features/stock/stockRepo'
import { medicineLineDesc } from '../features/stock/stockLogic'
import { seedRemedies, seedRemedyId } from '../features/remedies/remedyRepo'

// Dev-only demo data, built through the app's own repo functions so stock
// moves, bill numbers and balances are consistent. Deterministic for a seed.

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NAMES: [string, Sex, number][] = [
  ['Lakshmi Narayanan', 'F', 54], ['Arjun Menon', 'M', 32], ['Priya Raman', 'F', 27], ['Mohammed Rafi', 'M', 45],
  ['Anitha George', 'F', 38], ['Suresh Kumar', 'M', 61], ['Divya Pillai', 'F', 8], ['Rahul Nair', 'M', 15],
  ['Fathima Beevi', 'F', 67], ['Joseph Thomas', 'M', 72], ['Meera Krishnan', 'F', 22], ['Vishnu Prasad', 'M', 41],
  ['Sneha Varghese', 'F', 5], ['Gopal Iyer', 'M', 58], ['Asha Devi', 'F', 49], ['Kiran Das', 'M', 19],
  ['Neha Sharma', 'F', 33], ['Abdul Kareem', 'M', 64], ['Revathi S', 'F', 12], ['Anand Babu', 'O', 29],
]
const COMPLAINTS = ['Fever and cold', 'Recurrent headache', 'Eczema on hands', 'Acidity after meals', 'Joint pain, worse morning', 'Cough at night', 'Anxiety, poor sleep', 'Hair fall', 'Allergic rhinitis', 'Menstrual cramps', 'Warts', 'Constipation']
const RX: [string, string][] = [
  ['Arsenicum album', '30C'], ['Pulsatilla nigricans', '200C'], ['Nux vomica', '30C'], ['Sulphur', '200C'], ['Belladonna', '30C'],
  ['Bryonia alba', '30C'], ['Rhus toxicodendron', '200C'], ['Lycopodium clavatum', '1M'], ['Calcarea carbonica', '200C'], ['Natrum muriaticum', '200C'],
]
const STOCK: [string, string, StockForm, string, number, number, number][] = [
  // remedy, potency, form, unit, opening, lowAt, price per unit
  ['Arsenicum album', '30C', 'dilution', 'ml', 120, 20, 2],
  ['Nux vomica', '30C', 'dilution', 'ml', 100, 20, 2],
  ['Pulsatilla nigricans', '200C', 'dilution', 'ml', 60, 15, 3],
  ['Sulphur', '200C', 'dilution', 'ml', 40, 15, 3],
  ['Belladonna', '30C', 'globules', 'g', 50, 10, 4],
  ['Bryonia alba', '30C', 'dilution', 'ml', 30, 10, 2],
  ['Rhus toxicodendron', '200C', 'dilution', 'ml', 25, 10, 3],
]
const MODES: PaymentMode[] = ['cash', 'cash', 'cash', 'upi', 'upi', 'card', 'other']

export interface SeedResult {
  patients: number
  visits: number
  bills: number
  payments: number
  appointments: number
  stockItems: number
}

export async function seedDemoData({ days = 90, seed = 42, today = todayISO() } = {}): Promise<SeedResult> {
  const rand = rng(seed)
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]
  await seedRemedies()
  const settings = await getSettings()
  await saveSettings({ ...settings, clinicName: settings.clinicName || 'Demo Homoeo Clinic', doctorName: settings.doctorName || 'Dr. Demo', consultationFee: settings.consultationFee || 300 })
  const fee = (await getSettings()).consultationFee
  const start = addDays(today, -days)
  const out: SeedResult = { patients: 0, visits: 0, bills: 0, payments: 0, appointments: 0, stockItems: 0 }

  const stock = new Map<string, { id: string; unit: string; price: number }>()
  for (const [name, potency, form, unit, opening, lowStockAt, price] of STOCK) {
    const item = await createStockItem({ remedyId: seedRemedyId(name), potency, form, unit, lowStockAt, price, openingQty: opening, date: addDays(start, -5) })
    stock.set(`${name}|${potency}`, { id: item.id, unit, price })
    out.stockItems++
  }

  const patients = []
  for (const [i, [name, sex, age]] of NAMES.entries()) {
    patients.push(await createPatient({ name, sex, age, ageAsOf: today, phone: `98${String(47000000 + i * 1371).padStart(8, '0')}`, address: 'Kochi' }))
    out.patients++
  }

  // Each patient starts on a random day, then returns every 1–4 weeks.
  for (const p of patients) {
    let date = addDays(start, Math.floor(rand() * days * 0.6))
    let complaint = pick(COMPLAINTS)
    while (date <= today) {
      const n = 1 + Math.floor(rand() * 2)
      const items: RxInput[] = []
      const lines: { desc: string; amount: number; stockItemId?: string; qty?: number }[] = [{ desc: 'Consultation', amount: fee }]
      for (let k = 0; k < n; k++) {
        const [rem, potency] = pick(RX)
        if (items.some((it) => it.remedyId === seedRemedyId(rem))) continue
        const s = stock.get(`${rem}|${potency}`)
        const qty = s ? 5 + Math.floor(rand() * 3) * 5 : undefined
        items.push({ remedyId: seedRemedyId(rem), potency, dose: '4 pills', repetition: pick(['OD', 'BD', 'TDS']), durationDays: 7, stockItemId: s?.id, qtyDispensed: qty })
        if (s && qty) lines.push({ desc: medicineLineDesc(rem, potency, qty, s.unit), amount: qty * s.price, stockItemId: s.id, qty })
      }
      const next = addDays(date, 7 + Math.floor(rand() * 21))
      const visitId = await saveVisit({
        patientId: p.id,
        date,
        caseNotes: { complaint },
        followUpDate: next,
        items,
      })
      out.visits++
      if (rand() < 0.3) complaint = pick(COMPLAINTS)

      // Booked appointment (most visits) or walk-in.
      const hour = 9 + Math.floor(rand() * 4)
      const at = parseISODate(date).getTime() + hour * 3600_000 + Math.floor(rand() * 4) * 15 * 60_000
      const walk = rand() < 0.3
      await insert<Appointment>(db.appointments, { patientId: p.id, start: at, end: at + 15 * 60_000, status: 'done', notes: walk ? 'Walk-in' : undefined })
      out.appointments++

      const discount = rand() < 0.15 ? 50 : 0
      const total = lines.reduce((s, l) => s + l.amount, 0) - discount
      const r = rand()
      const payNow = r < 0.7 ? total : r < 0.85 ? Math.round(total / 2) : 0
      const { payment } = await createBill({
        patientId: p.id,
        visitId,
        date,
        items: lines,
        discount,
        dueDate: addDays(date, 15),
        payNow: payNow ? { amount: payNow, mode: pick(MODES) } : undefined,
      }).then(async (res) => {
        out.bills++
        // Some partial payers settle a few days later.
        const later = addDays(date, 3 + Math.floor(rand() * 10))
        if (res.bill.balance > 0 && rand() < 0.5 && later <= today) {
          await recordPayment(res.bill.id, res.bill.balance, pick(MODES), later)
          out.payments++
        }
        return res
      })
      if (payment) out.payments++
      date = next
    }
    // Missed appointments and cancellations sprinkled in the past.
    if (rand() < 0.5) {
      const d = addDays(start, Math.floor(rand() * days))
      const at = parseISODate(d).getTime() + 17 * 3600_000
      await insert<Appointment>(db.appointments, { patientId: p.id, start: at, end: at + 15 * 60_000, status: rand() < 0.6 ? 'no-show' : 'cancelled' })
      out.appointments++
    }
  }

  // Restock mid-range, and a few bookings later today.
  for (const [i, s] of [...stock.values()].entries()) if (i % 2 === 0) await purchase(s.id, 50, 'Supplier invoice', addDays(start, Math.floor(days / 2)))
  const base = parseISODate(today).getTime()
  for (let k = 0; k < 3; k++) {
    const at = base + (18 + k) * 3600_000
    await insert<Appointment>(db.appointments, { patientId: patients[k].id, start: at, end: at + 15 * 60_000, status: 'booked' })
    out.appointments++
  }
  return out
}
