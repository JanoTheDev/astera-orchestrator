// A Job made from a ticket is named by the ticket's title (plugin 4d): on its card, on a card holding its runs and in
// its detail's header, the objective Astera wrote staying the tooltip. A Job without one is named by its objective.
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import type { JobRow } from '../../../core/types'
import { jobName } from '../lib/jobName'

vi.mock('../i18n/I18nProvider', () => ({ useI18n: () => ({ lang: 'en', t: (key: string) => key }) }))

const { JobsView } = await import('./JobsView')

const OBJECTIVE = 'Resolve Linear ENG-101 (https://linear.app/acme/issue/ENG-101).\n\nThe following is the item’s content…'
const SOURCE = { id: 'astera-linear-source', itemId: 'ENG-101', label: 'Linear ENG-101', title: 'Fix the login page on Safari', url: 'https://linear.app/acme/issue/ENG-101' }
const row = (over: Partial<JobRow>): JobRow =>
  ({ id: 'job_1', objective: OBJECTIVE, outcome: 'running', done: 0, total: 1, eventCount: 1, sharesProjectFolder: false, tasks: [], ...over }) as JobRow
const render = (runs: JobRow[]): string =>
  renderToStaticMarkup(
    React.createElement(JobsView, {
      snapshot: { runs, projectFolderBusy: false },
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
      onRestartCoordinator: () => {}
    })
  )
const objectiveSpans = (html: string): string[] => [...html.matchAll(/<span class="jobs-objective[^"]*" title="([^"]*)">([^<]*)<\/span>/g)].map((m) => m[2])

describe('a Job’s name', () => {
  it('is the ticket’s title when the Job was made from one, else its objective', () => {
    expect(jobName({ objective: OBJECTIVE, source: SOURCE })).toBe('Fix the login page on Safari')
    expect(jobName({ objective: 'Ship it' })).toBe('Ship it')
    // A Job made before 4d: its source has no title
    const { title: _title, ...old } = SOURCE
    expect(jobName({ objective: 'Ship it', source: old })).toBe('Ship it')
  })

  it('names the card, and a card holding its runs, by it, the objective staying the tooltip', () => {
    expect(objectiveSpans(render([row({ source: SOURCE })]))).toEqual(['Fix the login page on Safari'])
    expect(render([row({ source: SOURCE })])).toContain('title="Resolve Linear ENG-101')
    expect(objectiveSpans(render([row({ source: SOURCE, children: [row({ id: 'run_1' }), row({ id: 'run_2' })] })]))[0]).toBe('Fix the login page on Safari')
    expect(objectiveSpans(render([row({ objective: 'Ship it' })]))).toEqual(['Ship it'])
  })

  it('names the detail’s header by it', () => {
    const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'RunDetail.tsx'), 'utf8')
    const head = src.slice(src.indexOf('<div className="detail-head">'), src.indexOf('</h2>', src.indexOf('<div className="detail-head">')))
    expect(head).toContain('{run ? jobName(run) : \'\'}')
  })
})
