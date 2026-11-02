import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '../../App'
import { db } from '../../db/db'
import { createPatient } from '../patients/patientRepo'
import { saveVisit } from './visitRepo'

function open(path: string) {
  localStorage.setItem('auth:profile', JSON.stringify({ sub: '1', email: 'd@x.com', name: 'D' }))
  window.history.replaceState(null, '', path)
  return render(<App />)
}

describe('delete visit UI', () => {
  it('deletes from the visit page after confirming and returns to the patient page', async () => {
    const p = await createPatient({ name: 'Deepa' })
    const id = await saveVisit({ patientId: p.id, date: '2026-09-01', caseNotes: { complaint: 'Cough' }, items: [] })
    const user = userEvent.setup()
    open(`/patients/${p.id}/visits/${id}`)

    await user.click(await screen.findByRole('button', { name: 'Delete visit' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/Delete this visit from .*returned to stock/)
    await user.click(within(dialog).getByRole('button', { name: 'Delete visit' }))

    expect(await screen.findByRole('heading', { name: 'Visits' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryAllByTestId('visit')).toHaveLength(0))
    expect((await db.visits.get(id))?.deleted).toBe(1)
  })

  it('lists the reasons and offers no delete when a follow-up exists', async () => {
    const p = await createPatient({ name: 'Deepa' })
    const id = await saveVisit({ patientId: p.id, date: '2026-09-01', caseNotes: {}, items: [] })
    await saveVisit({ patientId: p.id, date: '2026-09-15', caseNotes: {}, items: [] })
    const user = userEvent.setup()
    open(`/patients/${p.id}/visits/${id}`)

    await user.click(await screen.findByRole('button', { name: 'Delete visit' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/Has a follow-up visit on .*Delete that visit first/)
    expect(within(dialog).queryByRole('button', { name: 'Delete visit' })).toBeNull()
    expect((await db.visits.get(id))?.deleted).toBe(0)
  })
})
