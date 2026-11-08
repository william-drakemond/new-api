/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { UpstreamUsagePanel, formatResetIn } from '../upstream-usage-panel'

const NOW = new Date('2026-11-05T18:00:00Z')
let client: QueryClient

function mockUpstreamUsage(body: unknown) {
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url !== '/api/upstream_usage') {
      throw new Error(`Unexpected request: ${url}`)
    }
    return { data: body }
  })
}

function renderPanel() {
  return render(
    <QueryClientProvider client={client}>
      <UpstreamUsagePanel />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

afterEach(() => {
  client.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('upstream quota panel', () => {
  it('shows each window as a labelled bar with its percentage and reset time', async () => {
    mockUpstreamUsage({
      success: true,
      data: {
        generated_at: NOW.toISOString(),
        groups: [
          {
            channel: 'Gemini',
            name: 'Gemini',
            windows: [
              {
                window: '5h',
                percent: 87.6,
                resets_at: '2026-11-05T23:00:00Z',
              },
              { window: '7d', percent: 4.2, resets_at: null },
            ],
          },
        ],
      },
    })

    renderPanel()

    const group = await screen.findByRole('region', { name: 'Gemini' })
    const fiveHours = within(group).getByRole('progressbar', {
      name: 'Gemini 5 hours',
    })
    expect(fiveHours).toHaveAttribute('aria-valuenow', '87.6')
    expect(within(group).getByText('88%')).toBeInTheDocument()
    expect(within(group).getByText('Resets in 5 hours')).toBeInTheDocument()
    expect(
      within(group).getByRole('progressbar', { name: 'Gemini Weekly' })
    ).toHaveAttribute('aria-valuenow', '4.2')
    expect(
      within(group).getByText('Starts with the next request')
    ).toBeInTheDocument()
  })

  it('names a 30-day window (a ChatGPT Free subscription in native mode)', async () => {
    mockUpstreamUsage({
      success: true,
      data: {
        generated_at: NOW.toISOString(),
        groups: [
          {
            channel: 'GPT',
            name: 'GPT',
            windows: [{ window: '30d', percent: 61, resets_at: null }],
          },
        ],
      },
    })

    renderPanel()

    const group = await screen.findByRole('region', { name: 'GPT' })
    expect(
      within(group).getByRole('progressbar', { name: 'GPT 30 days' })
    ).toHaveAttribute('aria-valuenow', '61')
  })

  it('shows a provider lock under the group it affects', async () => {
    mockUpstreamUsage({
      success: true,
      data: {
        generated_at: NOW.toISOString(),
        groups: [
          {
            channel: 'Gemini',
            name: 'Gemini',
            windows: [{ window: '5h', percent: 10, resets_at: null }],
            locked_until: '2026-11-09T00:00:00Z',
          },
        ],
      },
    })

    renderPanel()

    const group = await screen.findByRole('region', { name: 'Gemini' })
    expect(
      within(group).getByText(/^Locked by the provider until /)
    ).toBeInTheDocument()
  })

  it('keeps the other groups when one group cannot be read', async () => {
    mockUpstreamUsage({
      success: true,
      data: {
        generated_at: NOW.toISOString(),
        groups: [
          { channel: 'Claude', name: '', windows: null, error: 'unavailable' },
          {
            channel: 'Gemini',
            name: 'Gemini',
            windows: [{ window: '5h', percent: 0, resets_at: null }],
          },
        ],
      },
    })

    renderPanel()

    const claude = await screen.findByRole('region', { name: 'Claude' })
    expect(
      within(claude).getByText('Upstream quota is unavailable')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('progressbar', { name: 'Gemini 5 hours' })
    ).toBeInTheDocument()
  })

  it('says the quota is unavailable when the server cannot read it', async () => {
    mockUpstreamUsage({
      success: false,
      message: 'Upstream quota is unavailable',
      data: null,
    })

    renderPanel()

    expect(
      await screen.findByText('Upstream quota is unavailable')
    ).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })
})

// The panel used formatTimestampRelative, which keeps one unit and rounds: 6 days 18 hours showed
// as "in 7 days" and 4 hours 54 minutes as "in 5 hours", disagreeing with the upstream gateway's own
// usage page. Two units, rounded down, match it.
describe('formatResetIn', () => {
  const now = Date.parse('2026-11-08T01:41:00Z')
  const at = (ms: number) => now + ms
  const H = 3600_000
  const M = 60_000

  it('shows days and hours without rounding up to the next day', () => {
    expect(formatResetIn(at(6 * 24 * H + 18 * H + 15 * M), now, 'en')).toBe('in 6 days 18 hours')
    expect(formatResetIn(at(6 * 24 * H + 18 * H + 15 * M), now, 'zh-CN')).toBe('6天18小时后')
  })

  it('shows hours and minutes within a day', () => {
    expect(formatResetIn(at(4 * H + 54 * M + 30_000), now, 'en')).toBe('in 4 hours 54 minutes')
    expect(formatResetIn(at(4 * H + 54 * M), now, 'zh-CN')).toBe('4小时54分钟后')
  })

  it('drops a zero second unit and handles short and past times', () => {
    expect(formatResetIn(at(5 * H), now, 'en')).toBe('in 5 hours')
    expect(formatResetIn(at(2 * 24 * H), now, 'en')).toBe('in 2 days')
    expect(formatResetIn(at(42 * M), now, 'en')).toBe('in 42 minutes')
    expect(formatResetIn(at(20_000), now, 'en')).toBe('in 1 minute')
    expect(formatResetIn(at(-5 * M), now, 'en')).toBe('now')
  })
})
