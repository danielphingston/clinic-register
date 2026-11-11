import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { createPatient } from '../patients/patientRepo'
import { saveVisit } from '../visits/visitRepo'
import { createBill } from '../billing/billingRepo'
import { seedRemedies, seedRemedyId } from '../remedies/remedyRepo'
import { addDays, formatDate, todayISO } from '../../lib/format'
import { periodLabel, periodOf, shiftPeriod } from '../../lib/period'

vi.mock('../../auth/google', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/google')>()),
  requestToken: vi.fn(),
  fetchProfile: vi.fn(),
  revokeToken: vi.fn().mockResolvedValue(undefined),
}))
// Recharts needs layout; the chart itself is not under test here.
vi.mock('./ReportChart', () => ({ default: ({ spec }: { spec: { title: string } }) => <div data-testid="chart">{spec.title}</div> }))
const exportSpy = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('./excel', async (importOriginal) => ({ ...(await importOriginal<typeof import('./excel')>()), exportReportToExcel: exportSpy }))

vi.setConfig({ testTimeout: 20_000 })

function open(path: string) {
  localStorage.setItem('auth:profile', JSON.stringify({ sub: '1', email: 'd@x.com', name: 'D' }))
  window.history.replaceState(null, '', path)
  return render(<App />)
}

const today = todayISO()

async function data() {
  await seedRemedies()
  const p = await createPatient({ name: 'Asha', sex: 'F', age: 30 })
  const v = await saveVisit({ patientId: p.id, date: today, caseNotes: { complaint: 'Migraine' }, items: [{ remedyId: seedRemedyId('Sulphur'), potency: '200C' }] })
  await createBill({ patientId: p.id, visitId: v, date: today, items: [{ desc: 'Consultation', amount: 400 }], discount: 0, payNow: { amount: 250, mode: 'upi' } })
  return p
}

