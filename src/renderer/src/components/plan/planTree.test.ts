/// <reference types="node" />
// T7 Plans tree: the rows of each group-by, their order, the filter (plan names and Task titles), archived plans, the
// overlap decoration, the step level, the menu's Pause / Resume, the plan tab sections, and the order a plan row is cut in.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { JobRow, JobTask } from '../../../../core/types'
import { nextPlanOpen, planAnchorOf } from './planPage'
import { planSectionOf } from './planBoard'
import {
  groupByOf,
  groupCount,
  needsYouOf,
  openByDefault,
  overlapOf,
  pauseActionOf,
  planDescription,
  finishedDescription,
  planTreeRows,
  statusGroupOf,
  stepsOf,
  taskDescription,
  taskSection,
  type GroupBy,
  type PlanNode,
  type PlanTreeRow
} from './planTree'

const task = (id: string, over: Partial<JobTask> = {}): JobTask => ({ id, title: `title ${id}`, status: 'pending', openGates: 0, ...over })
const row = (id: string, over: Partial<JobRow> = {}): JobRow => ({
  id, objective: `plan ${id}`, outcome: 'running', done: 0, total: 0, eventCount: 0, sharesProjectFolder: false, tasks: [], ...over
})
const t = ((key: string, p?: Record<string, unknown>) => (p ? `${key}${JSON.stringify(p)}` : key)) as never
const allOpen = (): boolean => true
const defaults = (_id: string, node: PlanNode): boolean => openByDefault(node)
const ids = (groupBy: GroupBy, rows: JobRow[], over: { filter?: string; showArchived?: boolean; isOpen?: typeof defaults } = {}): string[] =>
  planTreeRows({ rows, groupBy, filter: over.filter ?? '', showArchived: over.showArchived ?? false, isOpen: over.isOpen ?? allOpen }).map((r) => r.id)

describe('planTreeRows', () => {
  const rows = [
    row('done', { outcome: 'completed', tasks: [task('d1', { status: 'completed', wave: 0 })] }),
    row('run', {
      areas: ['auth'],
      tasks: [task('a', { status: 'completed', wave: 0 }), task('b', { status: 'dispatched', startedAt: 'x', wave: 1 }), task('c', { status: 'blocked', wave: 1 })]
    }),
    row('gone', { archivedAt: 'x', tasks: [task('g1')] })
  ]

  it('Plans: plans in the list order (running before done), each with its steps and Tasks; archived ones hidden', () => {
    expect(ids('plans', rows)).toEqual([
      'plan:run',
      'plan:run/step:0',
      'plan:run/step:0/task:a',
      'plan:run/step:1',
      'plan:run/step:1/task:b',
      'plan:run/step:1/task:c',
      'plan:done',
      'plan:done/task:d1'
    ])
    expect(ids('plans', rows, { showArchived: true })).toContain('plan:gone')
  })

  it('plans start closed, groups and steps open; a closed row hides its subtree', () => {
    expect(ids('plans', rows, { isOpen: defaults })).toEqual(['plan:run', 'plan:done'])
    const r = planTreeRows({ rows, groupBy: 'plans', filter: '', showArchived: false, isOpen: defaults })
    expect(r[0]).toMatchObject({ hasChildren: true, expanded: false, depth: 0 })
  })

  it('Status: the old All tasks board as groups of Task rows, empty groups left out', () => {
    expect(ids('status', rows)).toEqual([
      'status:needs',
      'status:needs/task:run:c',
      'status:running',
      'status:running/task:run:b',
      'status:done',
      'status:done/task:run:a',
      'status:done/task:done:d1'
    ])
    expect(groupCount(rows, 'status', 'done', false)).toBe(2)
  })

  it('Area: plans under their first area, the ones with none last', () => {
    expect(ids('area', rows, { isOpen: defaults })).toEqual(['area:auth', 'area:auth/plan:run', 'area:', 'area:/plan:done'])
    expect(groupCount(rows, 'area', 'auth', false)).toBe(1)
  })

  it('the filter keeps a plan whose name matches whole, and of the others only the matching Tasks, opened down to them', () => {
    expect(ids('plans', rows, { filter: 'PLAN DONE', isOpen: defaults })).toEqual(['plan:done'])
    expect(ids('plans', rows, { filter: 'title b', isOpen: defaults })).toEqual(['plan:run', 'plan:run/step:1', 'plan:run/step:1/task:b'])
    expect(ids('status', rows, { filter: 'title b' })).toEqual(['status:running', 'status:running/task:run:b'])
    expect(ids('area', rows, { filter: 'title d1', isOpen: defaults })).toEqual(['area:', 'area:/plan:done', 'area:/plan:done/task:d1'])
    expect(ids('plans', rows, { filter: 'nothing like it' })).toEqual([])
  })

  it("a schedule's rounds sit under it, each with its own Tasks", () => {
    const sched = row('s', { schedule: { kind: 'interval', minutes: 60 } as never, children: [row('r1', { tasks: [task('x')] })] })
    expect(ids('plans', [sched])).toEqual(['plan:s', 'plan:s/plan:r1', 'plan:s/plan:r1/task:x'])
    // a schedule whose name matches keeps every round, though no round's own name or Task matches
    expect(ids('plans', [sched], { filter: 'plan s' })).toEqual(['plan:s', 'plan:s/plan:r1', 'plan:s/plan:r1/task:x'])
  })

  it("names a plan made from a ticket by the ticket's title (jobName)", () => {
    const source = { id: 's', itemId: 'ENG-101', label: 'Linear ENG-101', title: 'Fix the login page on Safari' }
    expect(ids('plans', [row('a', { objective: 'Resolve Linear ENG-101', source })], { filter: 'safari' })).toEqual(['plan:a'])
  })
})

