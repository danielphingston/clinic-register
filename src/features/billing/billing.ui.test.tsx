import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { db } from '../../db/db'
import { getSettings, saveSettings } from '../../db/repo'
import { addDays, formatDate, todayISO } from '../../lib/format'
import { createPatient } from '../patients/patientRepo'
import { createBill, recordPayment } from './billingRepo'
import { addCustomRemedy } from '../remedies/remedyRepo'
import { createStockItem } from '../stock/stockRepo'

vi.mock('../../auth/google', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/google')>()),
  requestToken: vi.fn(),
  fetchProfile: vi.fn(),
  revokeToken: vi.fn().mockResolvedValue(undefined),
}))

vi.setConfig({ testTimeout: 20_000 })

function open(path: string) {
  localStorage.setItem('auth:profile', JSON.stringify({ sub: '1', email: 'd@x.com', name: 'D' }))
  window.history.replaceState(null, '', path)
  return render(<App />)
}

const today = todayISO()
const year = today.slice(0, 4)
const item = (amount: number, desc = 'Consultation') => ({ desc, amount })

describe('billing UI', () => {
  it('bills from a visit with the consultation fee, pays in full and offers the receipt', async () => {
    await saveSettings({ ...(await getSettings()), consultationFee: 300 })
    const p = await createPatient({ name: 'Asha', phone: '9876543210' })
    const user = userEvent.setup()
    open(`/patients/${p.id}/visits/new`)
    await user.click(await screen.findByRole('button', { name: 'Save & bill' }))

    const dialog = await screen.findByRole('dialog', { name: 'New bill' })
    const d = within(dialog)
    await waitFor(() => expect(d.getByLabelText('Amount 1')).toHaveValue('300'))
    expect(d.getByLabelText('Item 1')).toHaveValue('Consultation')
    await user.click(d.getByRole('button', { name: '+ Medicines' }))
    expect(d.getByLabelText('Item 2')).toHaveValue('Medicines')
    await user.type(d.getByLabelText('Amount 2'), '150')
    await user.type(d.getByLabelText('Discount'), '50')
    expect(d.getByTestId('bill-total')).toHaveTextContent('₹400')
    expect(d.getByLabelText('Due date')).toHaveValue(addDays(today, 30))
    await user.click(d.getByRole('button', { name: 'Full' }))
    await user.selectOptions(d.getByLabelText('Payment mode'), 'upi')
    expect(d.getByTestId('bill-balance')).toHaveTextContent('₹0')
    expect(d.queryByLabelText('Due date')).not.toBeInTheDocument()
    await user.click(d.getByRole('button', { name: 'Save bill' }))

    const saved = await screen.findByRole('dialog', { name: 'Bill saved' })
    expect(within(saved).getByText(`BILL-${year}-00001`)).toBeInTheDocument()
    const [pay] = await db.payments.toArray()
    expect(within(saved).getByRole('link', { name: 'Print receipt' })).toHaveAttribute('href', `/print/receipt/${pay.id}`)
    const [bill] = await db.bills.toArray()
    const [visit] = await db.visits.toArray()
    expect(bill).toMatchObject({ visitId: visit.id, total: 400, paid: 400, balance: 0, discount: 50 })
    expect(pay).toMatchObject({ amount: 400, mode: 'upi' })

    await user.click(within(saved).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(window.location.search).toBe('')
    const dues = screen.getByTestId('patient-dues')
    expect(within(dues).getByTestId('patient-balance')).toHaveTextContent('₹0')
    expect(await within(dues).findByTestId('patient-bill')).toHaveTextContent(`BILL-${year}-00001`)
    expect(within(dues).getByTestId('patient-payment')).toHaveTextContent(`RCPT-${year}-00001`)
  })

  it('rejects invalid bills in the dialog', async () => {
    const p = await createPatient({ name: 'Ravi' })
    const user = userEvent.setup()
    open(`/patients/${p.id}`)
    await user.click(await screen.findByRole('button', { name: 'New bill' }))
    const d = within(await screen.findByRole('dialog', { name: 'New bill' }))
    await user.type(d.getByLabelText('Item 1'), 'Consultation')
    await user.click(d.getByRole('button', { name: 'Save bill' }))
    expect(await d.findByRole('alert')).toHaveTextContent('above zero')
    await user.type(d.getByLabelText('Amount 1'), '200')
    await user.type(d.getByLabelText('Amount paid now'), '250')
    await user.click(d.getByRole('button', { name: 'Save bill' }))
    expect(await d.findByRole('alert')).toHaveTextContent('exceeds')
    expect(await db.bills.count()).toBe(0)
  })

  it('collects a payment across bills from the profile (FIFO)', async () => {
    const p = await createPatient({ name: 'Meena', phone: '9876543210' })
    const { bill: b1 } = await createBill({ patientId: p.id, date: addDays(today, -40), items: [item(300)], discount: 0, dueDate: addDays(today, -10) })
    const { bill: b2 } = await createBill({ patientId: p.id, date: addDays(today, -5), items: [item(200)], discount: 0 })
    const user = userEvent.setup()
    open(`/patients/${p.id}`)
    const dues = await screen.findByTestId('patient-dues')
    await waitFor(() => expect(within(dues).getByTestId('patient-balance')).toHaveTextContent('₹500'))
    expect(within(dues).getByText(/overdue/)).toBeInTheDocument()
    const wa = (await within(dues).findAllByRole('link', { name: 'WhatsApp reminder to Meena' }))[0]
    expect(wa).toHaveAttribute('target', '_blank')
    expect(wa.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/)
    expect(decodeURIComponent(wa.getAttribute('href')!)).toContain('₹500')

    await user.click(within(dues).getByRole('button', { name: 'Collect payment' }))
    const d = within(await screen.findByRole('dialog', { name: 'Collect payment' }))
    await waitFor(() => expect(d.getByTestId('collect-max')).toHaveTextContent('₹500'))
    await user.type(d.getByLabelText('Amount'), '350')
    await user.click(d.getByRole('button', { name: 'Record payment' }))
    const done = await screen.findByTestId('payment-done')
    expect(done).toHaveTextContent('Split across 2 bills')
    expect(within(done).getAllByRole('link', { name: 'Print receipt' })).toHaveLength(2)
    expect((await db.bills.get(b1.id))!.balance).toBe(0)
    expect((await db.bills.get(b2.id))!.balance).toBe(150)
    await user.click(within(done).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(within(dues).getByTestId('patient-balance')).toHaveTextContent('₹150'))
  })

  it('billing page: tiles, filters, void confirm and the dues list with remind-all', async () => {
    const a = await createPatient({ name: 'Paid Patient', phone: '9000000001' })
    const b = await createPatient({ name: 'Partial Patient', phone: '9000000002' })
    const c = await createPatient({ name: 'Late Patient', phone: '9000000003' })
    const d0 = await createPatient({ name: 'Nophone Late' })
    await createBill({ patientId: a.id, date: today, items: [item(500)], discount: 0, payNow: { amount: 500, mode: 'cash' } })
    const { bill: partial } = await createBill({ patientId: b.id, date: today, items: [item(400)], discount: 0 })
    await recordPayment(partial.id, 150, 'upi')
    await createBill({ patientId: c.id, date: addDays(today, -70), items: [item(1000)], discount: 0, dueDate: addDays(today, -40) })
    const { bill: voidMe } = await createBill({ patientId: d0.id, date: addDays(today, -20), items: [item(80)], discount: 0, dueDate: addDays(today, -2) })

    const user = userEvent.setup()
    open('/billing')
    await waitFor(() => expect(screen.getByTestId('tile-collection')).toHaveTextContent('₹650'))
    expect(screen.getByTestId('tile-collection')).toHaveTextContent('Cash ₹500 · UPI ₹150')
    await waitFor(() => expect(screen.getByTestId('tile-outstanding')).toHaveTextContent('₹1,330'))
    await waitFor(() => expect(screen.getByTestId('tile-overdue')).toHaveTextContent('₹1,080'))
    expect(screen.getByTestId('tile-overdue')).toHaveTextContent('2 bills')
    const ageing = await screen.findByTestId('ageing-table')
    expect(within(ageing).getByText('31–60 days').closest('tr')).toHaveTextContent('₹1,000')

    // jsdom ignores the md: breakpoint, so table rows and cards both render; use the rows.
    await waitFor(() => expect(screen.getAllByTestId('bill-row-item')).toHaveLength(4))
    await user.click(screen.getByRole('button', { name: 'Overdue', pressed: false }))
    await waitFor(() => expect(screen.getAllByTestId('bill-row-item')).toHaveLength(2))
    await user.click(screen.getByRole('button', { name: 'Partial' }))
    await waitFor(() => expect(screen.getAllByTestId('bill-row-item')).toHaveLength(1))
    await user.click(screen.getByRole('button', { name: 'All' }))
    await user.type(screen.getByLabelText('Search bills'), 'nophone')
    await waitFor(() => expect(screen.getAllByTestId('bill-row-item')).toHaveLength(1))
    const row = screen.getAllByTestId('bill-row-item')[0]
    await user.click(within(row).getByRole('button', { name: 'Void' }))
    await user.click(within(row).getByRole('button', { name: 'Keep' }))
    await user.click(within(row).getByRole('button', { name: 'Void' }))
    await user.click(within(row).getByRole('button', { name: 'Yes, void' }))
    await waitFor(() => expect(screen.getByText('No bills match these filters.')).toBeInTheDocument())
    expect((await db.bills.get(voidMe.id))!.deleted).toBe(1)

    // A bill with payments cannot be voided directly.
    await user.clear(screen.getByLabelText('Search bills'))
    await user.type(screen.getByLabelText('Search bills'), 'partial patient')
    await waitFor(() => expect(screen.getAllByTestId('bill-row-item')).toHaveLength(1))
    await user.click(within(screen.getAllByTestId('bill-row-item')[0]).getByRole('button', { name: 'Void' }))
    expect(within(screen.getAllByTestId('bill-row-item')[0]).getByRole('alert')).toHaveTextContent('Reverse the payments')

    await user.click(screen.getByRole('link', { name: 'Dues' }))
    await waitFor(() => expect(screen.getAllByTestId('due-row')).toHaveLength(2))
    const rows = screen.getAllByTestId('due-row')
    expect(rows[0]).toHaveTextContent('Late Patient')
    expect(rows[0]).toHaveTextContent('40 days overdue')
    expect(rows[1]).toHaveTextContent('Partial Patient')

    await user.click(screen.getByRole('button', { name: 'Remind all overdue (1)' }))
    const step = await screen.findByTestId('remind-step')
    expect(within(step).getByTestId('remind-name')).toHaveTextContent('Late Patient')
    const link = within(step).getByRole('link', { name: 'WhatsApp reminder to Late Patient' })
    expect(link.getAttribute('href')).toContain('wa.me/919000000003')
    link.addEventListener('click', (e) => e.preventDefault())
    await user.click(link)
    await user.click(within(step).getByRole('button', { name: 'Next' }))
    expect(await screen.findByTestId('remind-done')).toHaveTextContent('opened for 1 of 1')
  })

  it('dashboard shows collection, outstanding and overdue dues', async () => {
    const p = await createPatient({ name: 'Overdue Olga' })
    await createBill({ patientId: p.id, date: addDays(today, -50), items: [item(700)], discount: 0, dueDate: addDays(today, -15), payNow: { amount: 100, mode: 'card' } })
    const { bill } = await createBill({ patientId: p.id, date: today, items: [item(250)], discount: 0 })
    await recordPayment(bill.id, 50, 'cash', today)
    open('/')
    await waitFor(() => expect(screen.getByText("Today's collection").nextSibling).toHaveTextContent('₹50'))
    await waitFor(() => expect(screen.getByText('Outstanding dues').nextSibling).toHaveTextContent('₹800'))
    const card = screen.getByTestId('overdue-card')
    await waitFor(() => expect(card).toHaveTextContent('Overdue Olga'))
    expect(card).toHaveTextContent('₹800')
    expect(card).toHaveTextContent('15d overdue')
    expect(within(card).getByRole('link', { name: /Billing/ })).toHaveAttribute('href', '/billing/dues')
  })

  it('prints a receipt with the amount in words', async () => {
    const p = await createPatient({ name: 'Print Me' })
    const { bill, payment } = await createBill({ patientId: p.id, date: today, items: [item(2000)], discount: 0, payNow: { amount: 1250, mode: 'cash' } })
    open(`/print/receipt/${payment!.id}`)
    expect(await screen.findByTestId('receipt-words')).toHaveTextContent('Rupees One Thousand Two Hundred Fifty Only')
    expect(screen.getByTestId('receipt-no')).toHaveTextContent(`RCPT-${year}-00001`)
    expect(screen.getByTestId('receipt-balance')).toHaveTextContent('₹750')
    expect(screen.getByText(`${bill.billNo} (${formatDate(today)})`)).toBeInTheDocument()
    expect(screen.getByText(p.opNo)).toBeInTheDocument()
  })

  it('prints a bill', async () => {
    const p = await createPatient({ name: 'Bill Print' })
    const { bill } = await createBill({ patientId: p.id, date: today, items: [item(300), item(120, 'Medicines')], discount: 20, dueDate: addDays(today, 10) })
    open(`/print/bill/${bill.id}`)
    expect(await screen.findByTestId('bill-print-total')).toHaveTextContent('₹400')
    expect(screen.getByTestId('bill-print-balance')).toHaveTextContent('₹400')
    expect(screen.getByText('Medicines')).toBeInTheDocument()
    expect(screen.getByText(formatDate(addDays(today, 10)))).toBeInTheDocument()
  })

  it('adds a medicine from stock as a counter sale that deducts stock', async () => {
    const ars = await addCustomRemedy('Arsenicum album')
    const item = await createStockItem({ remedyId: ars.id, potency: '30C', form: 'dilution', unit: 'ml', lowStockAt: 5, price: 2.5, openingQty: 50 })
    const p = await createPatient({ name: 'Asha' })
    const user = userEvent.setup()
    open(`/patients/${p.id}`)
    await user.click(await screen.findByRole('button', { name: 'New bill' }))
    const d = within(await screen.findByRole('dialog', { name: 'New bill' }))
    await user.click(d.getByRole('button', { name: '+ Medicine from stock' }))
    await user.type(d.getByLabelText('Find medicine in stock'), 'ars 30')
    await user.click(await d.findByRole('button', { name: /Arsenicum album 30C/ }))
    await user.type(d.getByLabelText('Quantity (ml)'), '4')
    expect(d.getByTestId('sale-amount')).toHaveTextContent('₹10')
    await user.click(d.getByRole('button', { name: 'Add to bill' }))
    expect(d.getByLabelText('Item 1')).toHaveValue('Arsenicum album 30C × 4 ml')
    expect(d.getByLabelText('Amount 1')).toHaveValue('10')
    expect(d.getByTestId('sale-note')).toHaveTextContent('takes 4 out of stock')
    await user.click(d.getByRole('button', { name: 'Save bill' }))
    await screen.findByRole('dialog', { name: 'Bill saved' })
    const [bill] = await db.bills.toArray()
    expect(bill.items).toEqual([{ desc: 'Arsenicum album 30C × 4 ml', amount: 10, stockItemId: item.id, qty: 4, sale: true }])
    expect((await db.stockItems.get(item.id))?.qty).toBe(46)
  })
  it('fills the blank row instead of adding another, and focuses what to fill next', async () => {
    const p = await createPatient({ name: 'Mira' })
    const user = userEvent.setup()
    open(`/patients/${p.id}`)
    await user.click(await screen.findByRole('button', { name: 'New bill' }))
    const d = within(await screen.findByRole('dialog', { name: 'New bill' }))
    expect(d.getAllByTestId('bill-row')).toHaveLength(1)

    await user.click(d.getByRole('button', { name: '+ Medicines' }))
    expect(d.getAllByTestId('bill-row')).toHaveLength(1)
    expect(d.getByLabelText('Item 1')).toHaveValue('Medicines')
    expect(d.getByLabelText('Amount 1')).toHaveFocus()

    await user.click(d.getByRole('button', { name: '+ Item' }))
    expect(d.getAllByTestId('bill-row')).toHaveLength(2)
    expect(d.getByLabelText('Item 2')).toHaveFocus()
    // The new row is still blank, so "+ Item" goes back to it.
    await user.click(d.getByRole('button', { name: '+ Item' }))
    expect(d.getAllByTestId('bill-row')).toHaveLength(2)
    expect(d.getByLabelText('Item 2')).toHaveFocus()
  })
})
