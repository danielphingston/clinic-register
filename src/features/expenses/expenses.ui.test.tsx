import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { db } from '../../db/db'
import { formatDate, todayISO } from '../../lib/format'
import { createBill } from '../billing/billingRepo'
import { createPatient } from '../patients/patientRepo'
import { saveVisit } from '../visits/visitRepo'
import { dueDateIn, monthName, shiftMonth } from './expenseLogic'
import { addExpense, addRecurring } from './expenseRepo'

vi.mock('../../auth/google', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/google')>()),
  requestToken: vi.fn(),
  fetchProfile: vi.fn(),
  revokeToken: vi.fn().mockResolvedValue(undefined),
}))

// Real compression needs a browser's codecs (covered by E2E); store files as given.
vi.mock('../../lib/compress', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/compress')>()
  return {
    ...actual,
    compressFile: vi.fn(async (file: File) => ({ blob: file, mime: file.type, originalSize: file.size, size: file.size, compressed: false })),
  }
})

vi.setConfig({ testTimeout: 20_000 })

function open(path: string) {
  localStorage.setItem('auth:profile', JSON.stringify({ sub: '1', email: 'd@x.com', name: 'D' }))
  window.history.replaceState(null, '', path)
  return render(<App />)
}

const today = todayISO()
const thisMonth = today.slice(0, 7)
const lastMonth = shiftMonth(thisMonth, -1)

