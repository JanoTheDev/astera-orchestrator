// W9-C: the Tasks board and the Plans list as they render (renderToStaticMarkup, no DOM), and the plan section a plan
// page opens on. The rules themselves are planBoard.ts's (planBoard.test.ts).
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { JobRow, JobTask } from '../../../../core/types'

vi.mock('../../i18n/I18nProvider', () => ({ useI18n: () => ({ lang: 'en', t: (key: string) => key }) }))

const { TasksPage } = await import('./TasksPage')
const { PlanList } = await import('../plan/PlanList')
const { storedSection } = await import('./PlansPage')
const { planListOrder } = await import('../plan/planBoard')

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
  const acts = { onOpen: () => {}, canOpenSession: () => false, onOpenSession: () => {}, onDelete: () => {}, onArchive: () => {}, onRename: () => {}, onHold: () => {} }
  const render = (runs: JobRow[], over: Record<string, unknown> = {}): string =>
    renderToStaticMarkup(
      React.createElement(PlanList, {
        snapshot: { runs, projectFolderBusy: false }, hostGate: null, stall: null, projectPath: '/p', acts,
        onNewRun: () => {}, onNewFromSource: () => {}, onNewConsole: () => {}, overlap: null, ...over
      })
    )

  it('draws the rows in the Plans order, under their area heads, with status, wave, progress, queue and overlap chips', () => {
    const html = render([
      row('q', { pendingStart: true, after: 'r', areas: ['auth'] }),
      row('r', { areas: ['auth'], overlapPlans: ['q'], done: 1, total: 4, wave: { at: 2, of: 3 }, createdAt: new Date(Date.now() - 120_000).toISOString() })
    ])
    const list = html.slice(html.indexOf('class="plans-list"'))
    expect(list.indexOf('plans-group')).toBeLessThan(list.indexOf('plan r'))
    expect(list.indexOf('>plan r<')).toBeLessThan(list.indexOf('>plan q<'))
    expect(html).toContain('pages.plans.startsAfter')
    expect(html).toContain('pages.plans.overlaps')
    expect(html).toContain('pages.plans.age')
    expect(html).toContain('pages.plans.wave')
    expect(html).toContain('pages.plans.progress')
    expect(html).toContain('pages.plans.status.working')
    // the header: New job primary, From a source ghost, and the Coordinator strip over the live plans
    expect(html).toMatch(/ui-btn--primary[^>]*>.*jobs\.new\.open/)
    expect(html).toContain('jobs.source.open')
    expect(html).toContain('class="plans-coord__title">pages.plans.coordinator<')
  })

  it('names a plan made from a ticket by its title, the objective staying the tooltip (moved from JobsView.title.test)', () => {
    const source = { id: 's', itemId: 'ENG-101', label: 'Linear ENG-101', title: 'Fix the login page on Safari' }
    const html = render([row('a', { objective: 'Resolve Linear ENG-101', source })])
    expect(html).toMatch(/title="Resolve Linear ENG-101"[^>]*>(?:<[^>]+>)*Fix the login page on Safari/)
  })

  it('hides archived plans behind the archived chip, and has one empty state with New job, or New console without a project', () => {
    const html = render([row('a'), row('z', { archivedAt: 'x', objective: 'gone plan' })])
    expect(html).toContain('jobs.lifecycle.showArchived')
    expect(html).not.toContain('gone plan')
    expect(render([])).toContain('pages.plans.empty.title')
    const none = render([], { projectPath: undefined })
    expect(none).toContain('jobs.noProject')
    expect(none).toContain('wall.new')
    expect(none).not.toContain('jobs.new.open')
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
