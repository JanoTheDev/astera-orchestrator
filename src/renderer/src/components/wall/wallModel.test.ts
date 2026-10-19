import { describe, expect, it } from 'vitest'
import type { Attention, JobRow, JobTask, SessionInfo } from '../../../../core/types'
import type { WorkspaceProject, WorkspaceSession } from '../../state/workspaceTree'
import {
  ALL_PLANS, NO_PLAN, consolesOf, detailLineOf, detailsOf, filterConsoles, gridColumns, indexJobRows, orderWall, pillCount, planPills,
  progressSegments, stripLabel, type WallInput
} from './wallModel'

const session = (id: string, over: Partial<SessionInfo> = {}): SessionInfo => ({
  id, accountId: 'acc1', cwd: '/repo', status: 'running', title: id, ...over
})
const ws = (sessionId: string, role: WorkspaceSession['role'], label: string, plan: string, over: Partial<WorkspaceSession> = {}): WorkspaceSession => ({
  sessionId, role, label: `${plan} ${label}`, projectName: 'Repo', planName: plan, ...over
})
const task = (id: string, over: Partial<JobTask> = {}): JobTask => ({ id, title: `Task ${id}`, status: 'dispatched', openGates: 0, ...over })
const row = (id: string, tasks: JobTask[], over: Partial<JobRow> = {}): JobRow =>
  ({ id, objective: id, outcome: 'running', done: tasks.filter((t) => t.status === 'completed').length, total: tasks.length, eventCount: 0, sharesProjectFolder: false, tasks, ...over }) as unknown as JobRow

// The jobs-view fold: a Job with one Run is one row, keyed by the Job id, its Run named by foldedRunId. A Job with
// several Runs (or a schedule) is a row keyed by the Job id whose Runs are its children, each keyed by its own id.
const jobs = {
  // job_1 (one Run, run_1) — the Auth plan
  folded: row('job_1', [
    task('t1', { startedAt: '2026-10-18T10:00:00Z', affectedPaths: ['a.ts', 'b.ts'], board: { category: 'running' } }),
    task('t2', { status: 'reviewing', board: { category: 'awaiting-review' }, convergence: { reviewRound: 2, maxReviewRounds: 3 } as JobTask['convergence'] }),
    task('t4', { status: 'completed', board: { category: 'done' } }),
    task('t5', { status: 'pending', board: { category: 'queued' }, gate: { id: 'g1', question: 'Which DB?' }, openGates: 1 })
  ], { foldedRunId: 'run_1' }),
  // job_2 — planned, not started, no Run yet: keyed by its Job id alone
  planned: row('job_2', [task('t3', { board: { category: 'running' } })], { pendingStart: true, planned: true, planReady: true })
}

const tree: WorkspaceProject[] = [
  {
    id: 'p1', name: 'Repo', path: '/repo',
    plans: [
      {
        jobId: 'job_1', projectId: 'p1', name: 'Auth', archived: false, paused: false, runId: 'run_1',
        planner: [ws('pl1', 'planner', 'Planner', 'Auth')],
        coordinator: [ws('c1', 'coordinator', 'Coordinator', 'Auth')],
        workers: [
          ws('w1', 'worker', 'Worker 1', 'Auth', { taskId: 't1', taskTitle: 'Login form' }),
          ws('w2', 'worker', 'Worker 2', 'Auth', { taskId: 't2', taskTitle: 'Tokens' })
        ]
      },
      {
        jobId: 'job_2', projectId: 'p1', name: 'Board', archived: false, paused: false,
        planner: [], coordinator: [ws('c2', 'coordinator', 'Coordinator', 'Board')],
        workers: [ws('w3', 'worker', 'Worker 1', 'Board', { taskId: 't3', taskTitle: 'Scores' })]
      },
      { jobId: 'job_3', projectId: 'p1', name: 'Old', archived: true, paused: false, planner: [], coordinator: [], workers: [] }
    ]
  },
  { id: 'p2', name: 'Other', path: '/other', plans: [] }
]

const rows = indexJobRows([jobs.folded, jobs.planned])

const attention: Record<string, Attention> = { c1: 'working', w1: 'working', w2: 'idle', w3: 'waiting', c2: 'idle', s9: 'working' }

const input = (over: Partial<WallInput> = {}): WallInput => ({
  sessions: ['c1', 'pl1', 'w1', 'w2', 'c2', 'w3'].map((id) => session(id)).concat(session('s9', { title: 'my shell' }), session('e1', { status: 'exited', exitCode: 0, cwd: '/other' })),
  tree,
  data: { dispatches: [{ sessionId: 'w2', review: true } as never], worktrees: [] },
  attention,
  live: { w3: { prompt: 'permission' } },
  rows,
  ...over
})

