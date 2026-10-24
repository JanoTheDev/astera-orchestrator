// T17: the New plan page as first drawn: the title bar's project, one composer, the settings folded into one row.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Project } from '../../../../core/orchestration/types'
import { ProjectScopeContext, type ProjectScope } from '../../state/useProjectScope'

vi.mock('../../i18n/I18nProvider', () => ({ useI18n: () => ({ t: (k: string) => k }) }))
vi.mock('../../hooks/useAccountUsage', () => ({ useAccountUsage: () => ({}) }))
vi.mock('../../lib/orchDoor', () => ({ localDoor: () => ({ command: () => new Promise(() => {}), signedInIds: () => new Promise(() => {}) }) }))
vi.mock('../shell/navigation', () => ({ openConsole: () => {}, openActivity: () => {} }))

import { StartPage } from './StartPage'

const app: Project = { id: 'app', name: 'Astera', path: '/w/app', addedAt: '', delivery: 'merge' }
const inApp: ProjectScope = { projectId: 'app', project: app, path: '/w/app', isAll: false, select: () => {} }
const allProjects: ProjectScope = { projectId: null, project: undefined, path: null, isAll: true, select: () => {} }

const render = (req = {}, scope: ProjectScope = inApp): string =>
  renderToStaticMarkup(
    React.createElement(
      ProjectScopeContext.Provider,
      { value: scope },
      React.createElement(StartPage, { req, cwd: '/w/app', accounts: [], onClose: () => {}, onOpenConsole: () => {}, onOtherSources: () => {} })
    )
  )

/** The composer card's markup: from the card to the "Start from…" row below it. */
const composer = (html: string): string => html.slice(html.indexOf('start-composer'), html.indexOf('start-starters'))

describe('New plan page', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { api: {}, localStorage: { getItem: () => null, setItem: () => {} } })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("is for the title bar's project: a read-only label, no project picker of its own", () => {
    const html = render()
    expect(html).toContain('start.for')
    expect(html).not.toContain('aria-label="start.project"')
    expect(html).not.toContain('aria-label="start.subproject"')
    expect(html).not.toMatch(/all projects/i)
  })

  it('asks which project only on All projects', () => {
    const html = render({}, allProjects)
    expect(html).toContain('aria-label="start.project"')
    expect(html).not.toContain('start.for')
    expect(html).toContain('start.project.required')
  })

  it('holds the box, the attachments as chips, the segmented mode, the primary button and its menu in one composer', () => {
    const card = composer(render({ files: ['/u/intake-paste/id/image-1.png', '/w/spec.md'] }))
    for (const part of ['start.q.placeholder', 'image-1.png', 'spec.md', 'start.remove', 'role="tablist"', 'ui-tabs--segmented', 'ui-btn--primary', 'aria-label="start.moreWays"'])
      expect(card).toContain(part)
    for (const m of ['chat', 'auto', 'prompts']) expect(card).toContain(`start.mode.${m}`)
    expect(render().match(/ui-btn--primary/g)).toHaveLength(1)
  })

  it('offers Attach, and takes a paste, in every mode', () => {
    for (const mode of ['chat', 'auto', 'prompts']) expect(composer(render({ mode }))).toContain('start.attach')
  })

  it('shows why the primary button is off as its tooltip, beside it', () => {
    const html = render()
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*start\.go\.plan/s)
    expect(composer(html)).toMatch(/start-go[\s\S]*start\.go\.plan[\s\S]*role="tooltip">start\.needText</)
  })

  it('opens in the mode New chose', () => {
    expect(render({ mode: 'prompts' })).toContain('start.how.promptsHint')
    expect(render({ mode: 'auto' })).toContain('start.go.auto')
  })

  it('labels the starters "Start from…" and keeps all five', () => {
    const html = render()
    expect(html).toContain('start.starters.label')
    for (const id of ['fix', 'build', 'audit', 'issues', 'file']) expect(html).toContain(`start.starter.${id}`)
  })

  it('folds the settings into one summary row, starting from the project defaults', () => {
    const html = render()
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('id="start-options"')
    for (const part of ['start.sum.auto', 'start.opt.now', 'start.sum.agents', 'start.sum.effort']) expect(html).toContain(part)
    // no folder setup read yet: the project's saved delivery is shown
    expect(html).toContain('delivery.merge')
    // the console link lives in the menu by the primary button, not as a stray link
    expect(html).not.toContain('new.consoleLink')
  })

  it('uses no legacy jobs-sched, warn or warn-text class: its own start-* rules carry the look', () => {
    expect(render({ mode: 'auto' })).not.toMatch(/class="(jobs-sched|warn|warn-text)"/)
  })
})
