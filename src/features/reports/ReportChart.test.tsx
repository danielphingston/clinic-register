import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ReportChart from './ReportChart'

// Recharts measures its container; give jsdom a size and a ResizeObserver.
vi.stubGlobal(
  'ResizeObserver',
  class {
    cb: ResizeObserverCallback
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb
    }
    observe(el: Element) {
      this.cb([{ target: el, contentRect: { width: 600, height: 240 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
    unobserve() {}
    disconnect() {}
  },
)

describe('ReportChart', () => {
  it.each(['bar', 'line', 'hbar'] as const)('renders a %s chart with its caption', (kind) => {
    render(
      <ReportChart
        spec={{
          kind,
          title: `Chart ${kind}`,
          xKey: 'x',
          money: true,
          data: [
            { x: '1 Oct', billed: 1200, collected: 800 },
            { x: '2 Oct', billed: 300, collected: 300 },
          ],
          series: [
            { key: 'billed', label: 'Billed', color: '#6366f1' },
            { key: 'collected', label: 'Collected', color: '#17805e' },
          ],
        }}
      />,
    )
    expect(screen.getByRole('figure', { name: `Chart ${kind}` })).toBeInTheDocument()
  })
})
