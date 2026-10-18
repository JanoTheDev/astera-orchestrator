import { describe, it, expect } from 'vitest'
import type { Job, JobRun } from '../../../core/orchestration/types'
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
