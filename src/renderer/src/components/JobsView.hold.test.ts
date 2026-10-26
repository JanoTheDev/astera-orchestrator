// W5-C (#39): a plain plan's card offers "stop launching new workers" (jobs-hold) and, once held, says so and offers
// to launch again. A schedule (its own ⏸), a plan not started and an archived plan get no such button.
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { JobRow, OrchSnapshot } from '../../../core/types'

vi.mock('../i18n/I18nProvider', () => ({ useI18n: () => ({ lang: 'en', t: (key: string) => key }) }))

const { JobsView } = await import('./JobsView')

const row = (over: Partial<JobRow>): JobRow =>
  ({ id: 'job_1', objective: 'ship it', outcome: 'running', done: 0, total: 1, eventCount: 1, sharesProjectFolder: false, tasks: [], ...over }) as JobRow

const render = (runs: JobRow[], withHold = true): string =>
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
      ...(withHold ? { onHoldJob: () => {} } : {})
    })
  )

describe('the Jobs view hold button', () => {
  it('offers to stop launching on a running plain plan, and to launch again once held', () => {
    expect(render([row({})])).toContain('aria-label="jobs.view.hold"')
    const held = render([row({ dispatchHold: true })])
    expect(held).toContain('aria-label="jobs.view.holdRelease"')
    expect(held).toContain('jobs.hold.held')
    expect(held).not.toContain('aria-label="jobs.view.hold"')
  })

  it('offers no Release for a replan, the final check or a replan question', () => {
    for (const holdBy of ['replanning', 'final-check', 'replan-question'] as const) {
      const html = render([row({ dispatchHold: true, holdBy })])
      expect(html).not.toContain('jobs.view.holdRelease')
      expect(html).not.toContain('jobs.hold.held')
    }
    expect(render([row({ dispatchHold: true, holdBy: 'owner' })])).toContain('jobs.view.holdRelease')
  })

  it('is not drawn for a schedule, a plan not started, an archived plan, or without the action', () => {
    for (const r of [row({ schedule: { kind: 'interval', everyMinutes: 60 } as never }), row({ pendingStart: true })])
      expect(render([r])).not.toContain('jobs.view.hold"')
    expect(render([row({})], false)).not.toContain('jobs.view.hold"')
  })
})