describe('reports page', () => {
  it('shows the OP register for this month by default and keeps state in the URL', async () => {
    const user = userEvent.setup()
    await data()
    open('/reports')
    const report = await screen.findByTestId('report-op-register')
    const table = within(report).getByRole('table')
    expect(within(table).getByRole('link', { name: 'Asha' })).toBeInTheDocument()
    expect(within(table).getByText('Migraine')).toBeInTheDocument()
    expect(within(table).getByText('Sulphur 200C')).toBeInTheDocument()
    expect(within(table).getAllByText('₹400').length).toBeGreaterThan(0)
    expect(screen.getByTestId('tile-Visits')).toHaveTextContent('1')

    await user.click(screen.getByRole('button', { name: 'Revenue' }))
    await screen.findByTestId('report-revenue')
    expect(screen.getByTestId('tile-Billed')).toHaveTextContent('₹400')
    expect(screen.getByTestId('tile-Collected')).toHaveTextContent('₹250')
    expect(await screen.findByTestId('chart')).toHaveTextContent('Billed vs collected')
    expect(window.location.search).toBe('?report=revenue&range=thisMonth')

    await user.selectOptions(screen.getByLabelText('Range'), 'yesterday')
    expect(screen.getByTestId('range-label')).toHaveTextContent(formatDate(addDays(today, -1)))
    await waitFor(() => expect(screen.getByTestId('tile-Billed')).toHaveTextContent('₹0'))

    await user.selectOptions(screen.getByLabelText('Range'), 'custom')
    expect(window.location.search).toContain('range=custom&from=')
    expect(screen.getByLabelText('From')).toBeInTheDocument()

    expect(screen.getByRole('link', { name: 'Print' })).toHaveAttribute('href', expect.stringMatching(/^\/print\/report\/revenue\?from=\d{4}-\d{2}-\d{2}&to=/))
    await user.click(screen.getByRole('button', { name: 'Export to Excel' }))
    expect(exportSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'revenue' }), '')
  })

  it('restores the report and custom range from the URL', async () => {
    await data()
    open(`/reports?report=top-remedies&range=custom&from=${today}&to=${today}`)
    const report = await screen.findByTestId('report-top-remedies')
    expect(within(report).getByRole('cell', { name: 'Sulphur' })).toBeInTheDocument()
    expect(screen.getByLabelText('From')).toHaveValue(today)
    expect(screen.getByRole('button', { name: 'Top remedies' })).toHaveAttribute('aria-current', 'page')
  })

  it('prints a report with the letterhead and a repeating table header', async () => {
    await data()
    open(`/print/report/op-register?from=${today}&to=${today}`)
    expect(await screen.findByRole('heading', { name: 'OP Register' })).toBeInTheDocument()
    expect(document.querySelector('style')?.textContent).toContain('A4 landscape')
    expect(document.querySelector('table.report-table thead')).not.toBeNull()
    expect(screen.queryByRole('link', { name: 'Asha' })).toBeNull() // no links on paper
    expect(screen.getByText('Asha')).toBeInTheDocument()
  })

  it('shows trends for the current month with comparisons, and steps through periods', async () => {
    const user = userEvent.setup()
    await data()
    // Last month's first day always falls inside the like-for-like comparison.
    const month = periodOf('month', today)
    const last = shiftPeriod(month, -1)
    const b = await createPatient({ name: 'Bala' })
    await saveVisit({ patientId: b.id, date: last.start, caseNotes: {}, items: [] })
    await createBill({ patientId: b.id, date: last.start, items: [{ desc: 'Consultation', amount: 100 }], discount: 0, payNow: { amount: 100, mode: 'cash' } })

    open('/reports?report=trends')
    await screen.findByTestId('report-trends')
    expect(screen.getByRole('button', { name: 'Trends' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('period-label')).toHaveTextContent(periodLabel(month))
    expect(screen.getByRole('button', { name: 'Month' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^Next:/ })).toBeDisabled()
    expect(screen.queryByLabelText('Range')).toBeNull()

    expect(screen.getByTestId('tile-Visits')).toHaveTextContent('1')
    expect(screen.getByTestId('tile-Collected')).toHaveTextContent('₹250')
    const [vsLast, vsYear] = screen.getAllByTestId('tile-Collected-vs')
    expect(vsLast).toHaveTextContent(`up 150% vs ${periodLabel(last)}`) // ₹250 against ₹100
    expect(vsLast).toHaveAttribute('title', `${periodLabel(last)}: ₹100`)
    expect(vsYear).toHaveTextContent(`— vs ${periodLabel(shiftPeriod(month, -12))}`) // nothing a year back
    expect(screen.getAllByTestId('tile-Visits-vs')[0]).toHaveTextContent('± 0%')
    expect(screen.getAllByTestId('tile-New patients-vs')[0]).toHaveTextContent('± 0%')
    const charts = await screen.findAllByTestId('chart')
    expect(charts.map((c) => c.textContent)).toEqual(['Visits per day', 'Collected per day'])
    for (const t of ['Patients compared', 'Collections compared', 'Per day', 'Collections by mode']) {
      expect(screen.getByRole('heading', { name: new RegExp(`^${t} \\(`) })).toBeInTheDocument()
    }
    expect(screen.getByRole('link', { name: 'Print' })).toHaveAttribute('href', `/print/report/trends?period=month&at=${month.start}`)

    await user.click(screen.getByRole('button', { name: 'Quarter' }))
    expect(window.location.search).toBe(`?report=trends&period=quarter&at=${periodOf('quarter', today).start}`)
    expect(screen.getByTestId('period-label')).toHaveTextContent(periodLabel(periodOf('quarter', today)))
    expect((await screen.findAllByTestId('chart'))[0]).toHaveTextContent('Visits per week')

    await user.selectOptions(screen.getByLabelText('Year'), 'fy')
    expect(window.location.search).toContain('&fy=1')
    expect(screen.getByTestId('period-label')).toHaveTextContent(/^Q\d FY \d{4}–\d\d/)

    await user.click(screen.getByRole('button', { name: 'Year' }))
    const fy = periodOf('year', today, true)
    expect(screen.getByTestId('period-label')).toHaveTextContent(periodLabel(fy))
    await user.click(screen.getByRole('button', { name: `Previous: ${periodLabel(shiftPeriod(fy, -1))}` }))
    expect(screen.getByTestId('period-label')).toHaveTextContent(periodLabel(shiftPeriod(fy, -1)))
    await waitFor(() => expect(screen.getByTestId('tile-Visits')).toHaveTextContent('0'))
    expect(screen.getByRole('button', { name: /^Next:/ })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Current' }))
    expect(screen.getByTestId('period-label')).toHaveTextContent(periodLabel(fy))
    expect(screen.queryByRole('button', { name: 'Current' })).toBeNull()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Export to Excel' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Export to Excel' }))
    await waitFor(() => expect(exportSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'trends', title: `Trends: ${periodLabel(fy)}` }), ''))
  })

  it('prints the trends report for the period in the URL', async () => {
    await data()
    const month = periodOf('month', today)
    open(`/print/report/trends?period=month&at=${month.start}`)
    expect(await screen.findByRole('heading', { name: `Trends: ${periodLabel(month)}` })).toBeInTheDocument()
    expect(screen.getByText('Patients compared')).toBeInTheDocument()
    expect(screen.getByText('Collections by mode')).toBeInTheDocument()
  })

  it('rejects a bad print URL', async () => {
    open('/print/report/nope?from=x&to=y')
    expect(await screen.findByText('Unknown report or date range.')).toBeInTheDocument()
  })
})