describe('steps, status and row text', () => {
  it('steps come from Task.wave; one step or an older Runtime without waves draws no step level', () => {
    expect(stepsOf(row('a', { tasks: [task('1', { wave: 1 }), task('2', { wave: 0 })] })).map((s) => s.step)).toEqual([0, 1])
    expect(stepsOf(row('a', { tasks: [task('1', { wave: 0 }), task('2', { wave: 0 })] }))).toEqual([])
    expect(stepsOf(row('a', { tasks: [task('1', { wave: 0 }), task('2')] }))).toEqual([])
  })

  it('sorts a Task into its status group: a person first, then what moves, waits, ended', () => {
    expect(statusGroupOf(task('a', { status: 'blocked' }))).toBe('needs')
    expect(statusGroupOf(task('a', { status: 'reviewing' }))).toBe('running')
    expect(statusGroupOf(task('a', { status: 'ready' }))).toBe('waiting')
    expect(statusGroupOf(task('a', { status: 'failed' }))).toBe('failed')
    expect(statusGroupOf(task('a', { board: { category: 'cancelled' } }))).toBe('done')
    expect(needsYouOf(row('a', { tasks: [task('1', { status: 'blocked' }), task('2')] }))).toBe(1)
  })

  it('a plan row says its step, progress and age; a Task row its account and attempts', () => {
    const at = Date.parse('2026-10-23T12:00:00Z')
    const r = row('a', { wave: { at: 2, of: 3 }, done: 4, total: 7, createdAt: '2026-10-23T09:00:00Z' })
    expect(planDescription(r, at, t)).toBe('pages.plans.tree.stepOf{"at":2,"of":3} · pages.plans.progress{"done":4,"total":7} · pages.plans.age{"age":"3h"}')
    expect(planDescription(row('b'), at, t)).toBe('')
    expect(taskDescription(task('x', { accountId: 'acc', attempts: 2 }), (id) => `@${id}`, t)).toBe('@acc · pages.plans.tree.attempts{"n":2}')
    expect(taskDescription(task('x'), (id) => id, t)).toBe('')
  })

  it('decorates the rows that overlap: a plan names the plans it shares files with, a Task the plan whose lease it waits for', () => {
    const rows = [row('a', { overlapPlans: ['b'] }), row('b', { title: 'Billing' })]
    expect(overlapOf({ kind: 'plan', row: rows[0] }, rows)).toEqual(['Billing'])
    expect(overlapOf({ kind: 'plan', row: rows[1] }, rows)).toBeNull()
    const waits = task('x', { board: { category: 'queued', reason: { kind: 'same-files', waitingOn: { id: 'y', title: 'Y' }, path: 'src', plan: { id: 'b', title: 'Billing' } } } })
    expect(overlapOf({ kind: 'task', row: rows[0], task: waits }, rows)).toEqual(['Billing'])
  })

  it('Pause / Resume as the plan header decides it: a schedule pauses, a live plan holds, an ended one has none', () => {
    expect(pauseActionOf(row('a', { schedule: {} as never }))).toBe('pause-schedule')
    expect(pauseActionOf(row('a', { schedule: {} as never, paused: true }))).toBe('resume-schedule')
    expect(pauseActionOf(row('a'))).toBe('hold')
    expect(pauseActionOf(row('a', { dispatchHold: true }))).toBe('release')
    expect(pauseActionOf(row('a', { outcome: 'completed' }))).toBeNull()
    expect(pauseActionOf(row('a', { pendingStart: true }))).toBeNull()
  })

  it('group-by reads back what was stored, and a stranger value is Plans', () => {
    expect(groupByOf('status')).toBe('status')
    expect(groupByOf('overlap')).toBe('plans')
    expect(groupByOf(null)).toBe('plans')
  })
})

