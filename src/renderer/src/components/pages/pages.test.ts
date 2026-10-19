// W9-C: the Tasks board and the Plans list as they render (renderToStaticMarkup, no DOM), and the plan section a plan
// page opens on. The rules themselves are planBoard.ts's (planBoard.test.ts).
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { JobRow, JobTask } from '../../../../core/types'

vi.mock('../../i18n/I18nProvider', () => ({ useI18n: () => ({ lang: 'en', t: (key: string) => key }) }))

const { TasksPage } = await import('./TasksPage')
const { PlansList, storedSection } = await import('./PlansPage')

const task = (id: string, over: Partial<JobTask> = {}): JobTask => ({ id, title: `title ${id}`, status: 'pending', openGates: 0, ...over })
const row = (id: string, over: Partial<JobRow> = {}): JobRow => ({
  id, objective: `plan ${id}`, outcome: 'running', done: 0, total: 0, eventCount: 0, sharesProjectFolder: false, tasks: [], ...over
})
const t = ((key: string, p?: Record<string, unknown>) => (p ? `${key}${JSON.stringify(p)}` : key)) as never

/** The cards' task ids under one column's section. */
const column = (html: string, key: string): string[] => {
  const at = html.indexOf(`aria-label="${key}"`)
  const end = html.indexOf('</section>', at)
  return [...html.slice(at, end).matchAll(/title="title (\w+)"/g)].map((m) => m[1])
}

