import { describe, it, expect } from 'vitest'
import type { Dispatch, Job, JobRun, Project, Task } from '../../../core/orchestration/types'
import { addTab, createGroup, leaves, splitAndMove, type PaneNode } from '../../../core/panes/tree'
import { appTab, fileTab, sessionTab, viewTab } from '../../../core/panes/tabId'
import { buildWorkspaceTree, findPlan, otherProjectPlanIds, planSessions, scopeLayout, type WorkspaceData } from './workspaceTree'
import {
  entryTab, OTHER_WORKSPACE, projectOfCwd, projectStatusDot, workspacesOf, scopeIds, workspaceFolderOf, workspaceSessionIds, workspaceSummaries, type WorkspaceProject
} from './workspaceTree'

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

  it('lists workspaces only: a sub-project is no row, its plan arrives in its workspace list (T1)', () => {
    const root = project('p1', 'Gameful')
    const sub: Project = { ...project('p1s', 'values'), path: root.path, parentId: 'p1' }
    const tree = buildWorkspaceTree(
      data({ projects: workspacesOf([root, sub]), jobsByProject: { p1: [job('j1', { title: 'Values', projectId: 'p1s' })] } }),
      { showArchived: false }
    )
    expect(tree.map((p) => [p.name, p.plans.map((j) => j.name)])).toEqual([['Gameful', ['Values']]])
    expect(tree[0].plans[0].subProjectId).toBe('p1s')
  })

  it('a plan is live while its latest Run has a Task not finished, and counts the open questions of its Runs (T11)', () => {
    const d = data({
      projects: [project('p1', 'Gameful')],
      jobsByProject: { p1: [job('j1'), job('j2'), job('j3', { paused: true })] },
      runs: [run('r1', 'j1', 1), run('r2', 'j1', 2), run('r3', 'j2', 1), run('r4', 'j3', 1)],
      tasks: [task('t1', 'r2'), task('t2', 'r3', { status: 'completed' }), task('t3', 'r4')],
      gates: [
        { id: 'g1', runId: 'r1', taskId: 't0', question: 'old run?', status: 'open', createdAt: '' },
        { id: 'g2', runId: 'r2', taskId: 't1', question: 'which?', status: 'open', createdAt: '' },
        { id: 'g3', runId: 'r2', taskId: 't1', question: 'done', status: 'resolved', createdAt: '' }
      ]
    })
    const plans = buildWorkspaceTree(d, { showArchived: false })[0].plans
    expect(plans.map((p) => [p.jobId, p.live, p.questions])).toEqual([['j1', true, 2], ['j2', false, 0], ['j3', false, 0]])
    expect(plans[0].subProjectId).toBeUndefined()
  })

  it('lists registered projects that have no plans at all (#78)', () => {
    const tree = buildWorkspaceTree(data({ projects: [project('p1', 'Bare')] }), { showArchived: false })
    expect(tree.map((p) => [p.name, p.plans.length])).toEqual([['Bare', 0]])
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

  describe('plan view tabs', () => {
    const tree = [
      { id: 'pA', plans: [{ jobId: 'jA', runId: 'rA' }] },
      { id: 'pB', plans: [{ jobId: 'jB', runId: 'rB' }, { jobId: 'jB2' }] }
    ] as unknown as WorkspaceProject[]
    let root: PaneNode = createGroup(sessionTab('a'))
    for (const arg of ['jA', 'rB', 'jB2', 'unknown']) root = addTab(root, root.id, viewTab('plan', arg))
    root = addTab(root, root.id, viewTab('settings'))

    it('hides another project’s plan tab by job or run id, keeps own, unknown and non-plan tabs', () => {
      const out = scopeLayout(root, new Set(['a']), otherProjectPlanIds(tree, 'pA'))
      expect(tabsOf(out)).toEqual([[sessionTab('a'), viewTab('plan', 'jA'), viewTab('plan', 'unknown'), viewTab('settings')]])
    })

    it('shows every plan tab with no hidden set (All projects)', () => {
      expect(otherProjectPlanIds(tree, null).size).toBe(0)
      expect(tabsOf(scopeLayout(root, new Set(['a']), otherProjectPlanIds(tree, null)))[0]).toHaveLength(6)
    })

    it('entryTab ignores a remembered plan tab that is hidden, takes it once shown again', () => {
      const keep = new Set(['a'])
      expect(entryTab(root, keep, viewTab('plan', 'rB'), otherProjectPlanIds(tree, 'pA'))).toBe(sessionTab('a'))
      expect(entryTab(root, keep, viewTab('plan', 'rB'), otherProjectPlanIds(tree, 'pB'))).toBe(viewTab('plan', 'rB'))
    })
  })

  it('is null when the plan has no open tab, and leaves the given layout untouched', () => {
    const root = createGroup(sessionTab('a'))
    const before = JSON.stringify(root)
    expect(scopeLayout(root, new Set())).toBeNull()
    expect(JSON.stringify(root)).toBe(before)
    expect(scopeLayout(null, new Set(['a']))).toBeNull()
  })
})

