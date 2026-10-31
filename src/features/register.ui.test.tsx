import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { db } from '../db/db'
import { saveSettings, getSettings } from '../db/repo'
import { addDays, formatDate, todayISO } from '../lib/format'
import { createPatient } from './patients/patientRepo'
import { RemedyAutocomplete } from './remedies/RemedyAutocomplete'
import { listRemedies, seedRemedies } from './remedies/remedyRepo'
import { itemsForVisit, saveVisit, visitsForPatient } from './visits/visitRepo'

vi.mock('../auth/google', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth/google')>()),
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

const year = new Date().getFullYear()

async function remedyId(name: string) {
  return (await listRemedies()).find((r) => r.name === name)!.id
}

// Types into the nth remedy combobox and picks the highlighted suggestion.
async function pickRemedy(user: ReturnType<typeof userEvent.setup>, n: number, text: string, expected: string) {
  const box = screen.getByRole('combobox', { name: `Remedy ${n}` })
  await user.type(box, text)
  await screen.findByRole('option', { name: new RegExp(expected) })
  await user.keyboard('{Enter}')
  expect(box).toHaveValue(expected)
}

beforeEach(async () => {
  await seedRemedies()
})

describe('patients UI', () => {
  it('creates a patient with validation, OP number and age from DOB', async () => {
    const user = userEvent.setup()
    open('/patients/new')
    await user.click(await screen.findByRole('button', { name: 'Save patient' }))
    expect(await screen.findByText('Name is required')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Name *'), 'Asha Menon')
    await user.type(screen.getByLabelText('Date of birth'), '1990-01-15')
    expect(screen.getByLabelText('Age (years)')).toHaveValue(new Date().getFullYear() - 1990 - (todayISO().slice(5) < '01-15' ? 1 : 0))
    await user.selectOptions(screen.getByLabelText('Sex'), 'F')
    await user.type(screen.getByLabelText('Phone'), '12345')
    await user.click(screen.getByRole('button', { name: 'Save patient' }))
    expect(await screen.findByText('Enter a 10-digit Indian mobile number')).toBeInTheDocument()

    await user.clear(screen.getByLabelText('Phone'))
    await user.type(screen.getByLabelText('Phone'), '+91 98765 43210')
    await user.click(screen.getByRole('button', { name: 'Save patient' }))

    expect(await screen.findByRole('heading', { name: 'Asha Menon' })).toBeInTheDocument()
    expect(screen.getByText(`OP-${year}-00001`)).toBeInTheDocument()
    expect(screen.getByText(/9876543210/)).toBeInTheDocument()
    expect(await screen.findByTestId('patient-attachments')).toBeInTheDocument()
    expect(screen.queryByTestId('slot-attachments')).not.toBeInTheDocument()
    expect(screen.queryByTestId('slot-dues')).not.toBeInTheDocument()
    expect(screen.getByTestId('patient-dues')).toBeInTheDocument()
    expect(screen.getByTestId('patient-appointments')).toBeInTheDocument()
    const [p] = await db.patients.toArray()
    expect(p).toMatchObject({ name: 'Asha Menon', dob: '1990-01-15', sex: 'F', phone: '9876543210' })
  })

  it('typing an age clears the DOB and stores age only', async () => {
    const user = userEvent.setup()
    open('/patients/new')
    await user.type(await screen.findByLabelText('Name *'), 'Ravi')
    await user.type(screen.getByLabelText('Date of birth'), '1990-01-15')
    await user.clear(screen.getByLabelText('Age (years)'))
    await user.type(screen.getByLabelText('Age (years)'), '42')
    expect(screen.getByLabelText('Date of birth')).toHaveValue('')
    expect(screen.getByText(`Born around ${year - 42}`)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save patient' }))
    await screen.findByRole('heading', { name: 'Ravi' })
    const [p] = await db.patients.toArray()
    expect(p.dob).toBeUndefined()
    expect(p.age).toBe(42)
  })

  it('lists and searches patients by name, phone and OP no', async () => {
    const user = userEvent.setup()
    await createPatient({ name: 'Asha Menon', phone: '9876543210' })
    await createPatient({ name: 'Ravi Kumar', phone: '9123456780' })
    open('/patients')
    const rows = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[1].textContent)
    await waitFor(() => expect(rows()).toEqual(['Ravi Kumar', 'Asha Menon']))

    const search = screen.getByRole('searchbox', { name: 'Search patients' })
    await user.type(search, '98765')
    await waitFor(() => expect(rows()).toEqual(['Asha Menon']))
    await user.clear(search)
    await user.type(search, `OP-${year}-00002`)
    await waitFor(() => expect(rows()).toEqual(['Ravi Kumar']))
    await user.clear(search)
    await user.type(search, 'nobody')
    expect(await screen.findByText('No patients match your search.')).toBeInTheDocument()
  })

  it('edits and soft-deletes a patient after an in-page confirmation', async () => {
    const user = userEvent.setup()
    const p = await createPatient({ name: 'Asha' })
    open(`/patients/${p.id}/edit`)
    const name = await screen.findByLabelText('Name *')
    await user.clear(name)
    await user.type(name, 'Asha M')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('heading', { name: 'Asha M' })).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Edit' }))
    await user.click(await screen.findByRole('button', { name: 'Delete patient…' }))
    await user.click(screen.getByRole('button', { name: 'Keep patient' }))
    expect(await db.patients.get(p.id)).toMatchObject({ deleted: 0 })
    await user.click(screen.getByRole('button', { name: 'Delete patient…' }))
    await user.click(screen.getByRole('button', { name: 'Yes, delete patient' }))

    expect(await screen.findByText(/No patients yet/)).toBeInTheDocument()
    expect(await db.patients.get(p.id)).toMatchObject({ deleted: 1 })
  })

  it('takes an OP number on create and lets it be edited, rejecting duplicates', async () => {
    const user = userEvent.setup()
    const other = await createPatient({ name: 'Ravi' })
    open('/patients/new')
    await user.type(await screen.findByLabelText('Name *'), 'Asha')
    const opNo = screen.getByLabelText('OP / Reg. no')
    await user.type(opNo, other.opNo)
    await user.click(screen.getByRole('button', { name: 'Save patient' }))
    expect(await screen.findByText('OP no is already used by Ravi')).toBeInTheDocument()
    expect(opNo).toHaveFocus()

    await user.clear(opNo)
    await user.type(opNo, 'REG-101')
    await user.click(screen.getByRole('button', { name: 'Save patient' }))
    expect(await screen.findByRole('heading', { name: 'Asha' })).toBeInTheDocument()
    expect(screen.getByText('REG-101')).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Edit' }))
    const edit = await screen.findByLabelText('OP / Reg. no *')
    expect(edit).toHaveValue('REG-101')
    await user.clear(edit)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('OP no is required')).toBeInTheDocument()
    await user.type(edit, 'REG-102')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('REG-102')).toBeInTheDocument()
    expect((await db.patients.toArray()).map((p) => p.opNo).sort()).toEqual([other.opNo, 'REG-102'].sort())
  })
})