describe('Plans view sections for the plan tab', () => {
  it('a Task click and "Edit plan settings…" send the sections the plan tab scrolls to', () => {
    expect(planAnchorOf(planSectionOf(taskSection('tsk_9')))).toEqual({ kind: 'task', taskId: 'tsk_9' })
    expect(planAnchorOf(planSectionOf('settings'))).toEqual({ kind: 'settings' })
  })

  it('a second click on the same Task is a new open: the section is equal but the seq moves, so the tab scrolls again', () => {
    const first = nextPlanOpen({ seq: 0 }, taskSection('tsk_9'))
    const again = nextPlanOpen(first, taskSection('tsk_9'))
    expect(again.section).toBe(first.section)
    expect(again.seq).not.toBe(first.seq)
  })

  it('the Plans view opens the plan from orchSnapshot (archived plans too) and sets the section on the page state', () => {
    const view = readFileSync(path.join(__dirname, '../views/PlansView.tsx'), 'utf8')
    const body = /const openPlanTab = [\s\S]*?\n  }\n/.exec(view)?.[0] ?? ''
    expect(body).toMatch(/p\.setPlanPage\(\{ page: 'plans', \.\.\.\(section !== undefined \? \{ section \} : \{\}\) \}\)/)
    expect(body).toMatch(/p\.setOpenRun\(\{ projectPath: currentProject, runId: jobId \}\)/)
    expect(body).not.toMatch(/\bopenPlan\(/)
  })
})

describe('plan name truncation priority (plans.css)', () => {
  const css = readFileSync(path.join(__dirname, 'plans.css'), 'utf8')
  const shrink = (sel: string): number => {
    const m = new RegExp(`\\.plans-tree ${sel.replace(/[.]/g, '\\.')} \\{[^}]*flex(?:-shrink)?: ([^;]+);`).exec(css)
    if (!m) throw new Error(`no rule for ${sel}`)
    const parts = m[1].trim().split(/\s+/)
    return parts[0] === 'none' ? 0 : Number(parts.length === 1 ? parts[0] : parts[1])
  }
  it('cuts the description first, then the plan name; the status word is never cut', () => {
    expect(shrink('.ui-tree__desc')).toBeGreaterThan(shrink('.ui-tree__label'))
    expect(shrink('.ui-tree__label')).toBeGreaterThan(0)
    expect(shrink('.ui-tree__meta')).toBe(0)
    expect(css).not.toMatch(/\.plans-tree \.ui-tree__deco \{[^}]*text-overflow/)
  })
})

describe('planTreeRows keepOrder', () => {
  it('lists the plans as given instead of by rank (the Finished pane sorts by finishedAt)', () => {
    const rows = [row('a', { outcome: 'completed', archivedAt: 'x' }), row('b', { outcome: 'completed' })]
    const ids = (keepOrder: boolean): string[] =>
      planTreeRows({ rows, groupBy: 'plans', filter: '', showArchived: true, keepOrder, isOpen: () => false }).map((r) => r.id)
    expect(ids(false)).toEqual(['plan:b', 'plan:a'])
    expect(ids(true)).toEqual(['plan:a', 'plan:b'])
  })

  // The done plan comes first in the input; planListOrder would put the running one first, so a re-sort shows.
  const finished = row('done', { outcome: 'completed', tasks: [task('t1', { status: 'completed' })] })
  const live = row('live', { outcome: 'running', tasks: [task('t2', { status: 'completed' })] })
  const plansOf = (r: JobRow[], groupBy: GroupBy, keepOrder: boolean): PlanTreeRow[] =>
    planTreeRows({ rows: r, groupBy, filter: '', showArchived: false, keepOrder, isOpen: () => true })

  it('Group by status: keepOrder keeps the input order inside each group; without it the group is re-sorted', () => {
    const doneTasks = (keepOrder: boolean): string[] =>
      plansOf([finished, live], 'status', keepOrder).map((r) => r.id).filter((id) => id.startsWith('status:done/task:'))
    expect(doneTasks(true)).toEqual(['status:done/task:done:t1', 'status:done/task:live:t2'])
    expect(doneTasks(false)).toEqual(['status:done/task:live:t2', 'status:done/task:done:t1'])
  })

  it('Group by area: keepOrder keeps the input order inside each area group; without it the group is re-sorted', () => {
    const plansIn = (keepOrder: boolean): string[] =>
      plansOf([{ ...finished, areas: ['auth'] }, { ...live, areas: ['auth'] }], 'area', keepOrder)
        .filter((r) => r.node.kind === 'plan')
        .map((r) => r.id)
    expect(plansIn(true)).toEqual(['area:auth/plan:done', 'area:auth/plan:live'])
    expect(plansIn(false)).toEqual(['area:auth/plan:live', 'area:auth/plan:done'])
  })
})

describe('finishedDescription', () => {
  it('says the progress and how long ago the plan finished', () => {
    const t = ((k: string, p?: Record<string, unknown>) => `${k}${p ? JSON.stringify(p) : ''}`) as never
    const now = Date.parse('2026-10-24T12:00:00Z')
    const done = row('d', { outcome: 'completed', done: 3, total: 3, finishedAt: '2026-10-24T10:00:00Z' })
    expect(finishedDescription(done, now, t)).toBe('pages.plans.progress{"done":3,"total":3} · pages.plans.finishedAge{"age":"2h"}')
    expect(finishedDescription(row('e', { outcome: 'completed' }), now, t)).toBe('')
  })
})