// W6-F: one workspace per project
describe('project workspaces', () => {
  const plan = (jobId: string, projectId: string, workers: string[], over: Partial<WorkspaceProject['plans'][number]> = {}) => ({
    jobId, projectId, name: jobId, archived: false, paused: false, planner: [], coordinator: [],
    workers: workers.map((sessionId) => ({ sessionId, role: 'worker' as const, label: sessionId, projectName: projectId, planName: jobId })),
    ...over
  })
  const tree: WorkspaceProject[] = [
    {
      id: 'g', name: 'gameful', path: '/repos/gameful',
      plans: [
        plan('trading', 'g', ['w1'], {
          planner: [{ sessionId: 'pl', role: 'planner', label: 'pl', projectName: 'g', planName: 'trading' }],
          coordinator: [{ sessionId: 'co', role: 'coordinator', label: 'co', projectName: 'g', planName: 'trading' }]
        }),
        plan('redis', 'g', ['w2'])
      ]
    },
    { id: 'a', name: 'Astera', path: '/repos/astera', plans: [] },
    { id: 'n', name: 'nested', path: '/repos/astera/packages/client', plans: [] }
  ]
  const worktrees = [{ path: '/home/me/astera-worktrees/gameful/fix-1', repoPath: '/repos/gameful' }]
  const s = (id: string, cwd: string, status = 'running') => ({ id, cwd, status })
  const sessions = [
    s('w1', '/home/me/astera-worktrees/gameful/trading-1'), // a plan's worker, whatever its cwd
    s('own', '/repos/gameful/src'), // a plain tab in the project folder
    s('wt', '/home/me/astera-worktrees/gameful/fix-1/app'), // a plain tab in one of its worktrees
    s('ast', '/repos/astera/'),
    s('deep', '/repos/astera/packages/client/src'),
    s('elsewhere', '/home/me'),
    s('sibling', '/repos/gameful-old', 'exited')
  ]
  const ids = workspaceSessionIds(tree, sessions, worktrees)

  it('a project holds its plans’ planner, coordinator and workers, and the tabs in its folder or worktrees', () => {
    expect([...ids.get('g')!].sort()).toEqual(['co', 'own', 'pl', 'w1', 'w2', 'wt'])
    expect([...ids.get('a')!]).toEqual(['ast'])
    // the deepest project wins, and a folder that only starts with a project's name is not inside it
    expect([...ids.get('n')!]).toEqual(['deep'])
    expect([...ids.get(OTHER_WORKSPACE)!].sort()).toEqual(['elsewhere', 'sibling'])
    expect(projectOfCwd('/repos/gameful', tree, [])).toBe('g')
    expect(projectOfCwd('/tmp', tree, worktrees)).toBeNull()
  })

  it('a plan narrows its project, a project scopes to its sessions, nothing open scopes nothing', () => {
    expect([...scopeIds(tree, ids, 'g', 'redis')!]).toEqual(['w2'])
    expect([...scopeIds(tree, ids, 'a', null)!]).toEqual(['ast'])
    expect(scopeIds(tree, ids, null, null)).toBeNull()
    expect([...scopeIds(tree, ids, 'gone', null)!]).toEqual([])
  })

  it('switching back focuses the tab the workspace had, while it still shows it', () => {
    let root: PaneNode = createGroup(sessionTab('own'))
    root = addTab(root, root.id, sessionTab('ast'))
    root = addTab(root, root.id, sessionTab('w1'))
    root = addTab(root, root.id, fileTab('/repos/gameful/README.md'))
    const g = ids.get('g')!
    expect(entryTab(root, g, sessionTab('w1'))).toBe(sessionTab('w1'))
    // a remembered file tab is still one of its tabs
    expect(entryTab(root, g, fileTab('/repos/gameful/README.md'))).toBe(fileTab('/repos/gameful/README.md'))
    // a remembered tab another workspace holds (or a closed one) falls back to its first session tab
    expect(entryTab(root, g, sessionTab('ast'))).toBe(sessionTab('own'))
    expect(entryTab(root, g, sessionTab('closed'))).toBe(sessionTab('own'))
    expect(entryTab(root, new Set(['nobody']))).toBeUndefined()
    expect(entryTab(root, null, sessionTab('ast'))).toBe(sessionTab('ast'))
  })

  it('a new tab in a project workspace starts in its folder', () => {
    expect(workspaceFolderOf(tree, 'a')).toBe('/repos/astera')
    expect(workspaceFolderOf(tree, OTHER_WORKSPACE)).toBeNull()
    expect(workspaceFolderOf(tree, null)).toBeNull()
  })

  it('the switcher counts each workspace’s running tabs and marks one waiting for input', () => {
    const zero = { plans: 0, questions: 0, dirty: 0, unpushed: 0, behind: 0 }
    expect(workspaceSummaries(tree, ids, sessions, { own: 'waiting', ast: 'working', sibling: 'waiting' })).toEqual([
      { id: 'g', name: 'gameful', running: 3, working: 0, waiting: true, ...zero }, // w1, own, wt: the rest have no open session
      { id: 'a', name: 'Astera', running: 1, working: 1, waiting: false, ...zero },
      { id: 'n', name: 'nested', running: 1, working: 0, waiting: false, ...zero },
      // an exited tab is not running, and its stale wait is no dot
      { id: OTHER_WORKSPACE, name: 'Other', running: 1, working: 0, waiting: false, ...zero }
    ])
    // "Other" is left out while it holds no tab
    const none = workspaceSessionIds(tree, [], [])
    expect(workspaceSummaries(tree, none, [], {}).map((r) => r.id)).toEqual(['g', 'a', 'n'])
  })

  it('nests each sub-project under its workspace with only its own plans, and gives the workspace its git line (T11)', () => {
    const withSub: WorkspaceProject[] = [
      { ...tree[0], plans: [{ ...tree[0].plans[0], live: true, questions: 1 }, { ...tree[0].plans[1], live: true, subProjectId: 'gs' }] },
      tree[1]
    ]
    const rows = workspaceSummaries(withSub, workspaceSessionIds(withSub, sessions, worktrees), sessions, { w2: 'working' }, {
      subProjects: [{ id: 'gs', name: 'redis-sub', parentId: 'g' }, { id: 'orphan', name: 'gone', parentId: 'nowhere' }],
      git: { '/repos/gameful': { branch: 'main', dirty: 3, unpushed: 1, behind: null } }
    })
    expect(rows.map((r) => [r.id, r.parentId, r.branch, r.plans, r.questions, r.dirty, r.unpushed, r.behind])).toEqual([
      ['g', undefined, 'main', 2, 1, 3, 1, 0],
      ['gs', 'g', undefined, 1, 0, 0, 0, 0],
      ['a', undefined, undefined, 0, 0, 0, 0, 0],
      [OTHER_WORKSPACE, undefined, undefined, 0, 0, 0, 0, 0]
    ])
    // the sub-project's sessions are its plans' (w2 has no open tab, so nothing runs there)
    expect(rows[1].running).toBe(0)
  })

  it('the dot: needs you over working over idle (T11)', () => {
    const s = { waiting: false, questions: 0, working: 0, plans: 0 }
    expect(projectStatusDot(s)).toBe('idle')
    expect(projectStatusDot({ ...s, working: 2 })).toBe('working')
    expect(projectStatusDot({ ...s, plans: 1 })).toBe('working')
    expect(projectStatusDot({ ...s, working: 2, questions: 1 })).toBe('needsYou')
    expect(projectStatusDot({ ...s, plans: 1, waiting: true })).toBe('needsYou')
  })
})

// W8-C plan after plan
describe('buildWorkspaceTree: a queued plan (W8-C)', () => {
  it('says Queued after <plan>, stopped when that plan stopped, and nothing once it is planning', () => {
    const tree = (prev: Partial<Job>, queued: Partial<Job> = {}) =>
      buildWorkspaceTree(
        data({ projects: [project('p1', 'G')], jobsByProject: { p1: [job('j1', { title: 'First', ...prev }), job('j2', { pendingStart: true, after: 'j1', ...queued })] } }),
        { showArchived: true }
      )[0].plans[1].queuedAfter
    expect(tree({})).toEqual({ name: 'First', stopped: false })
    expect(tree({ archivedAt: '2026-10-02T00:00:00Z' })).toEqual({ name: 'First', stopped: true })
    expect(tree({}, { plannerSessionIds: ['pl'] })).toBeUndefined()
  })
})
