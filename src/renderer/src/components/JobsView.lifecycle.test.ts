// W1-C plan lifecycle in the Jobs view: an archived plan is hidden until "show archived", carries its chip, and a
// card's rename and archive buttons stand only on top-level cards and only when the App gives the actions.
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { JobRow, OrchSnapshot } from '../../../core/types'

vi.mock('../i18n/I18nProvider', () => ({ useI18n: () => ({ lang: 'en', t: (key: string) => key }) }))

const { JobsView } = await import('./JobsView')

const row = (over: Partial<JobRow>): JobRow =>
  ({ id: 'job_1', objective: 'ship it', outcome: 'running', done: 0, total: 1, eventCount: 1, sharesProjectFolder: false, tasks: [], ...over }) as JobRow

const render = (runs: JobRow[], over: Partial<React.ComponentProps<typeof JobsView>> = {}): string =>
  renderToStaticMarkup(
    React.createElement(JobsView, {
      snapshot: { runs, projectFolderBusy: false } satisfies OrchSnapshot,
      hostGate: null,
      stall: null,
      hasProject: true,
      canOpenSession: () => false,
      onOpenSession: () => {},
      onOpenRun: () => {},
      onNewRun: () => {},
      onPauseRun: () => {},
      onResumeRun: () => {},
      onDeleteRun: () => {},
      onRestartCoordinator: () => {},
      ...over
    })
  )
const names = (html: string): string[] => [...html.matchAll(/<span class="jobs-objective[^"]*" title="[^"]*">([^<]*)<\/span>/g)].map((m) => m[1])
const acts = { onRenameJob: () => {}, onArchiveJob: () => {}, onUnarchiveJob: () => {} }

describe('the Jobs view and archived plans', () => {
  it('hides an archived plan by default and offers the toggle with its count', () => {
    const html = render([row({ id: 'job_1', objective: 'live' }), row({ id: 'job_2', objective: 'old', archivedAt: 'T' })])
    expect(names(html)).toEqual(['live'])
    expect(html).toContain('jobs-archived-toggle')
    expect(html).toContain('jobs.lifecycle.showArchived')
  })

  it('draws no toggle when nothing is archived, and names a plan by its title', () => {
    const html = render([row({ title: 'Login', objective: 'ship it' })])
    expect(html).not.toContain('jobs-archived-toggle')
    expect(names(html)).toEqual(['Login'])
  })

  it('draws rename and archive on a top-level card only when the actions are given', () => {
    expect(render([row({})])).not.toContain('jobs-lifecycle')
    const html = render([row({})], acts)
    expect(html).toContain('aria-label="jobs.lifecycle.rename"')
    expect(html).toContain('aria-label="jobs.lifecycle.archive"')
    // A card with rounds: the plan's card has them, its rounds do not
    const kids = render([row({ children: [row({ id: 'run_1' }), row({ id: 'run_2' })] })], acts)
    expect(kids.match(/aria-label="jobs.lifecycle.archive"/g)).toHaveLength(1)
  })
})
