import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { db } from '../../db/db'
import { getSettings, saveSettings } from '../../db/repo'
import { createPatient } from '../patients/patientRepo'
import { listRemedies, seedRemedies } from '../remedies/remedyRepo'
import { itemsForVisit, saveVisit } from '../visits/visitRepo'
import { createStockItem, purchase } from './stockRepo'

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

async function remedyId(name: string) {
  return (await listRemedies()).find((r) => r.name === name)!.id
}

type User = ReturnType<typeof userEvent.setup>

async function pickRemedy(user: User, box: HTMLElement, text: string, expected: string) {
  await user.type(box, text)
  await screen.findByRole('option', { name: new RegExp(expected) })
  await user.keyboard('{Enter}')
  expect(box).toHaveValue(expected)
}

const base = { form: 'dilution' as const, unit: 'ml', lowStockAt: 5, price: 2 }

beforeEach(async () => {
  await seedRemedies()
})

describe('stock UI', () => {
  it('adds a stock item with an opening purchase and flags it low', async () => {
    const user = userEvent.setup()
    open('/stock')
    expect(await screen.findByText(/No stock items yet/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add stock item' }))
    const d = within(await screen.findByRole('dialog', { name: 'Add stock item' }))
    await pickRemedy(user, d.getByLabelText('Remedy'), 'Arsen', 'Arsenicum album')
    await user.type(d.getByLabelText('Potency'), '30C')
    await user.selectOptions(d.getByLabelText('Form'), 'globules')
    expect(d.getByLabelText('Unit')).toHaveValue('g')
    await user.type(d.getByLabelText('Opening qty'), '3.5')
    await user.type(d.getByLabelText('Low-stock level'), '5')
    await user.type(d.getByLabelText('Price per g (₹)'), '4')
    await user.click(d.getByRole('button', { name: 'Add item' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const row = await screen.findByTestId('stock-row')
    expect(row).toHaveAttribute('data-status', 'low')
    expect(row).toHaveTextContent('Arsenicum album30CGlobules3.5 gLow5₹4/g')
    const [item] = await db.stockItems.toArray()
    expect(item).toMatchObject({ qty: 3.5, unit: 'g', price: 4, lowStockAt: 5 })
    expect(await db.stockMoves.toArray()).toMatchObject([{ reason: 'purchase', delta: 3.5, note: 'Opening stock' }])

    // Duplicates are rejected in the dialog.
    await user.click(screen.getByRole('button', { name: 'Add stock item' }))
    const d2 = within(await screen.findByRole('dialog', { name: 'Add stock item' }))
    await pickRemedy(user, d2.getByLabelText('Remedy'), 'Arsen', 'Arsenicum album')
    await user.type(d2.getByLabelText('Potency'), '30c')
    await user.selectOptions(d2.getByLabelText('Form'), 'globules')
    await user.click(d2.getByRole('button', { name: 'Add item' }))
    expect(await d2.findByRole('alert')).toHaveTextContent(/already stocked/)
    await user.click(d2.getByRole('button', { name: 'Cancel' }))

    // Filters.
    await user.click(screen.getByRole('button', { name: 'Out or negative' }))
    expect(await screen.findByText('No stock items match.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Low' }))
    expect(await screen.findByTestId('stock-row')).toBeInTheDocument()
    expect(window.location.search).toBe('?filter=low')
  })

  it('dispenses from a visit, warns below stock and the qty drops', async () => {
    const ars = await remedyId('Arsenicum album')
    const item = await createStockItem({ ...base, remedyId: ars, potency: '30C', openingQty: 12 })
    const p = await createPatient({ name: 'Asha' })
    const user = userEvent.setup()
    const { unmount } = open(`/patients/${p.id}/visits/new`)
    await pickRemedy(user, await screen.findByRole('combobox', { name: 'Remedy 1' }), 'Arsen', 'Arsenicum album')
    await user.type(screen.getByLabelText('Potency 1'), '30c')
    // The only matching item is picked automatically.
    await waitFor(() => expect(screen.getByLabelText('Stock item 1')).toHaveValue(item.id))
    expect(screen.getByTestId('available')).toHaveTextContent('12 ml available')
    await user.type(screen.getByLabelText('Quantity 1'), '8')
    expect(screen.getByTestId('dispense-warning')).toHaveTextContent('Low stock: 4 ml will be left')
    await user.clear(screen.getByLabelText('Quantity 1'))
    await user.type(screen.getByLabelText('Quantity 1'), '15')
    expect(screen.getByTestId('dispense-warning')).toHaveTextContent('Only 12 ml left; stock will go to -3')
    await user.click(screen.getByRole('button', { name: 'Save visit' }))

    await screen.findByRole('heading', { name: 'Asha' })
    expect((await db.stockItems.get(item.id))!.qty).toBe(-3)

    // Editing the visit shows availability including this visit's own dispense.
    const [visit] = await db.visits.toArray()
    const [rx] = await itemsForVisit(visit.id)
    expect(rx).toMatchObject({ stockItemId: item.id, qtyDispensed: 15 })
    unmount()
    open(`/patients/${p.id}/visits/${visit.id}`)
    await waitFor(() => expect(screen.getByLabelText('Quantity 1')).toHaveValue('15'))
    expect(screen.getByTestId('available')).toHaveTextContent('12 ml available')
    expect(screen.queryByTestId('dispense-warning')).toHaveTextContent('Only 12 ml left; stock will go to -3')
  })

  it('shows the item history with visit links, purchases, adjusts and writes off', async () => {
    const ars = await remedyId('Arsenicum album')
    const item = await createStockItem({ ...base, remedyId: ars, potency: '200C', openingQty: 30, date: '2026-10-01' })
    const p = await createPatient({ name: 'Ravi' })
    const visitId = await saveVisit({ patientId: p.id, date: '2026-10-02', caseNotes: {}, items: [{ remedyId: ars, potency: '200C', stockItemId: item.id, qtyDispensed: 10 }] })
    await purchase(item.id, 5, 'Supplier A', '2026-10-03')

    const user = userEvent.setup()
    open(`/stock/${item.id}`)
    expect(await screen.findByTestId('stock-qty')).toHaveTextContent('25 ml')
    const rows = await screen.findAllByTestId('move-row')
    // Cells: date, reason (+ details on phones), change, balance, details.
    const cells = (r: HTMLElement) => [...r.querySelectorAll('td')].map((td) => td.textContent)
    expect(rows.map((r) => cells(r).filter((_, i) => i !== 1))).toEqual([
      ['03 Oct 2026', '+5', '25', 'Supplier A'],
      ['02 Oct 2026', '-10', '20', 'Ravi'],
      ['01 Oct 2026', '+30', '30', 'Opening stock'],
    ])
    expect(rows.map((r) => r.querySelector('td:nth-child(2)')!.firstChild!.textContent)).toEqual(['Purchase', 'Dispensed', 'Purchase'])
    for (const link of within(rows[1]).getAllByRole('link', { name: 'Ravi' })) {
      expect(link).toHaveAttribute('href', `/patients/${p.id}/visits/${visitId}`)
    }

    await user.click(screen.getByRole('button', { name: 'Purchase' }))
    let d = within(await screen.findByRole('dialog', { name: 'Add stock' }))
    await user.type(d.getByLabelText('Quantity (ml)'), '10')
    await user.click(d.getByRole('button', { name: 'Add stock' }))
    await waitFor(() => expect(screen.getByTestId('stock-qty')).toHaveTextContent('35 ml'))

    await user.click(screen.getByRole('button', { name: 'Adjust' }))
    d = within(await screen.findByRole('dialog', { name: 'Adjust stock' }))
    await user.type(d.getByLabelText('Counted quantity (ml)'), '33')
    expect(d.getByText('Change: -2 ml')).toBeInTheDocument()
    await user.click(d.getByRole('button', { name: 'Save adjustment' }))
    expect(await d.findByRole('alert')).toHaveTextContent(/reason/)
    await user.type(d.getByLabelText('Reason'), 'Stock count')
    await user.click(d.getByRole('button', { name: 'Save adjustment' }))
    await waitFor(() => expect(screen.getByTestId('stock-qty')).toHaveTextContent('33 ml'))
    await waitFor(() => expect(screen.getAllByTestId('move-row')[0]).toHaveTextContent(/^.*Adjustment.*-233Stock count$/))

    await user.click(screen.getByRole('button', { name: 'Write off' }))
    expect(screen.getByTestId('delete-confirm')).toHaveTextContent('Write off 33 ml and delete Arsenicum album 200C?')
    await user.click(screen.getByRole('button', { name: 'Write off & delete' }))
    expect(await screen.findByRole('heading', { name: 'Stock' })).toBeInTheDocument()
    expect(await db.stockItems.get(item.id)).toMatchObject({ deleted: 1, qty: 0 })
  })

  it('prefills medicine lines when billing a visit', async () => {
    await saveSettings({ ...(await getSettings()), consultationFee: 200 })
    const ars = await remedyId('Arsenicum album')
    const nux = await remedyId('Nux vomica')
    const a = await createStockItem({ ...base, remedyId: ars, potency: '30C', price: 2.5, openingQty: 100 })
    const n = await createStockItem({ ...base, remedyId: nux, potency: '200C', form: 'globules', unit: 'g', price: 0, openingQty: 20 })
    const p = await createPatient({ name: 'Mina' })
    const visitId = await saveVisit({
      patientId: p.id,
      date: '2026-10-02',
      caseNotes: {},
      items: [
        { remedyId: ars, potency: '30C', stockItemId: a.id, qtyDispensed: 10 },
        { remedyId: nux, potency: '200C', stockItemId: n.id, qtyDispensed: 2 },
      ],
    })
    const user = userEvent.setup()
    open(`/patients/${p.id}?bill=${visitId}`)
    const d = within(await screen.findByRole('dialog', { name: 'New bill' }))
    await waitFor(() => expect(d.getAllByTestId('bill-row')).toHaveLength(3))
    expect(d.getByLabelText('Item 1')).toHaveValue('Consultation')
    await waitFor(() => expect(d.getByLabelText('Amount 1')).toHaveValue('200'))
    expect(d.getByLabelText('Item 2')).toHaveValue('Arsenicum album 30C × 10 ml')
    expect(d.getByLabelText('Amount 2')).toHaveValue('25')
    expect(d.getByLabelText('Item 3')).toHaveValue('Nux vomica 200C × 2 g')
    expect(d.getByLabelText('Amount 3')).toHaveValue('')
    expect(d.getByTestId('unpriced-note')).toBeInTheDocument()
    expect(d.getByTestId('bill-total')).toHaveTextContent('₹225')
    await user.click(d.getByRole('button', { name: 'Save bill' }))
    await screen.findByRole('dialog', { name: 'Bill saved' })
    const [bill] = await db.bills.toArray()
    expect(bill.items).toEqual([
      { desc: 'Consultation', amount: 200 },
      { desc: 'Arsenicum album 30C × 10 ml', amount: 25, stockItemId: a.id, qty: 10 },
      { desc: 'Nux vomica 200C × 2 g', amount: 0, stockItemId: n.id, qty: 2 },
    ])
    expect((await db.stockItems.get(a.id))!.qty).toBe(90)
  })

  it('shows the dashboard low-stock card only when something is low', async () => {
    const ars = await remedyId('Arsenicum album')
    const item = await createStockItem({ ...base, remedyId: ars, potency: '30C', openingQty: 50 })
    const { unmount } = open('/')
    await screen.findByRole('heading', { name: 'Dashboard' })
    await screen.findByText('No overdue dues.')
    expect(screen.queryByTestId('low-stock-card')).not.toBeInTheDocument()
    unmount()

    await createStockItem({ ...base, remedyId: ars, potency: '200C', openingQty: 2 })
    await db.stockItems.update(item.id, { lowStockAt: 60 })
    open('/')
    const card = await screen.findByTestId('low-stock-card')
    expect(within(card).getByRole('heading')).toHaveTextContent('Low stock 2')
    expect(within(card).getByRole('link', { name: 'Stock →' })).toHaveAttribute('href', '/stock?filter=low')
    expect(within(card).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Arsenicum album 200C2 ml', 'Arsenicum album 30C50 ml'])
  })

  it('warns before deleting a remedy that has stock', async () => {
    const ars = await remedyId('Arsenicum album')
    await createStockItem({ ...base, remedyId: ars, potency: '30C' })
    const user = userEvent.setup()
    open('/settings?tab=remedies')
    await user.type(await screen.findByLabelText('Search remedies'), 'Arsenicum album')
    await user.click(await screen.findByRole('button', { name: 'Delete Arsenicum album' }))
    expect(await screen.findByText(/1 stock item uses this remedy/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))
    await waitFor(async () => expect((await db.remedies.get(ars))!.deleted).toBe(1))

    // The stock item keeps the remedy name.
    open('/stock')
    expect(await screen.findAllByText('Arsenicum album')).not.toHaveLength(0)
  })
})
