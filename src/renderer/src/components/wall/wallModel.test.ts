import { describe, expect, it } from 'vitest'
import type { Attention, JobRow, JobTask, SessionInfo } from '../../../../core/types'
import type { WorkspaceProject, WorkspaceSession } from '../../state/workspaceTree'
import { ALL_PLANS, agentPanes, consoleDescription, consoleHeaderOf, consoleTitle, consolesOf, indexJobRows, plansOf, type WallConsole, type WallInput } from './wallModel'

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
    expect(by('s9').projectName).toBe('Repo')
    expect(by('e1').projectName).toBe('Other')
  })
  it('carries the effort, the Dispatch start and the last sign of life', () => {
    const at = Date.UTC(2026, 9, 24, 10, 0, 0)
    const timed = consolesOf(input({
      sessions: [session('w1', { effort: 'high', lastAction: { tool: 'Edit', at: at + 5_000 } }), session('w2'), session('s9')],
      data: {
        dispatches: [
          { sessionId: 'w1', startedAt: '2026-10-24T09:00:00Z' } as never,
          { sessionId: 'w1', startedAt: '2026-10-24T09:30:00Z' } as never,
          { sessionId: 'w2', startedAt: '2026-10-24T08:00:00Z', endedAt: '2026-10-24T08:40:00Z' } as never
        ],
        worktrees: []
      },
      live: { w1: { lastAction: { tool: 'Read', at: at + 9_000 } } }
    }))
    const of = (id: string) => timed.find((c) => c.sessionId === id)!
    expect(of('w1')).toMatchObject({ effort: 'high', startedAt: Date.parse('2026-10-24T09:30:00Z'), lastActiveAt: at + 9_000 })
    expect(of('w2')).toMatchObject({ startedAt: Date.parse('2026-10-24T08:00:00Z'), lastActiveAt: Date.parse('2026-10-24T08:40:00Z') })
    expect(of('w2').effort).toBeUndefined()
    expect(of('s9').startedAt).toBeUndefined()
    expect(of('s9').lastActiveAt).toBeUndefined()
  })
  it('a plain console with no Dispatch takes its session start', () => {
    const plain = consolesOf(input({
      sessions: [session('s9', { startedAt: Date.UTC(2026, 9, 24, 10, 0, 0) })],
      data: { dispatches: [], worktrees: [] }
    }))
    expect(plain[0].startedAt).toBe(Date.UTC(2026, 9, 24, 10, 0, 0))
  })
})

describe('the Agents view rows', () => {
  const mk = (sessionId: string, over: Partial<WallConsole> = {}): WallConsole => ({
    sessionId, label: sessionId, role: 'console', state: 'idle', projectId: 'p1', planOrder: Number.MAX_SAFE_INTEGER, cwd: '/repo', chat: false, ...over
  })
  const worker = mk('w1', { role: 'worker', label: 'Worker 2', taskTitle: 'Fix login', planName: 'Auth', jobId: 'job_1', planOrder: 0, state: 'working' })
  const plain = mk('x1', { label: 'Shell', cwd: '/repo/sub' })

  it('groups consoles into the four panes, plan consoles before plain ones, coordinator first', () => {
    const coord = mk('c1', { role: 'coordinator', label: 'Coordinator', planName: 'Auth', jobId: 'job_1', planOrder: 0, state: 'working' })
    const done = mk('d1', { state: 'finished' })
    const ask = mk('a1', { state: 'needs', needs: 'question' })
    const panes = agentPanes([plain, worker, done, ask, coord])
    expect(panes.working.map((c) => c.sessionId)).toEqual(['c1', 'w1'])
    expect(panes.idle.map((c) => c.sessionId)).toEqual(['x1'])
    expect(panes.needs.map((c) => c.sessionId)).toEqual(['a1'])
    expect(panes.finished.map((c) => c.sessionId)).toEqual(['d1'])
  })

  it('titles a console by its Task, else its name; describes it as project › plan', () => {
    expect(consoleTitle(worker)).toBe('Fix login')
    expect(consoleTitle(plain)).toBe('Shell')
    expect(consoleDescription({ ...worker, projectName: 'Repo' })).toBe('Repo › Auth')
    expect(consoleDescription(worker)).toBe('Auth')
    expect(consoleDescription({ ...plain, projectName: 'Repo' })).toBe('Repo')
    expect(consoleDescription(plain)).toBe('')
  })

  it('lists the plans of the consoles once, in plan order', () => {
    const b = mk('w2', { planName: 'Billing', jobId: 'job_2', planOrder: 1 })
    expect(plansOf([b, worker, plain, { ...worker, sessionId: 'w3' }])).toEqual([{ jobId: 'job_1', name: 'Auth' }, { jobId: 'job_2', name: 'Billing' }])
  })

  it('the header of a planned console names its plan and Task; an unplanned one only its folder and account', () => {
    expect(consoleHeaderOf(worker, 'Work')).toEqual({ plan: { jobId: 'job_1', name: 'Auth' }, task: 'Fix login', account: 'Work' })
    expect(consoleHeaderOf(plain, 'Work')).toEqual({ cwd: '/repo/sub', account: 'Work' })
    expect(consoleHeaderOf(plain)).toEqual({ cwd: '/repo/sub' })
  })
})