describe('indexJobRows', () => {
  it('keys a folded Job row by its Job id and its Run id, and each nested Run by its own id', () => {
    const nested = row('job_4', [], { children: [row('run_4a', [task('x')]), row('run_4b', [task('y')])] })
    const idx = indexJobRows([jobs.folded, nested])
    expect(Object.keys(idx).sort()).toEqual(['job_1', 'job_4', 'run_1', 'run_4a', 'run_4b'])
    expect(idx.run_1).toBe(jobs.folded)
    expect(idx.job_1).toBe(jobs.folded)
    expect(idx.run_4b.tasks.map((t) => t.id)).toEqual(['y'])
    expect(idx.job_4.children).toHaveLength(2)
  })
})

describe('consolesOf', () => {
  const cs = consolesOf(input())
  const by = (id: string) => cs.find((c) => c.sessionId === id)!
  it('reads each console role from the workspace tree and its Dispatch', () => {
    expect(by('c1').role).toBe('coordinator')
    expect(by('pl1').role).toBe('planner')
    expect(by('w1').role).toBe('worker')
    expect(by('w2').role).toBe('reviewer')
    expect(by('s9').role).toBe('console')
  })
  it('drops the plan name from the label and keeps a plain console title', () => {
    expect(by('w1').label).toBe('Worker 1')
    expect(by('s9').label).toBe('my shell')
  })
  it('a permission prompt is danger, a Gate warn, an ended session finished', () => {
    expect(by('w3')).toMatchObject({ state: 'needs', needs: 'permission', tone: 'danger' })
    expect(by('e1').state).toBe('finished')
    expect(by('w1').state).toBe('working')
    expect(by('w2').state).toBe('idle')
  })
  it('places a plain console in its project by cwd', () => {
    expect(by('s9').projectId).toBe('p1')
    expect(by('e1').projectId).toBe('p2')
  })
})

describe('orderWall and filterConsoles', () => {
  const cs = consolesOf(input())
  const f = { plan: ALL_PLANS, state: 'all' as const, scope: 'project' as const, projectId: 'p1' }
  it('pins every plan coordinator first in plan order, then needs-you, working, idle', () => {
    const w = orderWall(filterConsoles(cs, f), ALL_PLANS)
    expect(w.pinned.map((c) => c.sessionId)).toEqual(['c1', 'c2'])
    expect(w.tiles.map((c) => c.sessionId)).toEqual(['w3', 'w1', 's9', 'pl1', 'w2'])
    expect(w.mainId).toBeNull()
  })
  it('one plan picked: only its consoles, its coordinator the main tile', () => {
    const w = orderWall(filterConsoles(cs, { ...f, plan: 'job_1' }), 'job_1')
    expect(w.pinned.map((c) => c.sessionId)).toEqual(['c1'])
    expect(w.mainId).toBe('c1')
    expect(w.tiles.map((c) => c.sessionId)).toEqual(['w1', 'pl1', 'w2'])
  })
  it('No plan keeps the plain consoles only', () => {
    expect(filterConsoles(cs, { ...f, plan: NO_PLAN }).map((c) => c.sessionId)).toEqual(['s9'])
  })
  it('the project scope hides another project; all projects shows it', () => {
    expect(filterConsoles(cs, f).some((c) => c.sessionId === 'e1')).toBe(false)
    expect(filterConsoles(cs, { ...f, scope: 'all' }).some((c) => c.sessionId === 'e1')).toBe(true)
  })
  it('the state filter keeps one state; finished consoles go to the Finished row', () => {
    expect(filterConsoles(cs, { ...f, state: 'needs' }).map((c) => c.sessionId)).toEqual(['w3'])
    expect(orderWall(filterConsoles(cs, { ...f, scope: 'all' }), ALL_PLANS).finished.map((c) => c.sessionId)).toEqual(['e1'])
  })
  it('the strip labels the main coordinator and a worker with its Task', () => {
    const w = orderWall(filterConsoles(cs, { ...f, plan: 'job_1' }), 'job_1')
    expect(stripLabel(w.pinned[0], w.mainId)).toBe('Coordinator (main)')
    expect(stripLabel(cs.find((c) => c.sessionId === 'w1')!, w.mainId)).toBe('Worker 1 · Login form')
  })
})

describe('gridColumns', () => {
  it('1–4 → 2, 5–9 → 3, 10+ → 4', () => {
    expect([1, 4, 5, 9, 10, 12].map(gridColumns)).toEqual([2, 2, 3, 3, 4, 4])
  })
})

