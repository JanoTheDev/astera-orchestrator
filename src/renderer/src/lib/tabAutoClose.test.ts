import { describe, it, expect } from 'vitest'
import type { Dispatch, Gate, Job, JobRun, Task } from '../../../core/orchestration/types'
import { tabsToAutoClose, type TabAutoCloseInput } from './tabAutoClose'

const job = (id: string, extra: Partial<Job> = {}): Job => ({ id, ...extra }) as Job
const run = (id: string, jobId: string, extra: Partial<JobRun> = {}): JobRun => ({ id, jobId, ordinal: 1, ...extra }) as JobRun
const task = (id: string, runId: string, status: 'completed' | 'dispatched') => ({ id, runId, status, consecutiveFailures: 0 })

const base = (over: Partial<TabAutoCloseInput>): TabAutoCloseInput => ({
  sessions: [],
  jobs: [],
  runs: [],
  tasks: [],
  dispatches: [],
  openTabSessionIds: [],
  enabled: true,
  ...over
})

// One plan with a coordinator and a worker; the Task's status decides whether the plan has ended.
const plan = (taskStatus: 'completed' | 'dispatched', jobExtra: Partial<Job> = {}): TabAutoCloseInput =>
  base({
    sessions: [
      { id: 'coord', status: 'exited' },
      { id: 'w1', status: 'exited' },
      { id: 'plain', status: 'exited' },
      { id: 'live', status: 'running' }
    ],
    jobs: [job('j1', jobExtra)],
    runs: [run('r1', 'j1', { coordinatorSessionId: 'coord' })],
    tasks: [task('t1', 'r1', taskStatus), task('t2', 'r1', taskStatus)],
    dispatches: [
      { taskId: 't1', sessionId: 'w1' },
      { taskId: 't2', sessionId: 'live' }
    ],
    openTabSessionIds: ['coord', 'w1', 'plain', 'live']
  })

describe('tabsToAutoClose', () => {
  it('closes the exited tabs of a finished plan, never a running session', () => {
    expect(tabsToAutoClose(plan('completed')).sort()).toEqual(['coord', 'w1'])
  })

  it('closes the exited tabs of an archived plan even while its Tasks run', () => {
    expect(tabsToAutoClose(plan('dispatched', { archivedAt: '2026-10-01' })).sort()).toEqual(['coord', 'w1'])
  })

  it("keeps a running plan's exited worker", () => {
    expect(tabsToAutoClose(plan('dispatched'))).toEqual([])
  })

  it('keeps a plain exited session (part of no plan)', () => {
    expect(tabsToAutoClose(plan('completed'))).not.toContain('plain')
  })

  it('closes a stale replan planner while the plan still runs, keeps the one it waits on', () => {
    const input = plan('dispatched', { plannerSessionIds: ['p1', 'p2'], replanning: { sessionId: 'p2' } as Job['replanning'] })
    input.sessions = [...input.sessions, { id: 'p1', status: 'exited' }, { id: 'p2', status: 'exited' }]
    input.openTabSessionIds = ['p1', 'p2', 'w1']
    expect(tabsToAutoClose(input)).toEqual(['p1'])
  })

  it("closes the latest planner once it ended and the plan moved on; keeps it while awaiting approval", () => {
    const moved = plan('dispatched', { plannerSessionIds: ['p1'] })
    moved.sessions = [...moved.sessions, { id: 'p1', status: 'exited' }]
    moved.openTabSessionIds = ['p1']
    expect(tabsToAutoClose(moved)).toEqual(['p1'])
    const awaiting = { ...moved, jobs: [job('j1', { plannerSessionIds: ['p1'], pendingStart: true })], runs: [] }
    expect(tabsToAutoClose(awaiting)).toEqual([])
  })

  it('a tab that is not open is not closed', () => {
    expect(tabsToAutoClose({ ...plan('completed'), openTabSessionIds: ['plain'] })).toEqual([])
  })

  it('setting off: nothing closes', () => {
    expect(tabsToAutoClose({ ...plan('completed'), enabled: false })).toEqual([])
  })
})

