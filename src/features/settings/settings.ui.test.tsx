import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { getSettings, saveSettings } from '../../db/repo'

vi.mock('../../auth/google', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/google')>()),
  requestToken: vi.fn(),
  fetchProfile: vi.fn(),
  revokeToken: vi.fn().mockResolvedValue(undefined),
}))

vi.setConfig({ testTimeout: 20_000 })

describe('settings number fields', () => {
  it('can be cleared before typing a new value, and falls back to a default if left blank', async () => {
    await saveSettings({ ...(await getSettings()), consultationFee: 300 })
    localStorage.setItem('auth:profile', JSON.stringify({ sub: '1', email: 'd@x.com', name: 'D' }))
    window.history.replaceState(null, '', '/settings?tab=billing')
    render(<App />)
    const user = userEvent.setup()

    const fee = await screen.findByLabelText('Consultation fee (₹)')
    await user.clear(fee)
    expect(fee).toHaveValue(null)
    await user.tab()
    expect(fee).toHaveValue(0)

    // Fields with a minimum fall back to it rather than to 0.
    const dueDays = screen.getByLabelText('Default due period (days)')
    await user.clear(dueDays)
    await user.tab()
    expect(dueDays).toHaveValue(1)

    await user.clear(fee)
    await user.type(fee, '450')
    expect(fee).toHaveValue(450)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(async () => expect((await getSettings()).consultationFee).toBe(450))
  })
})

describe('whatsapp placeholder tags', () => {
  it('inserts a placeholder at the caret, replacing the selection, and keeps the caret after it', async () => {
    localStorage.setItem('auth:profile', JSON.stringify({ sub: '1', email: 'd@x.com', name: 'D' }))
    window.history.replaceState(null, '', '/settings?tab=whatsapp')
    render(<App />)
    const user = userEvent.setup()

    const body = (await screen.findByLabelText('Template 1 message')) as HTMLTextAreaElement
    await user.clear(body)
    await user.type(body, 'Hi XX, welcome')
    body.setSelectionRange(3, 5) // select "XX"
    const group = screen.getAllByRole('group', { name: 'Insert placeholder' })[1]
    await user.click(within(group).getByRole('button', { name: '+ Name' }))

    expect(body).toHaveValue('Hi {name}, welcome')
    expect(body).toHaveFocus()
    expect(body.selectionStart).toBe('Hi {name}'.length)
    expect(body.selectionEnd).toBe('Hi {name}'.length)
  })
})

describe('OP number format', () => {
  it('builds a format from clickable tags, previews it and sets the next number', async () => {
    localStorage.setItem('auth:profile', JSON.stringify({ sub: '1', email: 'd@x.com', name: 'D' }))
    window.history.replaceState(null, '', '/settings?tab=clinic')
    render(<App />)
    const user = userEvent.setup()
    const yy = String(new Date().getFullYear() % 100).padStart(2, '0')

    const format = await screen.findByLabelText('OP number format')
    expect(format).toHaveValue('OP-{YYYY}-{N:5}')
    expect(await screen.findByTestId('op-preview')).toHaveTextContent(`OP-${new Date().getFullYear()}-00001`)

    // Each tag explains itself on hover or focus.
    expect(screen.getByRole('button', { name: '+ Short year' })).toHaveAccessibleDescription(/Last two digits of the year.*26|e\.g\./)

    // An empty prefix is fine: build {YY}{N:4} from the tags.
    await user.clear(format)
    await user.click(screen.getByRole('button', { name: '+ Short year' }))
    await user.click(screen.getByRole('button', { name: '+ Number, 4 digits' }))
    expect(format).toHaveValue('{YY}{N:4}')
    expect(await screen.findByTestId('op-preview')).toHaveTextContent(`${yy}0001`)

    // Examples open on click and can be applied.
    await user.click(screen.getByRole('button', { name: 'Show examples' }))
    const examples = screen.getByRole('button', { name: /\{YYYY\}\/\{N\}/ })
    expect(examples).toHaveTextContent(`${new Date().getFullYear()}/183`)
    await user.click(examples)
    expect(format).toHaveValue('{YYYY}/{N}')
    await user.click(screen.getByRole('button', { name: /\{YY\}\{N:4\} →/ }))

    // A format without a running number can't be saved.
    await user.clear(format)
    await user.type(format, 'OP')
    expect(screen.getByText(/needs a running number/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/OP number format: The format needs a running number/)).toBeInTheDocument()

    await user.clear(format)
    await user.click(screen.getByRole('button', { name: '+ Short year' }))
    await user.click(screen.getByRole('button', { name: '+ Number, 4 digits' }))
    await user.type(screen.getByLabelText('Next OP number'), '184')
    expect(await screen.findByTestId('op-preview')).toHaveTextContent(`${yy}0184`)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(async () => expect((await getSettings()).opFormat).toBe('{YY}{N:4}'))
    expect((await getSettings()).opNextFloor).toEqual({ scope: `${yy}{N:4}`, n: 184 })
  })
})
