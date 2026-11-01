// T10: the plan branch is pushed at the end by default (`pushCadence`), a person pushes it at once with
// `run-draft-pr --now`, and only a Task an open Task depends on is merged into the plan branch before the delivery.
import { describe, it, expect } from 'vitest'
import { handleCommand, type OrchServerDeps } from './command'
import { draftPrDue } from './draftPr'
import { deliveryWorktrees, wavesToMerge } from './integrate'
import { doneStatusOf, emptyState, type OrchState } from './state'
import type { Dispatch, Job, JobRun, Task } from './types'
import { HOST_CALLER } from '../host/driver'

const NOW = '2026-11-01T00:00:00.000Z'
const WT = '/wt/plan'
const task = (over: Partial<Task> = {}): Task =>
  ({ id: 't1', runId: 'r1', title: 'Fix login', spec: 's', deps: [], status: 'completed', consecutiveFailures: 0, createdAt: NOW, updatedAt: NOW, ...over }) as Task
const ended = (taskId: string): Dispatch => ({ id: `d_${taskId}`, taskId, cwd: `/wt/${taskId}`, accountId: 'a', startedAt: NOW, endedAt: NOW, outcome: 'succeeded' }) as Dispatch

/** A push plan with its own worktree; `pushes` collects the plan-branch pushes. */
function setup(o: { job?: Partial<Job>; tasks?: Task[]; dispatches?: Dispatch[] } = {}) {
  const box: { state: OrchState } = {
    state: {
      ...emptyState(),
      projects: [{ id: 'p1', path: '/repo', name: 'game', addedAt: NOW, delivery: 'push' }],
      jobs: [{ id: 'job_1', objective: 'Fix auth', cwd: '/repo', projectId: 'p1', createdAt: NOW, ...o.job }],
      runs: [{ id: 'r1', jobId: 'job_1', ordinal: 1, createdAt: NOW, worktree: WT } as JobRun],
      tasks: o.tasks ?? [task(), task({ id: 't2', status: 'ready' })],
      dispatches: o.dispatches ?? []
    }
  }
  const pushes: string[] = []
  const deps = {
    getState: () => box.state,
    setState: async (next: OrchState) => {
      box.state = next
    },
    now: () => NOW,
    listAccounts: () => [],
    mergeWorktrees: async (_into: string, paths: string[]) => ({ ok: true as const, merged: paths, uncommitted: 0 }),
    github: {
      run: async () => ({ ok: false, stdout: '', stderr: 'no gh here' }),
      worktreeOf: (p: string) => (p === WT ? { path: WT, repoPath: '/repo', branch: 'astera/run', baseRef: 'main' } : null),
      push: async (_wt: string, branch: string) => {
        pushes.push(branch)
        return { ok: true }
      }
    }
  } as unknown as OrchServerDeps
  const call = (cmd: string, args: Record<string, unknown>, sessionId = HOST_CALLER, role?: 'mcp') =>
    handleCommand(deps, { sessionId, ...(role ? { role } : {}) }, cmd, args)
  return { call, pushes, state: () => box.state }
}

describe('push cadence (T10)', () => {
  it('end (the default) pushes nothing while the plan runs; task pushes after each Task; a failed push is retried whatever the cadence', () => {
    const h = setup()
    const run = h.state().runs[0]
    expect(draftPrDue(h.state(), run)).toBeNull()
    expect(draftPrDue({ ...h.state(), jobs: [{ ...h.state().jobs[0], pushCadence: 'task' }] }, run)).toBe(1)
    const failed = { ...run, branchPush: { state: 'retrying' as const, attempts: 1, lastError: 'offline', tasksDone: 0 } }
    expect(draftPrDue(h.state(), failed)).toBe(0)
  })

  it('wave pushes once a wave is done while a later one remains, never for the last wave (the delivery pushes it)', () => {
    const plan = (a: Task['status'], b: Task['status'], c: Task['status']): OrchState =>
      setup({ job: { pushCadence: 'wave' }, tasks: [task({ status: a }), task({ id: 't2', status: b }), task({ id: 't3', deps: ['t1'], status: c })] }).state()
    const due = (s: OrchState): number | null => draftPrDue(s, s.runs[0])
    expect(due(plan('completed', 'ready', 'pending'))).toBeNull() // wave 1 not done
    expect(due(plan('completed', 'completed', 'pending'))).toBe(2)
    const pushed = plan('completed', 'completed', 'pending')
    pushed.runs[0] = { ...pushed.runs[0], branchPush: { state: 'delivered', attempts: 1, tasksDone: 2 } }
    expect(due(pushed)).toBeNull()
    expect(due(plan('completed', 'completed', 'completed'))).toBeNull()
  })

  it('run-draft-pr --now pushes at once whatever the cadence, and is refused for an agent session and an MCP client', async () => {
    const h = setup()
    expect((await h.call('run-draft-pr', { run: 'r1' })).status).toBe(409)
    expect(h.pushes).toEqual([])
    expect((await h.call('run-draft-pr', { run: 'r1', now: true }, 'worker-session')).status).toBe(403)
    expect((await h.call('run-draft-pr', { run: 'r1', now: true }, HOST_CALLER, 'mcp')).status).toBe(403)
    expect(h.pushes).toEqual([])
    const r = await h.call('run-draft-pr', { run: 'r1', now: true })
    expect(r.body).toMatchObject({ branch: 'astera/run', pushed: true, tasksDone: 1 })
    expect(h.pushes).toEqual(['astera/run'])
    expect(h.state().runs[0].branchPush).toMatchObject({ state: 'delivered', tasksDone: 1 })
  })

  it('jobs-set --push-cadence sets and validates the plan\'s cadence, from a person only', async () => {
    const h = setup()
    expect((await h.call('jobs-set', { id: 'job_1', pushCadence: 'wave' })).status).toBe(200)
    expect(h.state().jobs[0].pushCadence).toBe('wave')
    expect((await h.call('jobs-set', { id: 'job_1', pushCadence: 'often' })).status).toBe(400)
    expect((await h.call('jobs-set', { id: 'job_1', pushCadence: 'task' }, 'worker-session')).status).toBe(403)
    expect(h.state().jobs[0].pushCadence).toBe('wave')
  })
})

describe('only a Task an open Task depends on is merged into the plan branch (T10)', () => {
  it('one with no open dependent completes without a plan merge, and its worktree is left for the delivery', () => {
    const s = setup({ tasks: [task(), task({ id: 't2', deps: ['t1'], status: 'ready' }), task({ id: 't3' })], dispatches: [ended('t1'), ended('t3')] }).state()
    const [t1, , t3] = s.tasks
    expect(doneStatusOf(s, t1)).toBe('merging')
    expect(doneStatusOf(s, t3)).toBe('completed')
    // A completed one not merged yet: merged only while an open Task depends on it
    expect(wavesToMerge(s, () => true).map((w) => w.taskId)).toEqual(['t1'])
    expect(deliveryWorktrees(s, 'r1')).toContain('/wt/t3')
  })

  it('once its dependent is done, a completed Task is no longer merged before the delivery', () => {
    const s = setup({ tasks: [task(), task({ id: 't2', deps: ['t1'] })], dispatches: [ended('t1'), ended('t2')] }).state()
    expect(wavesToMerge(s, () => true)).toEqual([])
    expect(deliveryWorktrees(s, 'r1')).toEqual(['/wt/t1', '/wt/t2', WT]) // the plan's own folder last
  })
})
