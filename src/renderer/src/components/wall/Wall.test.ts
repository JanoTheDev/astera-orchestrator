import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { t, type MessageKey, type MessageParams } from '../../../../core/i18n'
import { ConsoleTile } from './Wall'
import type { WallConsole } from './wallModel'

vi.mock('../../i18n/I18nProvider', () => ({
  useI18n: () => ({ lang: 'en', t: (key: MessageKey, params?: MessageParams) => t('en', key, params), tm: (m: unknown) => String(m) })
}))

const c: WallConsole = {
  sessionId: 's1', label: 'Worker 2', role: 'worker', state: 'working', projectId: 'p1', planOrder: 0,
  taskTitle: 'Fix the login form', cwd: '/repo', chat: false
}
const render = (over: Partial<Parameters<typeof ConsoleTile>[0]> = {}): string =>
  renderToStaticMarkup(
    React.createElement(ConsoleTile, {
      c, main: false, meta: ['Repo', 'Work', 'worker', '2m ago'], activity: 'Editing src/a.ts', onOpen: () => {}, onHide: () => {}, onEnd: () => {}, ...over
    })
  )

describe('ConsoleTile', () => {
  const out = render()

  it('reads title, state, meta and activity', () => {
    expect(out).toContain('Fix the login form')
    expect(out).toContain('Working')
    expect(out).toContain('Repo · Work · worker · 2m ago')
    expect(out).toContain('Editing src/a.ts')
  })

  it('the card is one real button, with the preview inside it', () => {
    expect(out).toMatch(/^<div class="wall-tile"><button type="button" class="ui-card[^"]*wall-tile__card"/)
    expect(out).toContain('aria-label="Open Fix the login form full size"')
    expect(out).toContain('wall-tile__term')
  })

  it('the overflow menu is its own focusable, named button outside the card', () => {
    const more = /<div class="wall-tile__more"><div class="ui-menu"><button[^>]*>/.exec(out)?.[0] ?? ''
    expect(more).toContain('aria-label="More for Fix the login form"')
    expect(more).toContain('aria-haspopup="menu"')
    expect(more).not.toContain('tabindex="-1"')
    expect(out.indexOf('wall-tile__more')).toBeGreaterThan(out.indexOf('</button>'))
  })

  it('no menu without actions; a chat console shows a line instead of the preview', () => {
    expect(render({ onHide: undefined, onEnd: undefined })).not.toContain('wall-tile__more')
    const chat = render({ c: { ...c, chat: true } })
    expect(chat).not.toContain('wall-tile__term')
    expect(chat).toContain('wall-tile__chat')
  })
})
