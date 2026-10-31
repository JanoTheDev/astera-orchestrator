import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AccountUsage } from '../../../core/types'
import { AccountUsageMeter, AccountUsageDetail } from './AccountUsageMeter'

vi.mock('../i18n/I18nProvider', () => ({
  useI18n: () => ({
    lang: 'en',
    t: (key: string, params?: Record<string, string | number>) =>
      params ? `${key}(${Object.values(params).join(',')})` : key,
    tm: (m: unknown) => String(m)
  })
}))

const usage = (over: Partial<AccountUsage> = {}): AccountUsage => ({
  session: { usedPercent: 12, resetsAt: null },
  weekly: { usedPercent: 41, resetsAt: null },
  readAt: '2026-09-02T12:00:00.000Z',
  remembered: false,
  ...over
})

const render = (u: AccountUsage | undefined): string =>
  renderToStaticMarkup(React.createElement(AccountUsageMeter, { usage: u }))

// W9-B: every usage display is the house Meter (components/ui/Meter), on its usage-guard thresholds.
describe('AccountUsageMeter', () => {
  const fills = (html: string): string[] => [...html.matchAll(/ui-meter__fill" style="width:([^%]+)%/g)].map((m) => m[1])

  it('draws two Meters — the 5-hour window first, weekly second', () => {
    const html = render(usage())
    expect(html).toContain('acct-meter')
    expect(fills(html)).toEqual(['12', '41'])
  })

  it('colours each window on its own figure, not on the higher of the two', () => {
    const html = render(
      usage({ session: { usedPercent: 96, resetsAt: null }, weekly: { usedPercent: 30, resetsAt: null } })
    )
    expect(html).toContain('ui-meter--danger')
    expect(html).toContain('ui-meter--accent')
  })

  // The same convention a stale PR badge uses (.pr-badge.stale), reused rather than invented.
  it('a remembered reading dims', () => {
    expect(render(usage({ remembered: true }))).toContain('acct-meter stale')
    expect(render(usage())).not.toContain('stale')
  })

  // §5: a dash was considered and rejected — it reads as 0%, not as "no value". A Codex account, an
  // account that is not logged in, and a reading discarded past its reset all arrive as undefined.
  it('draws nothing at all when there is no reading', () => {
    expect(render(undefined)).toBe('')
  })

  it('draws nothing when both windows are absent', () => {
    expect(render(usage({ session: null, weekly: null }))).toBe('')
  })

  it('a missing weekly window still draws both tracks, the missing one empty', () => {
    // Both tracks stay in the markup so the meter keeps its height and the row does not shift.
    expect(fills(render(usage({ weekly: null })))).toEqual(['12', '0'])
  })

  // T4 (changed on purpose): this used to pin "one window present still draws both tracks". An account with no 5-hour
  // window (Ultra; or a reading with weekly and no session, sessionWindow.ts) now draws the weekly track alone, so it
  // never shows a "5h 0%" it does not have. The caller decides with hasSessionWindow.
  it('with no 5-hour window, only the weekly track is drawn', () => {
    const html = renderToStaticMarkup(
      React.createElement(AccountUsageMeter, { usage: usage({ session: null }), sessionWindow: false })
    )
    expect(fills(html)).toEqual(['41'])
    expect(html).not.toContain('account.usage.fiveHour')
    expect(html).toContain('account.usage.weekly')
  })

  it('an account that has the window but no figure for it keeps the empty 5-hour track', () => {
    const html = render(usage({ session: null }))
    expect(fills(html)).toEqual(['0', '41'])
    expect(html).toContain('account.usage.fiveHour')
  })

  it('a percentage outside 0-100 is clamped to the track', () => {
    const html = render(
      usage({ session: { usedPercent: 140, resetsAt: null }, weekly: { usedPercent: -5, resetsAt: null } })
    )
    expect(fills(html)).toEqual(['100', '0'])
  })
})

describe('AccountUsageDetail', () => {
  const NOW = Date.parse('2026-09-02T12:00:00.000Z')
  const HOUR = 3_600_000

  const detail = (u: AccountUsage | undefined): string =>
    renderToStaticMarkup(React.createElement(AccountUsageDetail, { usage: u }))

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => vi.useRealTimers())

  const both = (): AccountUsage => ({
    session: { usedPercent: 78, resetsAt: new Date(NOW + 47 * 60_000).toISOString() },
    weekly: { usedPercent: 36, resetsAt: new Date(NOW + 4 * 24 * HOUR).toISOString() },
    readAt: new Date(NOW - 3 * HOUR).toISOString(),
    remembered: false
  })

  it('is one line per window, the 5-hour window first', () => {
    const html = detail(both())
    expect(html.indexOf('account.usage.fiveHour')).toBeGreaterThan(-1)
    expect(html.indexOf('account.usage.fiveHour')).toBeLessThan(html.indexOf('account.usage.weekly'))
    expect(html).toContain('78%')
    expect(html).toContain('36%')
  })

  it('each line carries its own bar at its own threshold colour', () => {
    const html = detail(both())
    expect(html).toContain('ui-meter--warn') // 78
    expect(html).toContain('ui-meter--accent') // 36
  })

  it('names when each window rolls, in that window\'s own units', () => {
    const html = detail(both())
    expect(html).toContain('account.usage.resetsIn(47m)')
    expect(html).toContain('account.usage.resetsIn(4d)')
  })

  // The detail's "updated N ago" is where a person learns the figure is not live — the one thing
  // that lets them notice an account used outside Astera (§3.1).
  it('a remembered reading adds a third line saying how old it is', () => {
    const html = detail({ ...both(), remembered: true })
    expect(html).toContain('acct-detail-stale')
    expect(html).toContain('account.usage.refreshedAgo(3h)')
  })

  it('a live reading has no third line', () => {
    expect(detail(both())).not.toContain('acct-detail-stale')
  })

  it('a window with no reset time shows its figure and no time', () => {
    const html = detail({ ...both(), session: { usedPercent: 78, resetsAt: null } })
    expect(html).toContain('78%')
    expect(html).not.toContain('account.usage.resetsIn(47m)')
  })

  it('a reset time already in the past shows no time rather than a negative one', () => {
    const html = detail({
      ...both(),
      session: { usedPercent: 78, resetsAt: new Date(NOW - HOUR).toISOString() }
    })
    expect(html).not.toContain('account.usage.resetsIn(1h)')
    expect(html).toContain('78%')
  })

  it('with no 5-hour window, the detail has the weekly line alone', () => {
    const html = renderToStaticMarkup(React.createElement(AccountUsageDetail, { usage: both(), sessionWindow: false }))
    expect(html).not.toContain('account.usage.fiveHour')
    expect(html).toContain('36%')
  })

  it('renders nothing when the meter renders nothing', () => {
    expect(detail(undefined)).toBe('')
    expect(detail({ ...both(), session: null, weekly: null })).toBe('')
  })
})
