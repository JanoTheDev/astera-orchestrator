import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Account, AccountUsage } from '../../../core/types'
import { AccountRow } from './AccountRow'

vi.mock('../i18n/I18nProvider', () => ({
  useI18n: () => ({
    lang: 'en',
    t: (key: string) => key,
    tm: (m: unknown) => String(m)
  })
}))

const account = (over: Partial<Account> = {}): Account => ({
  id: 'a1',
  label: 'Work',
  configDir: 'D:/home/.claude',
  color: '#4488ff',
  createdAt: '2026-01-01T00:00:00.000Z',
  provider: 'claude',
  ...over
})

const usage = (): AccountUsage => ({
  session: { usedPercent: 12, resetsAt: null },
  weekly: { usedPercent: 41, resetsAt: null },
  readAt: '2026-09-02T12:00:00.000Z',
  remembered: false
})

const render = (
  over: Partial<React.ComponentProps<typeof AccountRow>> = {}
): string =>
  renderToStaticMarkup(
    React.createElement(AccountRow, {
      account: account(),
      loggedIn: true,
      email: 'me@example.com',
      // Both real call sites always pass one; a row given no way to toggle is inert by design, and
      // the inert case is asserted explicitly below rather than by omission here.
      onToggle: () => {},
      ...over
    })
  )

describe('AccountRow', () => {
  it('a logged-in account with a usage reading renders the meter, and the detail only once expanded', () => {
    expect(render({ usage: usage() })).toContain('acct-meter')
    expect(render({ usage: usage() })).not.toContain('acct-detail')
    expect(render({ usage: usage(), expanded: true })).toContain('acct-detail')
  })

  // §5: nothing is drawn for an account that is not logged in — the meter cannot express this gate
  // on its own, since AccountUsageMeter only ever sees `usage`, never `loggedIn`.
  it('a logged-out account renders neither, even with a reading present and expanded', () => {
    const html = render({ loggedIn: false, usage: usage(), expanded: true })
    expect(html).not.toContain('acct-meter')
    expect(html).not.toContain('acct-detail')
  })

  // undefined is the state before useAccountStatus has answered — drawing nothing here is what
  // keeps the meter from flashing in and then out again once the real answer arrives.
  it('loggedIn undefined (the pre-probe state) renders neither', () => {
    const html = render({ loggedIn: undefined, usage: usage(), expanded: true })
    expect(html).not.toContain('acct-meter')
    expect(html).not.toContain('acct-detail')
  })

  // The row only advertises itself as a control when there is something to open. A row with no
  // reading — a Codex account, a logged-out one, one never read — must not look or behave clickable,
  // or a person learns that clicking sometimes does nothing.
  it('is focusable and marked expandable only when it has a detail to show', () => {
    const open = render({ usage: usage() })
    expect(open).toContain('tabindex="0"')
    expect(open).toContain('aria-expanded="false"')
    expect(render({ usage: usage(), expanded: true })).toContain('aria-expanded="true"')

    // No reading, not logged in, and no toggle handler each leave the row inert.
    for (const inert of [
      render({}),
      render({ loggedIn: false, usage: usage() }),
      render({ usage: usage(), onToggle: undefined })
    ]) {
      expect(inert).not.toContain('tabindex')
      expect(inert).not.toContain('aria-expanded')
    }
  })

  it('marks the expanded row so the open one is visible in the list', () => {
    expect(render({ usage: usage(), expanded: true })).toContain('class="acct-row acct-row--open"')
    expect(render({ usage: usage() })).toContain('class="acct-row"')
    expect(render({ usage: usage() })).not.toContain('acct-row--open')
  })

  // The action buttons live inside the row, so a click on one would otherwise bubble up and toggle
  // the row underneath it — pressing "remove account" would also open the usage detail.
  it('wraps the action children so their clicks cannot reach the row', () => {
    const html = render({
      usage: usage(),
      children: React.createElement('button', { className: 'row-action' }, 'x')
    })
    expect(html).toContain('acct-row__actions')
    expect(html.indexOf('acct-row__actions')).toBeLessThan(html.indexOf('row-action'))
  })

  // The only place the account email is shown — a deliberate ruling (spec §5.1) that the detail
  // replaces a usage tooltip, not this identity one.
  it('the title tooltip is still present', () => {
    expect(render({ email: 'me@example.com' })).toContain('title="Work · me@example.com"')
  })

  it('a paused account shows a chip with an icon and the word; a signed-out one keeps the signed-out chip', () => {
    const paused = render({ paused: true })
    expect(paused).toContain('account.status.paused')
    expect(paused).toContain('<svg')
    expect(render({})).not.toContain('account.status.paused')
    const out = render({ loggedIn: false, paused: true })
    expect(out).toContain('account.status.signedOut')
    expect(out).not.toContain('account.status.paused')
  })

  it('with actions, the menu replaces the separate rename button', () => {
    const actions = [{ id: 'rename' as const }, { id: 'remove' as const }]
    expect(render({ actions })).not.toContain('account.rename.button"')
    expect(render({ actions })).toContain('account.menu.label')
    expect(render({})).toContain('account.rename.button')
  })
})

