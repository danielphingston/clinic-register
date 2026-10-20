import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Suspense } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'
import { isChunkLoadError, lazyPage } from './lazyPage'

function Boom(): never {
  throw new Error('kaboom')
}

describe('route error boundary', () => {
  it('shows a friendly message with collapsible details and resets on navigation', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { rerender } = render(
      <ErrorBoundary resetKey="/a">
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
    expect(screen.getByText(/Your saved data is safe/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to dashboard' })).toHaveAttribute('href', '/')
    expect(screen.getByText('Error details')).toBeInTheDocument()
    expect(screen.getByText(/kaboom/)).not.toBeVisible()
    await userEvent.setup().click(screen.getByText('Error details'))
    expect(screen.getByText(/kaboom/)).toBeVisible()

    rerender(
      <ErrorBoundary resetKey="/b">
        <p>Fine now</p>
      </ErrorBoundary>,
    )
    expect(screen.getByText('Fine now')).toBeInTheDocument()
  })

  it('offers a reload when a lazy chunk fails to load (stale deploy)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const Page = lazyPage(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/X-abc.js')) as Promise<{ X: () => null }>, 'X')
    render(
      <ErrorBoundary>
        <Suspense fallback="loading">
          <Page />
        </Suspense>
      </ErrorBoundary>,
    )
    expect(await screen.findByRole('heading', { name: 'A newer version is available' })).toBeInTheDocument()
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('kaboom'))).toBe(false)
  })
})
