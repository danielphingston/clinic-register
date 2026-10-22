import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { db } from '../../db/db'
import { saveSettings, DEFAULT_SETTINGS, setBrandingImage } from '../../db/repo'
import { createPatient } from '../patients/patientRepo'
import { addCustomRemedy } from '../remedies/remedyRepo'
import { saveVisit } from '../visits/visitRepo'
import { createCertificate } from './certificateRepo'

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

const PNG = 'data:image/png;base64,iVBORw0KGgo='

describe('certificates UI', () => {
  it('issues a medical certificate and adds the signature only when ticked', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, doctorName: 'Dr. Test', certPlace: 'Ernakulam' })
    await setBrandingImage('signature', PNG)
    const p = await createPatient({ name: 'Deepa', age: 47 })
    const user = userEvent.setup()
    open(`/patients/${p.id}`)

    const card = await screen.findByTestId('patient-certificates')
    await user.click(within(card).getByRole('button', { name: '+ New' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByLabelText('Medical certificate (rest)'))
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Medical Certificate')
    expect(within(dialog).getByLabelText('Place')).toHaveValue('Ernakulam')
    await user.type(within(dialog).getByLabelText('Diagnosis'), 'Disc prolapse')
    expect((within(dialog).getByLabelText('Wording') as HTMLTextAreaElement).value).toContain(
      `Deepa (47 years, OP No. ${p.opNo}) was under my treatment for Disc prolapse`,
    )
    await user.click(within(dialog).getByRole('button', { name: 'Save & print' }))

    expect(await screen.findByRole('heading', { name: 'Medical Certificate' })).toBeInTheDocument()
    expect(screen.getByText(/CERT-\d{4}-00001/)).toBeInTheDocument()
    expect(screen.getByText(/Signature of the candidate/)).toBeInTheDocument()
    const tick = screen.getByRole('checkbox', { name: 'Add signature' })
    expect(tick).not.toBeChecked()
    expect(screen.queryByRole('img', { name: 'Signature' })).not.toBeInTheDocument()
    await user.click(tick)
    expect(screen.getByRole('img', { name: 'Signature' })).toHaveAttribute('src', PNG)
    // No seal uploaded, so no seal option.
    expect(screen.queryByRole('checkbox', { name: 'Add seal' })).not.toBeInTheDocument()
  })

  it('prefills medicines from the latest visit and lists, edits and cancels', async () => {
    const p = await createPatient({ name: 'Sabu' })
    const r = await addCustomRemedy('Allium cepa')
    await saveVisit({ patientId: p.id, date: '2026-02-20', caseNotes: { complaint: 'Allergy' }, items: [{ remedyId: r.id, potency: '200C' }] })
    const user = userEvent.setup()
    open(`/patients/${p.id}`)

    const card = await screen.findByTestId('patient-certificates')
    await user.click(within(card).getByRole('button', { name: '+ New' }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(within(dialog).getByLabelText('Medicines (one per line)')).toHaveValue('Allium cepa 200C'))
    await user.type(within(dialog).getByLabelText('Under treatment for'), 'Allergy')
    await user.click(within(dialog).getByRole('button', { name: 'Save & print' }))
    expect(await screen.findByRole('heading', { name: 'To Whom It May Concern' })).toBeInTheDocument()
    expect(screen.getByText('Allium cepa 200C')).toBeInTheDocument()
    // No signature uploaded: no option to add one.
    expect(screen.queryByRole('checkbox', { name: 'Add signature' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '← Back' }))
    const again = await screen.findByTestId('patient-certificates')
    const [cert] = await db.certificates.toArray()
    await user.click(await within(again).findByRole('button', { name: `Cancel ${cert.certNo}` }))
    await user.click(within(again).getByRole('button', { name: 'Yes, cancel' }))
    expect(await within(again).findByText(/cancelled/)).toBeInTheDocument()
    expect(within(again).queryByRole('button', { name: `Edit ${cert.certNo}` })).not.toBeInTheDocument()
  })

  it('applies the type\'s own letterhead, watermark and candidate line', async () => {
    await saveSettings({
      ...DEFAULT_SETTINGS,
      clinicName: 'Test Clinic',
      address: 'Road 1\nKochi',
      letterheadStyle: 'classic',
      certWatermark: false,
      certTypes: {
        ...DEFAULT_SETTINGS.certTypes,
        medical: { ...DEFAULT_SETTINGS.certTypes.medical, letterheadStyle: 'centered', watermark: 'on', candidateLine: 'top' },
      },
    })
    await setBrandingImage('logo', PNG)
    const p = await createPatient({ name: 'Deepa' })
    const medical = await createCertificate({ kind: 'medical', patientId: p.id, date: '2026-02-22', title: 'Medical Certificate', body: 'Rest.' })
    const medicine = await createCertificate({ kind: 'medicine', patientId: p.id, date: '2026-02-22', title: 'To Whom', body: 'Meds.' })

    const view = open(`/print/certificate/${medical.id}`)
    const heading = await screen.findByRole('heading', { name: 'Medical Certificate' })
    // Centred letterhead joins the address onto one line.
    expect(await screen.findByText('Road 1, Kochi')).toBeInTheDocument()
    expect(document.querySelectorAll('img[src="' + PNG + '"]')).toHaveLength(2) // logo + watermark
    const candidate = screen.getByText(/Signature of the candidate/)
    expect(candidate.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    view.unmount()

    open(`/print/certificate/${medicine.id}`)
    await screen.findByRole('heading', { name: 'To Whom' })
    // Medicine follows the clinic defaults: classic letterhead, no watermark, no candidate line.
    expect(await screen.findByText('Kochi', { exact: false })).toHaveClass('whitespace-pre-line')
    expect(document.querySelectorAll('img[src="' + PNG + '"]')).toHaveLength(1)
    expect(screen.queryByText(/Signature of the candidate/)).not.toBeInTheDocument()
  })
})