// 2026-10-18: a running plan closes what it is done with (finishedSessions.ts sessionsDoneWith)
describe('tabsToAutoClose while the plan runs', () => {
  const NOW = '2026-10-18T00:00:00.000Z'
  const full = (id: string, status: Task['status'], deps: string[] = []): Task =>
    ({ id, runId: 'r1', title: id, spec: '', deps, status, consecutiveFailures: 0, createdAt: NOW, updatedAt: NOW }) as Task
  const dsp = (id: string, taskId: string, sessionId: string, over: Partial<Dispatch> = {}): Dispatch =>
    ({ id, taskId, sessionId, cwd: '/wt', provider: 'claude', accountId: 'a', specPath: '', startedAt: NOW, endedAt: NOW, outcome: 'succeeded', workerState: 'stopped', ...over }) as Dispatch
  const running = (over: Partial<TabAutoCloseInput> = {}): TabAutoCloseInput =>
    base({
      sessions: ['wDone', 'wFail', 'wGate', 'rev', 'coordOld', 'wLive'].map((id) => ({ id, status: id === 'wLive' ? 'running' : 'exited' })),
      jobs: [job('j1', { cwd: '/p' } as Partial<Job>)],
      runs: [run('r1', 'j1', { worktree: '/wt', coordinatorSessionId: 'coordNew', coordinatorRefreshes: [{ at: NOW, reason: 'wave 2', from: 'coordOld', to: 'coordNew' }] })],
      tasks: [full('tDone', 'completed'), full('tFail', 'failed'), full('tGate', 'completed'), full('tRev', 'reviewing'), full('tLive', 'dispatched')],
      dispatches: [
        dsp('d1', 'tDone', 'wDone'),
        dsp('d2', 'tFail', 'wFail', { outcome: 'failed' }),
        dsp('d3', 'tGate', 'wGate'),
        dsp('d4', 'tRev', 'rev', { review: true }),
        dsp('d5', 'tLive', 'wLive', { endedAt: undefined, outcome: undefined, workerState: 'ready' })
      ],
      gates: [{ id: 'g1', runId: 'r1', taskId: 'tGate', question: 'q', status: 'open', createdAt: NOW }] as Gate[],
      openTabSessionIds: ['wDone', 'wFail', 'wGate', 'rev', 'coordOld', 'wLive', 'coordNew'],
      ...over
    })

  it("closes an unmerged completed worker's tab", () => {
    const input = running({ runs: [run('r1', 'j1', { worktree: '/p-run', coordinatorSessionId: 'coordNew' })] })
    input.dispatches = input.dispatches.map((d) => (d.sessionId === 'wDone' ? ({ ...d, cwd: '/wt-own' } as Dispatch) : d))
    expect(tabsToAutoClose(input)).toContain('wDone')
  })

  it('closes ended worker tabs when the setting is left at its default (on)', () => {
    expect(tabsToAutoClose(running({ enabled: true }))).toContain('wDone')
    expect(tabsToAutoClose(running({ enabled: false }))).toEqual([])
  })

  it("closes a completed worker's, a reviewer's with its verdict, and a replaced coordinator's tab", () => {
    expect(tabsToAutoClose(running()).sort()).toEqual(['coordOld', 'rev', 'wDone'])
  })

  it("keeps a failed Task's, an open Gate's and a live session's tab", () => {
    const closed = tabsToAutoClose(running())
    for (const id of ['wFail', 'wGate', 'wLive', 'coordNew']) expect(closed).not.toContain(id)
  })

  it("closes the replan planner's tab once the replan ended", () => {
    const during = running({ jobs: [job('j1', { cwd: '/p', plannerSessionIds: ['p1'], replanning: { sessionId: 'p1' } } as Partial<Job>)] })
    during.sessions = [...during.sessions, { id: 'p1', status: 'exited' }]
    during.openTabSessionIds = ['p1']
    expect(tabsToAutoClose(during)).toEqual([])
    const ended = { ...during, jobs: [job('j1', { cwd: '/p', plannerSessionIds: ['p1'], lastReplan: { runId: 'r1', mode: 'wave', wave: 2, done: 1, at: NOW, summary: 'ok' } } as Partial<Job>)] }
    expect(tabsToAutoClose(ended)).toEqual(['p1'])
  })
})
