import { describe, expect, it } from 'vitest'
import type { Attention, JobRow, JobTask, SessionInfo } from '../../../../core/types'
import type { WorkspaceProject, WorkspaceSession } from '../../state/workspaceTree'
import {
  ALL_PLANS, NO_PLAN, consolesOf, detailLineOf, detailsOf, filterConsoles, gridColumns, orderWall, pillCount, planPills,
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

const tree: WorkspaceProject[] = [
  {
    id: 'p1', name: 'Repo', path: '/repo',
    plans: [
      {
        jobId: 'j1', projectId: 'p1', name: 'Auth', archived: false, paused: false, runId: 'j1',
        planner: [ws('pl1', 'planner', 'Planner', 'Auth')],
        coordinator: [ws('c1', 'coordinator', 'Coordinator', 'Auth')],
        workers: [
          ws('w1', 'worker', 'Worker 1', 'Auth', { taskId: 't1', taskTitle: 'Login form' }),
          ws('w2', 'worker', 'Worker 2', 'Auth', { taskId: 't2', taskTitle: 'Tokens' })
        ]
      },
      {
        jobId: 'j2', projectId: 'p1', name: 'Board', archived: false, paused: false, runId: 'j2',
        planner: [], coordinator: [ws('c2', 'coordinator', 'Coordinator', 'Board')],
        workers: [ws('w3', 'worker', 'Worker 1', 'Board', { taskId: 't3', taskTitle: 'Scores' })]
      },
      { jobId: 'j3', projectId: 'p1', name: 'Old', archived: true, paused: false, planner: [], coordinator: [], workers: [] }
    ]
  },
  { id: 'p2', name: 'Other', path: '/other', plans: [] }
]

const rows: Record<string, JobRow> = {
  j1: row('j1', [
    task('t1', { startedAt: '2026-10-18T10:00:00Z', affectedPaths: ['a.ts', 'b.ts'], board: { category: 'running' } }),
    task('t2', { status: 'reviewing', board: { category: 'awaiting-review' }, convergence: { reviewRound: 2, maxReviewRounds: 3 } as JobTask['convergence'] }),
    task('t4', { status: 'completed', board: { category: 'done' } }),
    task('t5', { status: 'pending', board: { category: 'queued' }, gate: { id: 'g1', question: 'Which DB?' }, openGates: 1 })
  ]),
  j2: row('j2', [task('t3', { board: { category: 'running' } })], { pendingStart: true, planned: true })
}

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
    const w = orderWall(filterConsoles(cs, { ...f, plan: 'j1' }), 'j1')
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
    const w = orderWall(filterConsoles(cs, { ...f, plan: 'j1' }), 'j1')
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
    expect(pills.map((p) => p.jobId)).toEqual(['j1', 'j2'])
    expect(planPills(tree, rows, cs, 'p2', 'project')).toEqual([])
    expect(planPills(tree, rows, cs, 'p2', 'all').map((p) => p.jobId)).toEqual(['j1', 'j2'])
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
  it('the stacked bar has one segment per category present, sharing the whole', () => {
    const segs = progressSegments(pills[0].progress)
    expect(segs.map((s) => s.category)).toEqual(['done', 'running', 'awaiting-review', 'queued'])
    expect(segs.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1)
  })
})

describe('detailsOf', () => {
  const cs = consolesOf(input())
  const of = (id: string) =>
    detailsOf({
      console: cs.find((c) => c.sessionId === id)!,
      consoles: cs,
      rows,
      tree,
      tasks: [{ id: 't1', spec: '# Build the login form with validation', acceptanceCriteria: ['Form submits', 'Errors show'] }],
      answeredOf: (j) => (j === 'j1' ? 3 : 0),
      escalatedOf: (j) => (j === 'j1' ? 1 : 0)
    })
  const now = Date.parse('2026-10-18T10:05:00Z')
  const elapsed = (iso: string, n: number): string => `${Math.round((n - Date.parse(iso)) / 60000)}m`

  it('worker: its Task, brief, criteria, files, then every Task of the plan with who is on it', () => {
    const d = of('w1')
    expect(d.task).toMatchObject({ title: 'Login form', brief: 'Build the login form with validation', files: ['a.ts', 'b.ts'] })
    expect(d.task!.criteria).toEqual([{ text: 'Form submits', met: false }, { text: 'Errors show', met: false }])
    expect(d.plan!.tasks.map((t) => [t.id, t.category, t.who ?? null])).toEqual([
      ['t1', 'running', 'Worker 1'],
      ['t2', 'awaiting-review', 'Worker 2'],
      ['t4', 'done', null],
      ['t5', 'queued', null]
    ])
    expect(detailLineOf(d, now, elapsed)).toEqual({ key: 'wall.detail.worker', params: { running: '5m', files: 2 } })
  })
  it('coordinator: plan progress and its answered and escalated counts', () => {
    const d = of('c1')
    expect(d.task).toBeUndefined()
    expect([d.plan!.done, d.plan!.total, d.answered, d.escalated]).toEqual([1, 4, 3, 1])
    expect(detailLineOf(d, now, elapsed)).toEqual({ key: 'wall.detail.coordinator', params: { answered: 3, escalated: 1 } })
  })
  it('reviewer: round N of M', () => {
    const d = of('w2')
    expect(d.review).toEqual({ round: 2, max: 3 })
    expect(detailLineOf(d, now, elapsed)?.key).toBe('wall.detail.reviewer')
  })
  it('planner: the planned Tasks', () => {
    const d = of('pl1')
    expect(d.plan!.tasks).toHaveLength(4)
    expect(detailLineOf(d, now, elapsed)).toEqual({ key: 'wall.detail.planner', params: { tasks: 4 } })
  })
  it('a plain console: its folder, model and account only', () => {
    const d = of('s9')
    expect(d).toEqual({ role: 'console', cwd: '/repo', accountId: 'acc1' })
    expect(detailLineOf(d, now, elapsed)).toBeNull()
  })
})