describe('planPills', () => {
  const cs = consolesOf(input())
  const pills = planPills(tree, rows, cs, 'p1', 'project')
  it('lists the active plans of the project, archived ones left out', () => {
    expect(pills.map((p) => p.jobId)).toEqual(['job_1', 'job_2'])
    expect(planPills(tree, rows, cs, 'p2', 'project')).toEqual([])
    expect(planPills(tree, rows, cs, 'p2', 'all').map((p) => p.jobId)).toEqual(['job_1', 'job_2'])
  })
  it('counts progress by category and what needs the owner', () => {
    const auth = pills[0]
    expect(auth.progress.counts).toMatchObject({ done: 1, running: 1, 'awaiting-review': 1, queued: 1 })
    expect([auth.done, auth.total, auth.needs]).toEqual([1, 4, 1])
    const words = { approve: 'approve', need: (n: number) => `${n} need you` }
    expect(pillCount(auth, words)).toBe('1/4 · 1 need you')
    // A planned plan waiting for approval says so instead of a count; its waiting worker still counts as needing the owner.
    expect(pills[1].approve).toBe(true)
    expect(pills[1].needs).toBe(1)
    expect(pillCount(pills[1], words)).toBe('approve')
  })
  it('#116: no approve while the planner plans, nor for a plan that starts by itself', () => {
    const pill = (over: Partial<JobRow>) => planPills(tree, { ...rows, job_2: { ...rows.job_2, planReady: undefined, ...over } }, cs, 'p1', 'project')[1]
    expect(pill({}).approve).toBe(false)
    expect(pill({ autoApprove: true }).approve).toBe(false)
    expect(pill({ planReady: true, autoApprove: true }).approve).toBe(true)
  })
  it('the stacked bar has one segment per category present, sharing the whole', () => {
    const segs = progressSegments(pills[0].progress)
    expect(segs.map((s) => s.category)).toEqual(['done', 'running', 'awaiting-review', 'queued'])
    expect(segs.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1)
  })
})

describe('the wall reads progress from the fold rows', () => {
  // job_5: one Run (run_5), folded onto its Job row. job_6: nested, its latest Run (run_6b) is a child.
  const folded = row('job_5', [
    task('a', { status: 'completed', board: { category: 'done' } }),
    task('b', { board: { category: 'running' } })
  ], { foldedRunId: 'run_5' })
  const nested = row('job_6', [], {
    children: [
      row('run_6a', [task('c', { status: 'completed', board: { category: 'done' } })]),
      row('run_6b', [
        task('d', { board: { category: 'running' } }),
        task('e', { board: { category: 'queued' } }),
        task('f', { status: 'completed', board: { category: 'done' } })
      ])
    ]
  })
  const labTree: WorkspaceProject[] = [{
    id: 'p3', name: 'Lab', path: '/lab',
    plans: [
      {
        jobId: 'job_5', projectId: 'p3', name: 'Folded', archived: false, paused: false, runId: 'run_5',
        planner: [], coordinator: [], workers: [ws('wf', 'worker', 'Worker 1', 'Folded', { taskId: 'b', taskTitle: 'Running' })]
      },
      {
        jobId: 'job_6', projectId: 'p3', name: 'Nested', archived: false, paused: false, runId: 'run_6b',
        planner: [], coordinator: [], workers: [ws('wn', 'worker', 'Worker 1', 'Nested', { taskId: 'd', taskTitle: 'Next' })]
      }
    ]
  }]
  const labRows = indexJobRows([folded, nested])
  const labData = { sessions: [session('wf'), session('wn')], tree: labTree, data: null, attention: {}, live: {}, rows: labRows }

  it('a plan pill reports the real done and total of its folded Run and of its nested Job’s latest Run', () => {
    const pills = planPills(labTree, labRows, consolesOf(labData), 'p3', 'project')
    expect(pills.map((p) => [p.jobId, p.done, p.total])).toEqual([['job_5', 1, 2], ['job_6', 1, 3]])
  })

  it('detailsOf reports the plan’s real done and total and lists its Tasks', () => {
    const cs = consolesOf(labData)
    const d = detailsOf({
      console: cs.find((c) => c.sessionId === 'wn')!,
      consoles: cs,
      rows: labRows,
      tree: labTree,
      tasks: [],
      answeredOf: () => 0,
      escalatedOf: () => 0
    })
    expect([d.plan!.done, d.plan!.total]).toEqual([1, 3])
    expect(d.plan!.tasks.map((t) => t.id)).toEqual(['d', 'e', 'f'])
    expect(d.task).toMatchObject({ title: 'Next' })
  })
})
