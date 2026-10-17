import { describe, it, expect } from 'vitest'
import type { Dispatch, Job, JobRun, Project, Task } from '../../../../core/orchestration/types'
import { addTab, createGroup, leaves, splitAndMove, type PaneNode } from '../../../../core/panes/tree'
import { appTab, fileTab, sessionTab } from '../../../../core/panes/tabId'
import { buildWorkspaceTree, findPlan, planSessions, scopeLayout, type WorkspaceData } from './workspaceTree'

const project = (id: string, name: string): Project => ({ id, name, path: `/repos/${name}`, addedAt: '2026-10-01T00:00:00Z' })
const job = (id: string, over: Partial<Job> = {}): Job => ({ id, objective: `objective of ${id}`, cwd: '/repos/x', createdAt: '2026-10-01T00:00:00Z', ...over })
const run = (id: string, jobId: string, ordinal: number, over: Partial<JobRun> = {}): JobRun => ({ id, jobId, ordinal, createdAt: '2026-10-01T00:00:00Z', ...over })
const task = (id: string, runId: string, over: Partial<Task> = {}): Task => ({
  id, runId, title: `task ${id}`, spec: '', deps: [], status: 'dispatched', consecutiveFailures: 0, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', ...over
})
const dispatch = (id: string, taskId: string, startedAt: string, over: Partial<Dispatch> = {}): Dispatch => ({
  id, taskId, provider: 'claude', accountId: 'acc1', sessionId: `s-${id}`, cwd: `/wt/${id}`, specPath: '', startedAt, workerState: 'running', retained: false, ...over
} as Dispatch)

const data = (over: Partial<WorkspaceData> = {}): WorkspaceData => ({ projects: [], jobsByProject: {}, runs: [], tasks: [], dispatches: [], gates: [], ...over })

describe('buildWorkspaceTree', () => {
  it('nests projects → plans, names a plan by its title (jobNameOf) and lists the latest run', () => {
    const tree = buildWorkspaceTree(
      data({
        projects: [project('p1', 'Gameful'), project('p2', 'Other')],
        jobsByProject: { p1: [job('j1', { title: 'Trading' }), job('j2')] },
        runs: [run('r1', 'j1', 1, { coordinatorSessionId: 'old' }), run('r2', 'j1', 2, { coordinatorSessionId: 'coord' })]
      }),
      { showArchived: false }
    )
    expect(tree.map((p) => [p.name, p.plans.map((j) => j.name)])).toEqual([
      ['Gameful', ['Trading', 'objective of j2']],
      ['Other', []]
    ])
    const trading = tree[0].plans[0]
    expect(trading.runId).toBe('r2')
    expect(trading.coordinator.map((s) => [s.sessionId, s.label])).toEqual([['coord', 'Trading Coordinator']])
    expect(tree[0].plans[1].runId).toBeUndefined()
  })

  it('hides archived plans unless asked, and marks them', () => {
    const d = data({ projects: [project('p1', 'G')], jobsByProject: { p1: [job('j1'), job('j2', { archivedAt: '2026-10-02T00:00:00Z' })] } })
    expect(buildWorkspaceTree(d, { showArchived: false })[0].plans.map((p) => p.jobId)).toEqual(['j1'])
    const all = buildWorkspaceTree(d, { showArchived: true })[0].plans
    expect(all.map((p) => [p.jobId, p.archived])).toEqual([['j1', false], ['j2', true]])
  })

  it('reads a paused plan from the Job or its latest Run', () => {
    const d = data({
      projects: [project('p1', 'G')],
      jobsByProject: { p1: [job('j1', { paused: true }), job('j2')] },
      runs: [run('r2', 'j2', 1, { paused: true })]
    })
    expect(buildWorkspaceTree(d, { showArchived: false })[0].plans.map((p) => p.paused)).toEqual([true, true])
  })
})