describe('expenses page', () => {
  it('adds an expense with a category chip, mode and note, and shows it in the list and totals', async () => {
    const user = userEvent.setup()
    open('/expenses')
    await user.click(await screen.findByRole('button', { name: '+ Add expense' }))
    const d = within(await screen.findByRole('dialog', { name: 'Add expense' }))
    expect((await d.findAllByRole('radio')).map((r) => r.textContent)).toEqual(['Rent', 'Electricity', 'Supplies', 'Staff (temp)', 'Others'])

    // Nothing chosen yet.
    await user.click(d.getByRole('button', { name: 'Save' }))
    expect(d.getByRole('alert')).toHaveTextContent('Choose a category')

    await user.click(d.getByRole('radio', { name: 'Electricity' }))
    expect(d.getByRole('radio', { name: 'Electricity' })).toHaveAttribute('aria-checked', 'true')
    await user.type(d.getByLabelText('Amount'), '2400')
    await user.selectOptions(d.getByLabelText('Paid via'), 'upi')
    await user.type(d.getByLabelText('Note or vendor (optional)'), 'KSEB bill')
    await user.click(d.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    const list = within(screen.getByTestId('expense-list'))
    expect(await list.findByRole('button', { name: /Electricity.*KSEB bill · UPI.*₹2,400/ })).toBeInTheDocument()
    expect(list.getByRole('heading', { name: formatDate(today) })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('tile-expenses')).toHaveTextContent('₹2,400 fixed'))
    await waitFor(() => expect(screen.getByTestId('tile-net')).toHaveTextContent('-₹2,400'))
    expect(await screen.findByRole('button', { name: /Electricity.*100%/ })).toHaveAttribute('aria-pressed', 'false')
    expect(await db.expenses.toArray()).toMatchObject([{ category: 'electricity', amount: 2400, mode: 'upi', note: 'KSEB bill', date: today }])
  })

  it('asks what an "Others" expense was for', async () => {
    const user = userEvent.setup()
    open('/expenses')
    await user.click(await screen.findByRole('button', { name: '+ Add expense' }))
    const d = within(await screen.findByRole('dialog', { name: 'Add expense' }))
    await user.click(await d.findByRole('radio', { name: 'Others' }))
    await user.type(d.getByLabelText('Amount'), '350')
    await user.click(d.getByRole('button', { name: 'Save' }))
    expect(d.getByRole('alert')).toHaveTextContent('Add a note saying what this was for')
    await user.type(d.getByLabelText('What was it for?'), 'Plumber')
    await user.click(d.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await db.expenses.toArray()).toMatchObject([{ category: 'other', note: 'Plumber', amount: 350 }])
  })

  it('edits an expense, then deletes it after confirming', async () => {
    await addExpense({ date: today, category: 'supplies', amount: 800, mode: 'cash', note: 'Bottles' })
    const user = userEvent.setup()
    open('/expenses')
    await user.click(await screen.findByRole('button', { name: /Supplies.*Bottles/ }))
    let d = within(await screen.findByRole('dialog', { name: 'Edit expense' }))
    expect(d.getByRole('radio', { name: 'Supplies' })).toHaveAttribute('aria-checked', 'true')
    await user.clear(d.getByLabelText('Amount'))
    await user.type(d.getByLabelText('Amount'), '950')
    await user.click(d.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByTestId('tile-expenses')).toHaveTextContent('₹950'))

    await user.click(screen.getByRole('button', { name: /Supplies.*Bottles/ }))
    d = within(await screen.findByRole('dialog', { name: 'Edit expense' }))
    await user.click(d.getByRole('button', { name: 'Delete' }))
    await user.click(within(d.getByRole('group', { name: 'Confirm delete' })).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.getByText('No expenses recorded for this month.')).toBeInTheDocument())
    expect((await db.expenses.toArray())[0].deleted).toBe(1)
  })

  it('attaches a receipt photo when adding, and shows it when the expense is opened', async () => {
    const user = userEvent.setup({ applyAccept: false })
    open('/expenses')
    await user.click(await screen.findByRole('button', { name: '+ Add expense' }))
    const d = within(await screen.findByRole('dialog', { name: 'Add expense' }))
    await user.click(await d.findByRole('radio', { name: 'Supplies' }))
    await user.type(d.getByLabelText('Amount'), '1200')
    await user.upload(d.getByLabelText('Attach receipt'), new File(['receipt'], 'bill.jpg', { type: 'image/jpeg' }))
    expect(within(d.getByRole('list', { name: 'Receipts to attach' })).getByText('bill.jpg')).toBeInTheDocument()
    await user.click(d.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    const row = await screen.findByRole('button', { name: /Supplies.*Receipt attached/ })
    const [expense] = await db.expenses.toArray()
    expect(await db.attachments.toArray()).toMatchObject([{ expenseId: expense.id, patientId: '', fileName: 'bill.jpg' }])
    await user.click(row)
    const edit = within(await screen.findByRole('dialog', { name: 'Edit expense' }))
    expect(await edit.findByRole('button', { name: 'Open Receipt' })).toBeInTheDocument()
  })

  it('steps back through months, and filters by category', async () => {
    await addExpense({ date: dueDateIn(lastMonth, 5), category: 'rent', amount: 15000, mode: 'bank' })
    await addExpense({ date: dueDateIn(lastMonth, 12), category: 'electricity', amount: 2000, mode: 'upi' })
    const user = userEvent.setup()
    open('/expenses')
    expect(await screen.findByTestId('expenses-month')).toHaveTextContent(monthName(thisMonth))
    expect(screen.getByRole('button', { name: /^Next:/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: `Previous: ${monthName(lastMonth)}` }))
    expect(screen.getByTestId('expenses-month')).toHaveTextContent(monthName(lastMonth))
    await waitFor(() => expect(screen.getByTestId('tile-expenses')).toHaveTextContent('₹17,000'))
    expect(window.location.search).toBe(`?month=${lastMonth}`)

    await user.click(await screen.findByRole('button', { name: /^Rent.*88%/ }))
    const list = within(screen.getByTestId('expense-list'))
    await waitFor(() => expect(list.getAllByRole('button')).toHaveLength(1))
    expect(screen.getByText(/Showing Rent only/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show all' }))
    await waitFor(() => expect(list.getAllByRole('button')).toHaveLength(2))
    expect(screen.getByRole('link', { name: 'Profit & loss report →' })).toHaveAttribute('href', `/reports?report=profit&period=month&at=${lastMonth}-01`)
  })

  it('warns when a category is well above its usual level', async () => {
    for (let k = 1; k <= 3; k++) await addExpense({ date: dueDateIn(shiftMonth(thisMonth, -k), 1), category: 'supplies', amount: 1000, mode: 'cash' })
    await addExpense({ date: dueDateIn(thisMonth, 1), category: 'supplies', amount: 2500, mode: 'cash' })
    open('/expenses')
    const alerts = await screen.findByRole('list', { name: 'Spending alerts' })
    expect(alerts).toHaveTextContent('Supplies is 150% above its usual level: ₹2,500 against an average of ₹1,000.')
  })

  it('shows cash in hand today: cash collected less cash spent', async () => {
    const p = await createPatient({ name: 'Asha' })
    await createBill({ patientId: p.id, date: today, items: [{ desc: 'Consultation', amount: 500 }], discount: 0, payNow: { amount: 500, mode: 'cash' } })
    await addExpense({ date: today, category: 'staff', amount: 300, mode: 'cash', note: 'Helper' })
    await addExpense({ date: today, category: 'rent', amount: 9000, mode: 'bank' })
    open('/expenses')
    await waitFor(() => expect(screen.getByTestId('tile-cash')).toHaveTextContent('₹200'))
    expect(screen.getByTestId('tile-cash')).toHaveTextContent('₹500 in · ₹300 out')
  })
})

describe('recurring expenses', () => {
  it('adds a monthly rent, shows it as due, and records the payment with a changed amount', async () => {
    const user = userEvent.setup()
    open('/expenses')
    await user.click(await screen.findByRole('button', { name: '+ Add recurring' }))
    const d = within(await screen.findByRole('dialog', { name: 'Add recurring expense' }))
    expect(await d.findByRole('radio', { name: 'Rent' })).toHaveAttribute('aria-checked', 'true')
    await user.type(d.getByLabelText('Usual amount'), '15000')
    expect(d.getByLabelText('Due on day')).toHaveValue(1)
    expect(d.getByLabelText('Starting')).toHaveValue(thisMonth)
    await user.type(d.getByLabelText('Note or payee (optional)'), 'Landlord')
    await user.click(d.getByRole('button', { name: 'Save' }))

    const due = await screen.findByTestId('expenses-due')
    expect(within(due).getByText(`Rent · ${monthName(thisMonth)}`)).toBeInTheDocument()
    expect(within(due).getByText(/₹15,000 due .* · Landlord/)).toBeInTheDocument()
    expect(within(screen.getByTestId('recurring-card')).getByText(/₹15,000 on day 1 each month · Bank transfer · Landlord/)).toBeInTheDocument()

    await user.click(within(due).getByRole('button', { name: 'Mark paid' }))
    const pay = within(await screen.findByRole('dialog', { name: `Rent for ${monthName(thisMonth)}` }))
    expect(pay.queryByRole('radiogroup', { name: 'Category' })).toBeNull()
    expect(pay.getByLabelText('Amount')).toHaveValue('15000')
    expect(pay.getByLabelText('Paid via')).toHaveValue('bank')
    await user.clear(pay.getByLabelText('Amount'))
    await user.type(pay.getByLabelText('Amount'), '16000')
    await user.click(pay.getByRole('button', { name: 'Mark paid' }))

    await waitFor(() => expect(screen.queryByTestId('expenses-due')).toBeNull())
    expect(await within(screen.getByTestId('expense-list')).findByRole('button', { name: new RegExp(`Rent.*for ${monthName(thisMonth)}.*₹16,000`) })).toBeInTheDocument()
    const [rule] = await db.recurringExpenses.toArray()
    expect(await db.expenses.toArray()).toMatchObject([{ category: 'rent', amount: 16000, recurringId: rule.id, forMonth: thisMonth, note: 'Landlord' }])
  })

  it('skips a month, and pausing stops it showing as due', async () => {
    await addRecurring({ category: 'rent', amount: 15000, day: 1, mode: 'bank', startMonth: lastMonth })
    await addRecurring({ category: 'staff', amount: 4000, day: 1, mode: 'cash', startMonth: thisMonth })
    const user = userEvent.setup()
    open('/expenses')
    const due = await screen.findByTestId('expenses-due')
    await waitFor(() => expect(within(due).getAllByTestId('due-item')).toHaveLength(3))

    await user.click(await within(due).findByRole('button', { name: `Skip Rent for ${monthName(lastMonth)}` }))
    await waitFor(() => expect(within(due).getAllByTestId('due-item')).toHaveLength(2))

    await user.click(screen.getByRole('button', { name: 'Pause Staff (temp)' }))
    await waitFor(() => expect(within(due).getAllByTestId('due-item')).toHaveLength(1))
    expect(within(screen.getByTestId('recurring-card')).getByText('Paused')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Resume Staff (temp)' }))
    await waitFor(() => expect(within(screen.getByTestId('expenses-due')).getAllByTestId('due-item')).toHaveLength(2))
  })

  it('shows due recurring expenses in the reminders bell', async () => {
    await addRecurring({ category: 'rent', amount: 15000, day: 1, mode: 'bank', startMonth: thisMonth })
    const user = userEvent.setup()
    open('/')
    await user.click(await screen.findByRole('button', { name: /Reminders, 1 pending/ }))
    const link = within(screen.getByRole('region', { name: 'Reminders' })).getByRole('link', { name: /Expenses due.*1 recurring expense to record/ })
    expect(link).toHaveAttribute('href', '/expenses')
  })
})

describe('expense categories', () => {
  it('adds a category marked fixed, offers it for new expenses, and removes it', async () => {
    const user = userEvent.setup()
    open('/expenses')
    await user.click(await screen.findByRole('button', { name: 'Categories' }))
    const d = within(await screen.findByRole('dialog', { name: 'Expense categories' }))
    const list = within(await d.findByRole('list', { name: 'Categories' }))
    expect((await list.findAllByText(/built-in/)).map((e) => e.textContent)).toEqual(['Fixed · built-in', 'Fixed · built-in', 'Variable · built-in', 'Variable · built-in', 'Variable · built-in'])
    await user.type(d.getByLabelText('New category'), 'Internet')
    await user.click(d.getByLabelText('Fixed cost'))
    await user.click(d.getByRole('button', { name: 'Add' }))
    expect(await d.findByLabelText('Internet is a fixed cost')).toBeChecked()

    await user.type(d.getByLabelText('New category'), 'rent')
    await user.click(d.getByRole('button', { name: 'Add' }))
    expect(d.getByRole('alert')).toHaveTextContent('Rent is already a category')
    await user.click(d.getByRole('button', { name: 'Close' }))

    await user.click(screen.getByRole('button', { name: '+ Add expense' }))
    let add = within(await screen.findByRole('dialog', { name: 'Add expense' }))
    expect((await add.findAllByRole('radio')).map((r) => r.textContent)).toEqual(['Rent', 'Electricity', 'Supplies', 'Staff (temp)', 'Internet', 'Others'])
    await user.click(add.getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('button', { name: 'Categories' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Expense categories' })).getByRole('button', { name: 'Remove Internet' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: '+ Add expense' }))
    add = within(await screen.findByRole('dialog', { name: 'Add expense' }))
    await waitFor(() => expect(add.queryByRole('radio', { name: 'Internet' })).toBeNull())
  })
})

describe('profit on the dashboard and in reports', () => {
  async function month() {
    const p = await createPatient({ name: 'Asha' })
    await saveVisit({ patientId: p.id, date: today, caseNotes: {}, items: [] })
    await createBill({ patientId: p.id, date: today, items: [{ desc: 'Consultation', amount: 2000 }], discount: 0, payNow: { amount: 1500, mode: 'cash' } })
    await addExpense({ date: today, category: 'supplies', amount: 500, mode: 'cash' })
  }

  it('shows net profit this month on the dashboard, linking to the report', async () => {
    await month()
    open('/')
    const tile = await screen.findByTestId('profit-stat')
    await waitFor(() => expect(tile).toHaveTextContent('₹1,000'))
    expect(tile).toHaveTextContent('Net profit this month')
    expect(tile).toHaveAttribute('href', `/reports?report=profit&period=month&at=${thisMonth}-01`)
  })

  it('switches the Profit & loss report between collected and billed income', async () => {
    await month()
    const user = userEvent.setup()
    open('/reports?report=profit')
    const report = await screen.findByTestId('report-profit')
    expect(screen.getByRole('button', { name: 'Profit & loss', current: 'page' })).toBeInTheDocument()
    expect(screen.getByTestId('period-bar')).toBeInTheDocument()
    expect(within(report).getAllByText('Income (collected)').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Collected' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: 'Billed' }))
    expect((await within(await screen.findByTestId('report-profit')).findAllByText('Income (billed)')).length).toBeGreaterThan(0)
    expect(window.location.search).toContain('basis=billed')
    expect(screen.getByRole('link', { name: 'Print' })).toHaveAttribute('href', expect.stringContaining('/print/report/profit?period=month'))
    expect(screen.getByRole('link', { name: 'Print' })).toHaveAttribute('href', expect.stringContaining('basis=billed'))
    // No category stands out, and the empty table says so.
    expect(screen.getByText('No category is well above its usual level.')).toBeInTheDocument()
  })

  it('prints the Profit & loss report for the period and basis in the URL', async () => {
    await month()
    open(`/print/report/profit?period=month&at=${thisMonth}-01&basis=billed`)
    expect(await screen.findByRole('heading', { name: `Profit & loss: ${monthName(thisMonth)}` })).toBeInTheDocument()
    expect(screen.getByText('Income (billed):').parentElement).toHaveTextContent('₹2,000')
    expect(screen.getByText('Net profit:').parentElement).toHaveTextContent('₹1,500')
    expect(screen.getByText('Expenses by category')).toBeInTheDocument()
    for (const t of ['Cash', 'Spending alerts']) expect(screen.getByRole('heading', { name: t })).toBeInTheDocument()
  })
})
