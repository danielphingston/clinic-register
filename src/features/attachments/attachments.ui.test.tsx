import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { db } from '../../db/db'
import { createPatient } from '../patients/patientRepo'
import { saveVisit } from '../visits/visitRepo'
import { addAttachment } from './attachmentRepo'

vi.mock('../../auth/google', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/google')>()),
  requestToken: vi.fn(),
  fetchProfile: vi.fn(),
  revokeToken: vi.fn().mockResolvedValue(undefined),
}))

// Real compression needs a browser's codecs (covered by E2E). Large files
// "compress" to 310 KB; PDFs report 3 pages.
vi.mock('../../lib/compress', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/compress')>()
  return {
    ...actual,
    compressFile: vi.fn(async (file: File, opts: { keepOriginal?: boolean } = {}) => {
      const cat = actual.categorize(file)
      if (!cat) throw new actual.CompressError(actual.UNSUPPORTED_MESSAGE)
      const pages = cat === 'pdf' ? 3 : undefined
      if (opts.keepOriginal || cat === 'pdf') {
        return { blob: file, mime: file.type, originalSize: file.size, size: file.size, compressed: false, pages, note: opts.keepOriginal ? 'Original kept' : undefined }
      }
      const head = new Uint8Array(await file.slice(0, 64).arrayBuffer())
      const blob = new Blob([head, new Uint8Array(Math.max(0, 310 * 1024 - head.length))], { type: 'image/webp' })
      return { blob, mime: 'image/webp', originalSize: file.size, size: blob.size, compressed: true }
    }),
  }
})

vi.setConfig({ testTimeout: 20_000 })

function open(path: string) {
  localStorage.setItem('auth:profile', JSON.stringify({ sub: '1', email: 'd@x.com', name: 'D' }))
  window.history.replaceState(null, '', path)
  return render(<App />)
}

const MB = 1024 * 1024
function bigJpg(name: string, seed: number) {
  const bytes = new Uint8Array(Math.round(4.2 * MB))
  bytes[0] = seed
  return new File([bytes], name, { type: 'image/jpeg' })
}
const small = (name: string, type: string, content = name) => new File([content], name, { type })

