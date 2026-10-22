// "+ 소스에서" in the Jobs view (plugin Phase 4 J20, §3): beside "+ 새 작업" when there is a project on this machine,
// in the empty view and above the list; never for a paired Runtime's project (Review Focus 5) or with no project.
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JobsView } from './JobsView'
import type { JobRow, OrchSnapshot } from '../../../core/types'

vi.mock('../i18n/I18nProvider', () => ({ useI18n: () => ({ lang: 'en', t: (key: string) => key }) }))

const row = (over: Partial<JobRow>): JobRow =>
  ({ id: 'job_1', objective: 'ship it', outcome: 'running', done: 0, total: 1, eventCount: 1, sharesProjectFolder: false, tasks: [], ...over }) as JobRow
const withRows: OrchSnapshot = { runs: [row({})], projectFolderBusy: false }
const empty: OrchSnapshot = { runs: [], projectFolderBusy: false }

const render = (over: Partial<React.ComponentProps<typeof JobsView>> = {}): string =>
  renderToStaticMarkup(
    React.createElement(JobsView, {
      snapshot: withRows,
      hostGate: null,
      stall: null,
      hasProject: true,
      canOpenSession: () => false,
      onOpenSession: () => {},
      onOpenRun: () => {},
      onNewRun: () => {},
      onNewFromSource: () => {},
      onPauseRun: () => {},
      onResumeRun: () => {},
      onDeleteRun: () => {},
      onRestartCoordinator: () => {},
      ...over
    })
  )
// A ui Button: its classes, then ours; its add icon, then the label
const fromSource = (html: string): string[] =>
  html.match(/<[a-z]+[^>]*class="[^"]*\bjobs-create-source\b[^"]*"[^>]*>(?:(?!<\/button>).)*jobs\.source\.open<\/span><\/button>/g) ?? []

describe('JobsView: + 소스에서', () => {
  it('is beside + 새 작업, above the list and in the empty view', () => {
    for (const snapshot of [withRows, empty]) {
      const html = render({ snapshot })
      expect(fromSource(html), snapshot.runs.length > 0 ? 'list' : 'empty').toHaveLength(1)
      expect(html.indexOf('jobs.new.open')).toBeLessThan(html.indexOf('jobs.source.open'))
    }
  })

  it('is not there for a paired Runtime’s project, with no project, or with no way to open it', () => {
    for (const snapshot of [withRows, empty]) {
      expect(fromSource(render({ snapshot, remote: true, onNewFromSource: undefined }))).toEqual([])
      expect(fromSource(render({ snapshot, onNewFromSource: undefined }))).toEqual([])
    }
    expect(fromSource(render({ snapshot: empty, hasProject: false }))).toEqual([])
    // The 4c review's M1: the remote guard holds even when a handler is given
    for (const snapshot of [withRows, empty]) expect(fromSource(render({ snapshot, remote: true }))).toEqual([])
  })

  it('is drawn disabled with the reason, as + 새 작업 is', () => {
    const [tag] = fromSource(render({ disabledReason: 'busy' }))
    expect(tag).toContain('disabled')
    expect(tag).toContain('title="busy"')
  })
})