describe('TasksPage', () => {
  it('puts every Task of the project, across plans, in its column; archived plans are left out', () => {
    const snapshot = {
      projectFolderBusy: false,
      runs: [
        row('a', { tasks: [task('p1', { board: { category: 'queued', reason: { kind: 'deps', waitingOn: [] } } }), task('w1', { status: 'dispatched', startedAt: 'x', board: { category: 'running' } })] }),
        row('b', { tasks: [task('r1', { status: 'reviewing', board: { category: 'awaiting-review' } }), task('n1', { status: 'failed', board: { category: 'failed' } }), task('d1', { status: 'completed', board: { category: 'done' } })] }),
        row('z', { archivedAt: 'x', tasks: [task('gone')] })
      ]
    }
    const html = renderToStaticMarkup(React.createElement(TasksPage, { accounts: [], currentProject: null, layout: null, orchSnapshot: snapshot, t } as never))
    expect(column(html, 'pages.tasks.col.planned')).toEqual(['p1'])
    expect(column(html, 'pages.tasks.col.working')).toEqual(['w1'])
    expect(column(html, 'pages.tasks.col.needsYou')).toEqual(['n1'])
    expect(column(html, 'pages.tasks.col.review')).toEqual(['r1'])
    expect(column(html, 'pages.tasks.col.done')).toEqual(['d1'])
    expect(html).not.toContain('title gone')
    // the plan filter pills: All plans, then each live plan
    expect(html).toContain('pages.tasks.allPlans')
    expect(html).toContain('plan a')
    expect(html).toContain('plan b')
    // a card that needs you has the danger border when it failed
    expect(html).toMatch(/ui-card--danger[^"]*"[^>]*>(?:(?!<\/button>).)*title n1/)
  })

  it('Done keeps the last 20 per plan and counts the rest', () => {
    const done = Array.from({ length: 23 }, (_, i) => task(`d${i}`, { status: 'completed', board: { category: 'done' } }))
    const html = renderToStaticMarkup(
      React.createElement(TasksPage, { accounts: [], currentProject: null, layout: null, orchSnapshot: { projectFolderBusy: false, runs: [row('a', { tasks: done })] }, t } as never)
    )
    expect(column(html, 'pages.tasks.col.done')).toHaveLength(20)
    expect(column(html, 'pages.tasks.col.done')[0]).toBe('d3')
    expect(html).toContain('pages.tasks.olderDone{&quot;count&quot;:3}')
  })
})

describe('Plans list', () => {
  const noop = (): void => {}
  const acts = {
    hostGate: null, stall: null, projectPath: '/p',
    canOpenSession: () => false, onOpenSession: noop, onOpenRun: noop, onNewRun: noop, onNewFromSource: noop,
    onPauseRun: noop, onResumeRun: noop, onDeleteRun: noop, onRestartCoordinator: noop, onApprove: noop,
    onRenameJob: noop, onArchiveJob: noop, onUnarchiveJob: noop, onHoldJob: noop
  }
  const render = (runs: JobRow[], over: Record<string, unknown> = {}): string =>
    renderToStaticMarkup(React.createElement(PlansList, { ...acts, snapshot: { runs, projectFolderBusy: false }, ...over }))

  it('draws the rows in the Plans order, under their area heads, with queue and overlap chips', () => {
    const html = render([
      row('q', { pendingStart: true, after: 'r', areas: ['auth'] }),
      row('r', { areas: ['auth'], overlapPlans: ['q'], createdAt: new Date(Date.now() - 120_000).toISOString() })
    ])
    expect(html.indexOf('plans-group-head')).toBeLessThan(html.lastIndexOf('plan r'))
    expect(html.lastIndexOf('plan r')).toBeLessThan(html.lastIndexOf('plan q'))
    expect(html).toContain('pages.plans.startsAfter')
    expect(html).toContain('pages.plans.overlaps')
    expect(html).toContain('pages.plans.age')
  })

  it('has the header actions, the coordinator strip of live plans, approve, row menus and the archived toggle', () => {
    const html = render([
      row('live', { tasks: [task('w', { status: 'dispatched', startedAt: 'x', provider: 'claude', wave: 1 }), task('d', { status: 'completed' })] }),
      row('wait', { pendingStart: true }),
      row('done', { outcome: 'completed' }),
      row('old', { archivedAt: 'x' }),
      row('sched', { schedule: { kind: 'interval', everyMs: 60_000 } as never, paused: true })
    ])
    expect(html).toContain('ui-page-header')
    expect(html).toContain('jobs.new.open')
    expect(html).toContain('jobs.source.open')
    expect(html).toContain('pages.plans.viewOptions')
    expect(html).toContain('pages.plans.viewHint')
    // the strip: live and waiting only, with state, wave and workers
    const strip = html.slice(html.indexOf('plans-strip'), html.indexOf('plans-group'))
    expect(strip).toContain('plan live')
    expect(strip).toContain('plan wait')
    expect(strip).not.toContain('plan done')
    expect(strip).not.toContain('plan sched')
    expect(strip).toContain('pages.plans.state.running')
    expect(strip).toContain('pages.plans.state.approval')
    expect(strip).toContain('pages.plans.wave')
    expect(strip).toContain('pages.plans.working')
    expect(html).toContain('jobs.run.approve')
    expect(html).toContain('pages.plans.more')
    expect(html).toContain('jobs.run.resume')
    expect(html).toContain('jobs.lifecycle.showArchived')
    expect(html).not.toContain('plan old')
    // the delivery setting is not above the list any more
    expect(html).not.toContain('delivery.label')
  })

  it('has one empty state, with New job, and none of the strip', () => {
    const html = render([])
    expect(html.match(/ui-empty"/g)).toHaveLength(1)
    expect(html).toContain('jobs.empty')
    expect(html).not.toContain('plans-strip')
    expect(render([], { projectPath: undefined })).toContain('jobs.noProject')
  })
})

describe('storedSection (the plan section remembered per plan)', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('reads the last section used, maps old names, and is Overview without storage', () => {
    const store = new Map<string, string>([['cm.planSection.j1', 'journal'], ['cm.planSection.j2', 'board']])
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) })
    expect(storedSection('j1')).toBe('journal')
    expect(storedSection('j2')).toBe('waves')
    expect(storedSection('j3')).toBe('overview')
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') } })
    expect(storedSection('j1')).toBe('overview')
  })
})