describe('visit UI', () => {
  it('records a visit with 3 remedies, then edits it and removes one', async () => {
    const user = userEvent.setup()
    const p = await createPatient({ name: 'Asha' })
    open(`/patients/${p.id}/visits/new`)

    expect(await screen.findByLabelText('Visit date')).toHaveValue(todayISO())
    await user.type(screen.getByRole('textbox', { name: 'Complaint 1' }), 'Migraine')
    await user.click(screen.getByRole('tab', { name: 'Mentals' }))
    await user.type(screen.getByRole('textbox', { name: 'Mentals' }), 'Anxious')

    await pickRemedy(user, 1, 'ars', 'Arsenicum album')
    await user.type(screen.getByLabelText('Potency 1'), '30C')
    await user.type(screen.getByLabelText('Dose 1'), '4 pills')
    await user.type(screen.getByLabelText('Repetition 1'), 'TDS')
    await user.type(screen.getByLabelText('Days 1'), '7')
    await user.click(screen.getByRole('button', { name: '+ Add remedy' }))
    await pickRemedy(user, 2, 'puls', 'Pulsatilla nigricans')
    await user.type(screen.getByLabelText('Potency 2'), '200C')
    await user.click(screen.getByRole('button', { name: '+ Add remedy' }))
    await pickRemedy(user, 3, 'nux-v', 'Nux vomica')
    await user.type(screen.getByLabelText('Potency 3'), '1M')
    await user.click(screen.getByRole('button', { name: '+7d' }))
    expect(screen.getByLabelText('Follow-up date')).toHaveValue(addDays(todayISO(), 7))
    await user.type(screen.getByLabelText('Advice'), 'No coffee')
    await user.click(screen.getByRole('button', { name: 'Save visit' }))

    const visit = await screen.findByTestId('visit')
    expect(within(visit).getByText('Migraine')).toBeInTheDocument()
    expect(within(visit).getByText('Arsenicum album')).toBeInTheDocument()
    expect(within(visit).getByText('4 pills · TDS · 7 days', { exact: false })).toBeInTheDocument()
    expect(within(visit).getByText('Nux vomica')).toBeInTheDocument()
    const [v] = await visitsForPatient(p.id)
    expect(v.caseNotes).toEqual({ complaint: 'Migraine', complaints: ['Migraine'], mentals: 'Anxious' })
    expect(v.advice).toBe('No coffee')

    await user.click(within(visit).getByRole('link', { name: 'Open' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Remedy 3' })).toHaveValue('Nux vomica'))
    await user.click(screen.getByRole('button', { name: 'Remove row 2' }))
    expect(screen.getAllByTestId('rx-row')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Save visit' }))

    const edited = await screen.findByTestId('visit')
    await waitFor(() => expect(within(edited).queryByText('Pulsatilla nigricans')).not.toBeInTheDocument())
    expect((await itemsForVisit(v.id)).map((i) => i.potency)).toEqual(['30C', '1M'])
    const all = await db.prescriptionItems.where('visitId').equals(v.id).toArray()
    expect(all.filter((i) => i.deleted === 1).map((i) => i.remedyId)).toEqual([await remedyId('Pulsatilla nigricans')])
  })

  it('records complaint lines and generals, then tracks their status at a follow-up', async () => {
    const user = userEvent.setup()
    const p = await createPatient({ name: 'Asha' })
    open(`/patients/${p.id}/visits/new`)

    await user.type(await screen.findByRole('textbox', { name: 'Complaint 1' }), 'Headache')
    await user.click(screen.getByRole('button', { name: 'Add complaint' }))
    await user.type(screen.getByRole('textbox', { name: 'Complaint 2' }), 'Cough{Enter}')
    expect(screen.getByRole('textbox', { name: 'Complaint 3' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Remove complaint 3' }))
    expect(screen.queryByRole('textbox', { name: 'Complaint 3' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Generals' }))
    const pill = (group: string, name: string) => within(screen.getByRole('group', { name: group })).getByRole('button', { name })
    await user.click(pill('Appetite', 'Decreased'))
    await user.click(pill('Urine', 'Frequent micturition'))
    await user.click(pill('Urine', 'Normal'))
    expect(pill('Urine', 'Frequent micturition')).toHaveAttribute('aria-pressed', 'false')
    await user.click(pill('Stool', 'Constipation'))
    await user.type(screen.getByLabelText('Constipation days'), '3')
    await user.click(pill('Sweat', 'Increased'))
    await user.type(screen.getByLabelText('Body part(s)'), 'palms')
    await user.click(pill('Thirst', 'Increased'))
    await user.click(pill('Thirst', 'Increased'))
    expect(pill('Thirst', 'Increased')).toHaveAttribute('aria-pressed', 'false')
    await user.click(screen.getByRole('button', { name: 'Save visit' }))

    const visit = await screen.findByTestId('visit')
    expect(within(visit).getByTestId('visit-generals')).toHaveTextContent('Appetite: Decreased · Urine: Normal · Stool: Constipation (every 3 days) · Sweat: Increased (palms)')
    const [first] = await visitsForPatient(p.id)
    expect(first.caseNotes).toEqual({
      complaint: 'Headache\nCough',
      complaints: ['Headache', 'Cough'],
      generalsChecklist: { appetite: 'decreased', urine: ['normal'], stool: 'constipation', constipationDays: 3, sweat: 'increased', sweatParts: 'palms' },
    })

    await user.click(screen.getByRole('link', { name: 'New visit' }))
    expect(await screen.findByRole('heading', { name: 'Previous complaints' })).toBeInTheDocument()
    const headache = screen.getByRole('group', { name: 'Headache' })
    expect(within(screen.getByRole('group', { name: 'Cough' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Persists', 'Better', 'Worsened', 'Resolved'])
    await user.click(within(headache).getByRole('button', { name: 'Better' }))
    expect(within(headache).getByRole('button', { name: 'Better' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Save visit' }))

    await waitFor(async () => expect(await visitsForPatient(p.id)).toHaveLength(2))
    const [latest] = await visitsForPatient(p.id)
    expect(latest.caseNotes.complaintStatus).toEqual([{ complaint: 'Headache', status: 'better' }])
    expect((await screen.findAllByTestId('visit-statuses'))[0]).toHaveTextContent('Headache — Better')
  })

  it('asks before leaving a visit with unsaved changes', async () => {
    const user = userEvent.setup()
    const p = await createPatient({ name: 'Asha' })
    open(`/patients/${p.id}/visits/new`)
    // An untouched form leaves freely.
    await user.click(await screen.findByRole('link', { name: 'Cancel' }))
    expect(await screen.findByRole('heading', { name: 'Asha' })).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'New visit' }))
    await user.type(await screen.findByRole('textbox', { name: 'Complaint 1' }), 'Headache')
    await user.click(screen.getByRole('link', { name: 'Cancel' }))
    const dialog = await screen.findByRole('dialog', { name: 'Leave without saving?' })
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByRole('textbox', { name: 'Complaint 1' })).toHaveValue('Headache')

    await user.click(screen.getByRole('link', { name: 'Cancel' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Leave without saving?' })).getByRole('button', { name: 'Discard changes' }))
    expect(await screen.findByRole('heading', { name: 'Asha' })).toBeInTheDocument()
    expect(await db.visits.count()).toBe(0)
  })

  it('blocks saving a row without a remedy', async () => {
    const user = userEvent.setup()
    const p = await createPatient({ name: 'Asha' })
    open(`/patients/${p.id}/visits/new`)
    await user.type(await screen.findByLabelText('Potency 1'), '30C')
    await user.click(screen.getByRole('button', { name: 'Save visit' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Row 1: choose a remedy')
    expect(await db.visits.count()).toBe(0)
  })

  it('repeats the last prescription on a follow-up visit', async () => {
    const user = userEvent.setup()
    const p = await createPatient({ name: 'Asha' })
    const ars = await remedyId('Arsenicum album')
    const sulph = await remedyId('Sulphur')
    await saveVisit({
      patientId: p.id,
      date: addDays(todayISO(), -14),
      caseNotes: { complaint: 'Cold' },
      items: [
        { remedyId: ars, potency: '30C', repetition: 'TDS', durationDays: 7 },
        { remedyId: sulph, potency: '200C', repetition: 'Weekly' },
      ],
    })
    open(`/patients/${p.id}/visits/new`)

    const prev = await screen.findByTestId('prev-rx')
    expect(within(prev).getByText('Sulphur')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Repeat last prescription' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Remedy 2' })).toHaveValue('Sulphur'))
    expect(screen.getByRole('combobox', { name: 'Remedy 1' })).toHaveValue('Arsenicum album')
    expect(screen.getByLabelText('Potency 2')).toHaveValue('200C')
    await user.click(screen.getByRole('button', { name: 'Save visit' }))

    await waitFor(async () => expect(await visitsForPatient(p.id)).toHaveLength(2))
    const [latest, first] = await visitsForPatient(p.id)
    expect((await itemsForVisit(latest.id)).map((i) => [i.remedyId, i.potency])).toEqual([
      [ars, '30C'],
      [sulph, '200C'],
    ])
    expect(await itemsForVisit(first.id)).toHaveLength(2)
  })
})

describe('RemedyAutocomplete', () => {
  function Harness() {
    const [id, setId] = useState('')
    return (
      <>
        <RemedyAutocomplete label="Remedy" value={id} onChange={setId} />
        <output data-testid="picked">{id}</output>
      </>
    )
  }

  it('is keyboard navigable with prefix matches first', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const box = screen.getByRole('combobox', { name: 'Remedy' })
    await user.type(box, 'ar')
    const options = await screen.findAllByRole('option')
    expect(options[0]).toHaveTextContent('Aralia racemosa')
    expect(options.slice(0, 5).every((o) => /^Ar/.test(o.textContent!))).toBe(true)
    expect(options[0]).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}')
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
    expect(box).toHaveAttribute('aria-activedescendant', options[1].id)
    const second = (await listRemedies()).find((r) => options[1].textContent!.startsWith(r.name))!
    await user.keyboard('{Enter}')
    expect(box).toHaveValue(second.name)
    expect(screen.getByTestId('picked')).toHaveTextContent(second.id)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    // Abbreviation search; Escape closes the list and blurring reverts unpicked text.
    await user.clear(box)
    await user.type(box, 'calc-p')
    await screen.findByRole('option', { name: /Calcarea phosphorica/ })
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    await user.tab()
    expect(box).toHaveValue(second.name)

    // Emptying the box clears the selection.
    await user.clear(box)
    await user.tab()
    expect(screen.getByTestId('picked').textContent).toBe('')
  })
})

describe('settings: remedies', () => {
  it('adds, searches, edits and deletes a custom remedy', async () => {
    const user = userEvent.setup()
    open('/settings?tab=remedies')
    await user.type(await screen.findByLabelText('New remedy name'), 'Covid nosode')
    await user.type(screen.getByLabelText('Abbreviation'), 'Cov-n.')
    await user.click(screen.getByRole('button', { name: 'Add remedy' }))

    const section = screen.getByRole('region', { name: 'Remedies' })
    await waitFor(() => expect(within(section).getByRole('searchbox')).toHaveValue('Covid nosode'))
    expect(await within(section).findByText('custom')).toBeInTheDocument()
    expect(within(section).getByRole('searchbox')).toHaveValue('Covid nosode')

    await user.click(within(section).getByRole('button', { name: 'Edit Covid nosode' }))
    const nameBox = within(section).getByRole('textbox', { name: 'Remedy name' })
    await user.clear(nameBox)
    await user.type(nameBox, 'Covid nosode B')
    await user.click(within(section).getByRole('button', { name: 'Update' }))
    expect(await within(section).findByText('Covid nosode B')).toBeInTheDocument()

    await user.click(within(section).getByRole('button', { name: 'Delete Covid nosode B' }))
    await user.click(within(section).getByRole('button', { name: 'Confirm delete' }))
    await waitFor(() => expect(within(section).queryByText('Covid nosode B')).not.toBeInTheDocument())
    const custom = (await db.remedies.toArray()).find((r) => r.isCustom === 1)
    expect(custom).toMatchObject({ name: 'Covid nosode B', deleted: 1 })
  })
})

describe('printing', () => {
  it('renders the Rx on the letterhead without app chrome and prints on demand', async () => {
    const user = userEvent.setup()
    await saveSettings({ ...(await getSettings()), clinicName: 'Sunrise Homeo', doctorName: 'Dr Rao', qualification: 'BHMS', regNo: 'KL-123' })
    const p = await createPatient({ name: 'Asha', age: 30, sex: 'F' })
    const id = await saveVisit({
      patientId: p.id,
      date: '2026-10-20',
      caseNotes: { complaint: 'Cold' },
      advice: 'Rest',
      followUpDate: '2026-10-27',
      items: [{ remedyId: await remedyId('Arsenicum album'), potency: '30C', dose: '4 pills', repetition: 'TDS', durationDays: 7 }],
    })
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    open(`/print/rx/${id}`)

    expect(await screen.findByText('Sunrise Homeo')).toBeInTheDocument()
    expect(screen.getByText('Dr Rao, BHMS')).toBeInTheDocument()
    expect(screen.getByText('Arsenicum album')).toBeInTheDocument()
    expect(screen.getByText('7 days')).toBeInTheDocument()
    expect(screen.getByText(p.opNo)).toBeInTheDocument()
    expect(screen.getByText('27 Oct 2026')).toBeInTheDocument()
    expect(screen.getByText('Rest')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Dashboard/ })).not.toBeInTheDocument()
    expect(print).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Print' }))
    expect(print).toHaveBeenCalledOnce()
  })

  it('renders the OP slip with a QR code of the OP number', async () => {
    const p = await createPatient({ name: 'Asha', phone: '9876543210' })
    open(`/print/op-slip/${p.id}`)
    expect(await screen.findByTestId('op-no')).toHaveTextContent(p.opNo)
    expect(screen.getByText(formatDate(todayISO()))).toBeInTheDocument()
    const img = await screen.findByRole('img', { name: `QR code for ${p.opNo}` })
    expect(img.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
  })
})

describe('dashboard lists', () => {
  it('shows recent patients and follow-ups due', async () => {
    const today = todayISO()
    const a = await createPatient({ name: 'Asha' })
    const b = await createPatient({ name: 'Ravi' })
    await saveVisit({ patientId: a.id, date: addDays(today, -7), caseNotes: {}, followUpDate: today, items: [] })
    await saveVisit({ patientId: b.id, date: addDays(today, -30), caseNotes: {}, followUpDate: addDays(today, -3), items: [] })
    open('/')

    const due = await screen.findByRole('region', { name: 'Follow-ups due' })
    await waitFor(() => expect(within(due).getAllByRole('listitem')).toHaveLength(2))
    expect(within(due).getAllByRole('listitem')[0]).toHaveTextContent(`Ravi`)
    expect(within(due).getAllByRole('listitem')[0]).toHaveTextContent('Overdue')
    expect(within(due).getAllByRole('listitem')[1]).toHaveTextContent('Today')

    const recent = screen.getByRole('region', { name: 'Recent patients' })
    await waitFor(() => expect(within(recent).getAllByRole('link').map((l) => l.textContent)).toEqual(['Asha', 'Ravi']))
    expect(within(recent).getAllByRole('link')[0]).toHaveAttribute('href', `/patients/${a.id}`)
  })
})
