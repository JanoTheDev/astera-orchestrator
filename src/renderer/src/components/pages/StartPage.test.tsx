// T14: the Start page as first drawn: project first, Advanced folded, the primary button off with its reason.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { resetAdvancedMode, setAdvancedMode } from '../../state/useAdvancedMode'

vi.mock('../../i18n/I18nProvider', () => ({ useI18n: () => ({ t: (k: string) => k }) }))
vi.mock('../../hooks/useAccountUsage', () => ({ useAccountUsage: () => ({}) }))
vi.mock('../../lib/orchDoor', () => ({ localDoor: () => ({ command: () => new Promise(() => {}), signedInIds: () => new Promise(() => {}) }) }))
vi.mock('../shell/navigation', () => ({ openConsole: () => {}, openPage: () => {} }))

import { StartPage } from './StartPage'

const render = (req = {}): string =>
  renderToStaticMarkup(
    React.createElement(StartPage, { req, cwd: '/w/app', defaultProject: '/w/app', accounts: [], onClose: () => {}, onOpenConsole: () => {}, onOtherSources: () => {} })
  )

describe('Start page', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { api: {}, localStorage: { getItem: () => null, setItem: () => {} } })
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
    resetAdvancedMode()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    resetAdvancedMode()
  })

  it('shows the question, the project first, the five starter chips and the three ways to plan', () => {
    const html = render()
    expect(html.indexOf('start.q.title')).toBeLessThan(html.indexOf('start.project'))
    expect(html.indexOf('start.project')).toBeLessThan(html.indexOf('start.q.placeholder'))
    for (const id of ['fix', 'build', 'audit', 'issues', 'file']) expect(html).toContain(`start.starter.${id}`)
    for (const m of ['chat', 'auto', 'prompts']) expect(html).toContain(`start.how.${m}`)
    expect(html).not.toMatch(/all projects/i)
  })

  it('folds Advanced; the primary button is off with a reason until a project and text exist', () => {
    const html = render()
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('id="start-options"')
    expect(html).not.toContain('accounts.pick')
    expect(html).toContain('start.go.plan')
    expect(html).toContain('start.project.required')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*start\.go\.plan/s)
  })

  it('opens Advanced by default when Advanced mode is on', () => {
    setAdvancedMode(true)
    const html = render()
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('id="start-options"')
    for (const hint of ['accountHint', 'afterHint', 'workersHint', 'deliveryHint', 'replanHint']) expect(html).toContain(`start.adv.${hint}`)
  })

  it('opens in the mode New chose', () => {
    expect(render({ mode: 'prompts' })).toContain('start.how.promptsHint')
    expect(render({ mode: 'auto' })).toContain('start.go.auto')
  })
})
