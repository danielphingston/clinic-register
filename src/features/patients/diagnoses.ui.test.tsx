import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '../../App'
import { db } from '../../db/db'
import { createPatient } from './patientRepo'

function open(path: string) {
  localStorage.setItem('auth:profile', JSON.stringify({ sub: '1', email: 'd@x.com', name: 'D' }))
  window.history.replaceState(null, '', path)
  return render(<App />)
}

describe('patient diagnoses UI', () => {
  it('adds several diagnoses and removes one', async () => {
    const p = await createPatient({ name: 'Deepa' })
    const user = userEvent.setup()
    open(`/patients/${p.id}`)

    const card = await screen.findByTestId('patient-diagnoses')
    const input = within(card).getByLabelText('Add diagnosis')
    await user.type(input, 'Migraine{Enter}')
    await user.type(input, ' migraine {Enter}')
    await user.type(input, 'PCOS')
    await user.click(within(card).getByRole('button', { name: 'Add' }))

    expect(await within(card).findByText('PCOS')).toBeInTheDocument()
    expect(within(card).getAllByText('Migraine')).toHaveLength(1)
    expect((await db.patients.get(p.id))?.diagnoses).toEqual(['Migraine', 'PCOS'])

    await user.click(within(card).getByRole('button', { name: 'Remove Migraine' }))
    await waitFor(() => expect(within(card).queryByText('Migraine')).toBeNull())
    expect((await db.patients.get(p.id))?.diagnoses).toEqual(['PCOS'])
  })
})