// T4: the account center redesign.
describe('AccountRow states, plan and active mark (T4)', () => {
  const chipOf = (html: string): string | undefined => /class="ui-chip ui-chip--(\w+) acct-state__chip">(.*?)<\/span><\/span>/.exec(html)?.[0]

  it('each login state has its own chip, with an icon and a word as well as a colour', () => {
    const cases = [
      ['signedIn', 'ok', 'account.status.signedIn'],
      ['signedOut', 'warn', 'account.status.signedOut'],
      ['expired', 'danger', 'account.status.expired'],
      ['unknown', 'neutral', 'account.status.unknown']
    ] as const
    for (const [state, tone, word] of cases) {
      const chip = chipOf(render({ loggedIn: state }))
      expect(chip, state).toContain(`ui-chip--${tone}`)
      expect(chip, state).toContain('<svg')
      expect(chip, state).toContain(word)
    }
    // before the check answers there is no chip at all
    expect(chipOf(render({ loggedIn: undefined }))).toBeUndefined()
  })

  it('an expired or unknown login says what it means on hover', () => {
    expect(render({ loggedIn: 'expired' })).toContain('title="account.status.expiredHint"')
    expect(render({ loggedIn: 'unknown' })).toContain('title="account.status.unknownHint"')
  })

  it('the inline sign-in button: sign in when signed out, sign in again when expired, none otherwise', () => {
    const onAction = (): void => {}
    expect(render({ loggedIn: 'signedOut', onAction })).toContain('account.signIn.button')
    expect(render({ loggedIn: 'expired', onAction })).toContain('account.signInAgain.button')
    for (const s of ['signedIn', 'unknown', undefined] as const) {
      const html = render({ loggedIn: s, onAction })
      expect(html).not.toContain('account.signIn.button')
      expect(html).not.toContain('account.signInAgain.button')
    }
  })

  it('only a signed-in login draws the meter; expired and unknown do not', () => {
    expect(render({ loggedIn: 'signedIn', usage: usage() })).toContain('acct-meter')
    expect(render({ loggedIn: 'expired', usage: usage() })).not.toContain('acct-meter')
    expect(render({ loggedIn: 'unknown', usage: usage() })).not.toContain('acct-meter')
  })

  it('the plan chip: Ultra by name, an unknown plan by its raw string, nothing without a reading', () => {
    expect(render({ plan: { id: 'ultra', raw: 'default_claude_ultra', hasSessionWindow: false } })).toContain('account.plan.ultra')
    expect(render({ plan: { id: 'unknown', raw: 'claude_galaxy', hasSessionWindow: true } })).toContain('>claude_galaxy<')
    expect(render({ plan: { id: 'unknown', raw: null, hasSessionWindow: true } })).not.toContain('acct-plan')
    expect(render({})).not.toContain('acct-plan')
  })

  it('an Ultra account draws no 5-hour track, even with a session figure in the reading', () => {
    const ultra = { id: 'ultra' as const, raw: 'ultra', hasSessionWindow: false }
    expect(render({ plan: ultra, usage: usage() })).not.toContain('account.usage.fiveHour')
    expect(render({ plan: ultra, usage: usage() })).toContain('account.usage.weekly')
    expect(render({ usage: usage() })).toContain('account.usage.fiveHour')
  })

  it('the active account is marked with an edge, aria-current and the word', () => {
    const html = render({ active: true, activeHint: 'hint' })
    expect(html).toContain('acct-row--active')
    expect(html).toContain('aria-current="true"')
    expect(html).toContain('account.active')
    expect(render({})).not.toContain('acct-row--active')
    expect(render({})).not.toContain('aria-current')
  })

  it('the default account says so on its second line', () => {
    expect(render({ isDefault: true })).toContain('accounts.default')
    expect(render({})).not.toContain('accounts.default')
  })
})