describe('session grouping', () => {
  const base = (): WorkspaceData =>
    data({
      projects: [project('p1', 'Gameful')],
      jobsByProject: { p1: [job('j1', { title: 'Trading' })] },
      runs: [run('r1', 'j1', 1, { coordinatorSessionId: 'coord' })],
      tasks: [task('t1', 'r1', { model: 'sonnet' }), task('t2', 'r1'), task('t3', 'r1', { status: 'pending' }), task('tx', 'rOther')],
      dispatches: [
        dispatch('d2', 't2', '2026-10-01T10:00:00Z', { model: 'opus', accountId: 'acc2' }),
        dispatch('d1', 't1', '2026-10-01T11:00:00Z'),
        // a retry of t2: it replaces d2 as the live session, and t2 keeps its number
        dispatch('d2b', 't2', '2026-10-01T12:00:00Z', { model: 'haiku' }),
        dispatch('dx', 'tx', '2026-10-01T09:00:00Z')
      ]
    })

  it('groups the lead session as Coordinator and one Worker per dispatched Task, numbered by first dispatch', () => {
    const plan = buildWorkspaceTree(base(), { showArchived: false })[0].plans[0]
    expect(plan.planner).toEqual([])
    expect(plan.coordinator.map((s) => s.sessionId)).toEqual(['coord'])
    expect(plan.workers.map((s) => [s.label, s.sessionId, s.taskTitle, s.model, s.cwd])).toEqual([
      ['Trading Worker 1', 's-d2b', 'task t2', 'haiku', '/wt/d2b'],
      ['Trading Worker 2', 's-d1', 'task t1', 'sonnet', '/wt/d1']
    ])
    expect(plan.workers.every((s) => s.projectName === 'Gameful' && s.planName === 'Trading')).toBe(true)
    // another Run's Task and its Dispatch never land in this plan
    expect(planSessions(plan).map((s) => s.sessionId)).not.toContain('s-dx')
  })

  it('lists the planners the Job records (W2-A Job.plannerSessionIds), apart from its coordinator', () => {
    const d = base()
    d.jobsByProject.p1 = [job('j1', { title: 'Trading', plannerSessionIds: ['pl1', 'pl2'] })]
    const plan = buildWorkspaceTree(d, { showArchived: false })[0].plans[0]
    expect(plan.planner.map((s) => [s.sessionId, s.label, s.role])).toEqual([
      ['pl1', 'Trading Planner 1', 'planner'],
      ['pl2', 'Trading Planner 2', 'planner']
    ])
    expect(plan.coordinator.map((s) => s.sessionId)).toEqual(['coord'])
  })

  it('takes an external coordinator when Astera did not start one', () => {
    const d = base()
    d.runs = [run('r1', 'j1', 1, { externalCoordinatorSessionId: 'ext' })]
    expect(buildWorkspaceTree(d, { showArchived: false })[0].plans[0].coordinator.map((s) => s.sessionId)).toEqual(['ext'])
  })

  it('findPlan finds a plan across projects', () => {
    const tree = buildWorkspaceTree(base(), { showArchived: false })
    expect(findPlan(tree, 'j1')?.name).toBe('Trading')
    expect(findPlan(tree, 'nope')).toBeUndefined()
  })

  // W3-D routing: "plan A worker 2" names one session, and it is never another plan's.
  it('two plans dispatching interleaved: each plan’s Worker 2 is its own Task’s session, and no session is in both', () => {
    const d = data({
      projects: [project('p1', 'Gameful'), project('p2', 'Other')],
      jobsByProject: { p1: [job('jA', { title: 'A' })], p2: [job('jB', { title: 'B' })] },
      runs: [run('rA', 'jA', 1, { coordinatorSessionId: 'coordA' }), run('rB', 'jB', 1, { coordinatorSessionId: 'coordB' })],
      tasks: [task('a1', 'rA'), task('a2', 'rA'), task('b1', 'rB'), task('b2', 'rB')],
      dispatches: [
        dispatch('da1', 'a1', '2026-10-01T01:00:00Z'),
        dispatch('db1', 'b1', '2026-10-01T02:00:00Z'),
        dispatch('da2', 'a2', '2026-10-01T03:00:00Z'),
        dispatch('db2', 'b2', '2026-10-01T04:00:00Z')
      ]
    })
    const tree = buildWorkspaceTree(d, { showArchived: false })
    const a = findPlan(tree, 'jA')!
    const b = findPlan(tree, 'jB')!
    expect(a.workers[1]).toMatchObject({ label: 'A Worker 2', sessionId: 's-da2', taskTitle: 'task a2', projectName: 'Gameful' })
    expect(b.workers[1]).toMatchObject({ label: 'B Worker 2', sessionId: 's-db2', taskTitle: 'task b2', projectName: 'Other' })
    const ofA = new Set(planSessions(a).map((s) => s.sessionId))
    expect(planSessions(b).filter((s) => ofA.has(s.sessionId))).toEqual([])
  })
})

describe('scopeLayout', () => {
  const tabsOf = (n: PaneNode | null): string[][] => (n ? leaves(n).map((l) => l.tabIds) : [])

  it('drops session and app-mirror tabs of other sessions, keeps the plan’s and non-session tabs', () => {
    let root: PaneNode = createGroup(sessionTab('a'))
    root = addTab(root, root.id, sessionTab('b'))
    root = addTab(root, root.id, fileTab('/x.ts'))
    root = addTab(root, root.id, appTab('b'))
    const out = scopeLayout(root, new Set(['a']))
    expect(tabsOf(out)).toEqual([[sessionTab('a'), fileTab('/x.ts')]])
  })

  it('moves the active tab off a dropped one and collapses a pane left empty', () => {
    const g = createGroup(sessionTab('a'))
    const split = splitAndMove(addTab(g, g.id, sessionTab('keep')), sessionTab('b'), g.id, 'row', false)!
    const out = scopeLayout(split.root, new Set(['keep']))
    expect(tabsOf(out)).toEqual([[sessionTab('keep')]])
    expect(out && leaves(out)[0].activeTabId).toBe(sessionTab('keep'))
  })

  it('is null when the plan has no open tab, and leaves the given layout untouched', () => {
    const root = createGroup(sessionTab('a'))
    const before = JSON.stringify(root)
    expect(scopeLayout(root, new Set())).toBeNull()
    expect(JSON.stringify(root)).toBe(before)
    expect(scopeLayout(null, new Set(['a']))).toBeNull()
  })
})