describe('attachments UI', () => {
  it('uploads from the profile with per-file sizes, keep original and errors', async () => {
    const p = await createPatient({ name: 'Asha' })
    const user = userEvent.setup({ applyAccept: false })
    open(`/patients/${p.id}`)
    const card = await screen.findByTestId('patient-attachments')
    await user.click(within(card).getByRole('button', { name: '+ Add' }))
    const up = within(card).getByTestId('attachment-uploader')
    await user.selectOptions(within(up).getByLabelText('Type'), 'lab')
    await user.type(within(up).getByLabelText('Caption (optional)'), 'CBC')
    await user.upload(within(up).getByLabelText('Choose files'), [
      bigJpg('report.jpg', 1),
      small('notes.txt', 'text/plain'),
      bigJpg('raw.jpg', 2),
    ])
    const rows = within(up).getAllByTestId('upload-item')
    expect(rows).toHaveLength(3)
    expect(within(rows[1]).getByRole('status')).toHaveTextContent('Only images (JPEG, PNG, WebP, HEIC) and PDFs can be attached.')
    await user.click(within(rows[2]).getByLabelText('Keep original'))
    await user.click(within(up).getByRole('button', { name: 'Save 2 files' }))

    await waitFor(() => expect(within(rows[0]).getByRole('status')).toHaveTextContent('Saved · 4.2 MB → 310 KB'))
    await waitFor(() => expect(within(rows[2]).getByRole('status')).toHaveTextContent('Saved · 4.2 MB'))
    expect(within(rows[2]).getByText('Original kept')).toBeInTheDocument()

    await waitFor(() => expect(within(card).getAllByTestId('attachment-tile')).toHaveLength(2))
    expect(within(card).getAllByText('CBC')).toHaveLength(2)
    const saved = await db.attachments.toArray()
    expect(saved.map((a) => a.fileName).sort()).toEqual(['raw.jpg', 'report.webp'])
    expect(saved.every((a) => a.kind === 'lab' && a.caption === 'CBC' && !a.visitId)).toBe(true)
    // Caption resets for the next batch.
    expect(within(up).getByLabelText('Caption (optional)')).toHaveValue('')

    await user.click(within(up).getByRole('button', { name: 'Clear finished' }))
    expect(within(up).queryAllByTestId('upload-item')).toHaveLength(0)
  })

  it('shows a filterable grid, opens the viewer, edits captions and deletes', async () => {
    const p = await createPatient({ name: 'Ravi' })
    const visitId = await saveVisit({ patientId: p.id, date: '2026-10-01', caseNotes: {}, items: [] })
    await addAttachment({ patientId: p.id, kind: 'lab', file: small('cbc.pdf', 'application/pdf'), caption: 'CBC' })
    await new Promise((r) => setTimeout(r, 2))
    await addAttachment({ patientId: p.id, visitId, kind: 'photo', file: small('rash.jpg', 'image/jpeg'), caption: 'Rash' })
    await new Promise((r) => setTimeout(r, 2))
    await addAttachment({ patientId: p.id, kind: 'photo', file: small('eczema.png', 'image/png') })

    const user = userEvent.setup()
    open(`/patients/${p.id}`)
    const card = await screen.findByTestId('patient-attachments')
    await waitFor(() => expect(within(card).getAllByTestId('attachment-tile')).toHaveLength(3))
    const tiles = within(card).getAllByTestId('attachment-tile')
    // Newest first.
    expect(tiles.map((t) => t.querySelector('p')?.textContent)).toEqual(['eczema.webp', 'Rash', 'CBC'])
    expect(tiles[2]).toHaveTextContent('PDF · 3 p')
    expect(within(tiles[1]).getByRole('link', { name: 'Visit 01 Oct 2026' })).toHaveAttribute('href', `/patients/${p.id}/visits/${visitId}`)

    await user.click(within(card).getByRole('button', { name: 'Lab report' }))
    expect(within(card).getAllByTestId('attachment-tile')).toHaveLength(1)
    await user.click(within(card).getByRole('button', { name: 'Photo' }))
    expect(within(card).getAllByTestId('attachment-tile')).toHaveLength(2)

    await user.click(within(card).getByRole('button', { name: 'Open Rash' }))
    let viewer = await screen.findByRole('dialog', { name: 'Attachment: Rash' })
    expect(within(viewer).getByText('2 / 2')).toBeInTheDocument()
    expect(await within(viewer).findByRole('link', { name: 'Download' })).toHaveAttribute('download', 'rash.webp')
    await user.click(within(viewer).getByRole('button', { name: 'Previous' }))
    viewer = await screen.findByRole('dialog', { name: 'Attachment: eczema.webp' })
    expect(within(viewer).queryByRole('button', { name: 'Previous' })).not.toBeInTheDocument()

    const caption = within(viewer).getByLabelText('Caption')
    await user.type(caption, 'Eczema, left arm')
    await user.click(within(viewer).getByRole('button', { name: 'Save caption' }))
    await screen.findByRole('dialog', { name: 'Attachment: Eczema, left arm' })
    expect(within(card).getByText('Eczema, left arm')).toBeInTheDocument()

    await user.keyboard('{ArrowRight}')
    viewer = await screen.findByRole('dialog', { name: 'Attachment: Rash' })
    await user.click(within(viewer).getByRole('button', { name: 'Delete…' }))
    await user.click(within(viewer).getByRole('button', { name: 'Cancel' }))
    await user.click(within(viewer).getByRole('button', { name: 'Delete…' }))
    await user.click(within(within(viewer).getByRole('group', { name: 'Confirm delete' })).getByRole('button', { name: 'Delete' }))
    // Moves to the remaining photo.
    viewer = await screen.findByRole('dialog', { name: 'Attachment: Eczema, left arm' })
    await waitFor(() => expect(within(card).getAllByTestId('attachment-tile')).toHaveLength(1))
    expect((await db.attachments.toArray()).find((a) => a.caption === 'Rash')?.deleted).toBe(1)

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('handles files not downloaded to this device yet', async () => {
    const p = await createPatient({ name: 'Mira' })
    const { attachment } = await addAttachment({ patientId: p.id, kind: 'photo', file: small('x.jpg', 'image/jpeg') })
    await db.blobs.delete(attachment.blobHash)
    const user = userEvent.setup()
    open(`/patients/${p.id}`)
    const card = await screen.findByTestId('patient-attachments')
    expect(await within(card).findByText('Not downloaded yet')).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Open x.webp Not downloaded yet' }))
    const viewer = await screen.findByRole('dialog')
    expect(within(viewer).getByTestId('viewer-missing')).toBeInTheDocument()
    expect(within(viewer).queryByRole('link', { name: 'Download' })).not.toBeInTheDocument()
  })

  it('attaches files from a saved visit; new visits show a hint', async () => {
    const p = await createPatient({ name: 'Kiran' })
    const user = userEvent.setup()
    const { unmount } = open(`/patients/${p.id}/visits/new`)
    const section = await screen.findByTestId('visit-attachments')
    expect(section).toHaveTextContent('Save the visit first')
    expect(within(section).queryByLabelText('Choose files')).not.toBeInTheDocument()
    unmount()

    const visitId = await saveVisit({ patientId: p.id, date: '2026-10-02', caseNotes: { complaint: 'Rash' }, items: [] })
    open(`/patients/${p.id}/visits/${visitId}`)
    const vs = await screen.findByTestId('visit-attachments')
    expect(await within(vs).findByText('No files attached to this visit.')).toBeInTheDocument()
    await user.selectOptions(within(vs).getByLabelText('Type'), 'photo')
    // Enter in the caption must not submit the visit form.
    await user.type(within(vs).getByLabelText('Caption (optional)'), 'Day 1{Enter}')
    expect(window.location.pathname).toBe(`/patients/${p.id}/visits/${visitId}`)
    await user.upload(within(vs).getByLabelText('Choose files'), small('rash.png', 'image/png'))
    await user.click(within(vs).getByRole('button', { name: 'Save 1 file' }))
    expect(await within(vs).findByTestId('attachment-tile')).toHaveTextContent('Day 1')
    const [a] = await db.attachments.toArray()
    expect(a).toMatchObject({ visitId, patientId: p.id, kind: 'photo', caption: 'Day 1' })
    expect(window.location.pathname).toBe(`/patients/${p.id}/visits/${visitId}`)
  })

  it('shows storage usage in settings', async () => {
    const p = await createPatient({ name: 'Asha' })
    await addAttachment({ patientId: p.id, kind: 'lab', file: bigJpg('a.jpg', 1) })
    await addAttachment({ patientId: p.id, kind: 'lab', file: bigJpg('a.jpg', 1) })
    open('/settings')
    const card = await screen.findByTestId('storage-card')
    await waitFor(() => expect(within(card).getByTestId('storage-attachments')).toHaveTextContent('2 files · 310 KB (from 8.4 MB before compression)'))
    expect(within(card).getByTestId('storage-browser')).toBeInTheDocument()
  })
})
