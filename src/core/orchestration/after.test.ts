// W8-C plan after plan: after.ts's pure rules, the `--after` flags of jobs-create and jobs-set, the refusal of
// jobs-plan while queued, the board's reason and the escalation's feed line. The loop's start is dispatchLoop.test.ts's.
import { describe, it, expect } from 'vitest'
import { afterRefusal, afterStandOf, afterStartsDue, afterSweep } from './after'
import { handleCommand, type OrchServerDeps } from './command'
import { emptyState, type OrchState } from './state'
import type { Job, JobRun, Task } from './types'
import { HOST_CALLER } from '../host/driver'
import { taskBoardsOf } from './blocked'
import { deriveActivity } from './activity'

const NOW = '2026-10-18T00:00:00.000Z'
const job = (over: Partial<Job> & { id: string }): Job => ({ objective: over.id, cwd: '/repo', createdAt: NOW, ...over })
const run = (over: Partial<JobRun> = {}): JobRun => ({ id: 'r1', jobId: 'job_a', ordinal: 1, createdAt: NOW, ...over })
const task = (over: Partial<Task> = {}): Task =>
  ({ id: 't1', runId: 'r1', title: 'T', spec: 's', deps: [], status: 'completed', consecutiveFailures: 0, createdAt: NOW, updatedAt: NOW, ...over }) as Task

const state = (o: { jobs?: Job[]; runs?: JobRun[]; tasks?: Task[] } = {}): OrchState => ({
  ...emptyState(),
  jobs: o.jobs ?? [job({ id: 'job_a', title: 'Plan A' }), job({ id: 'job_b', pendingStart: true, coordinatorAccountId: 'acc', after: 'job_a' })],
  runs: o.runs ?? [],
  tasks: o.tasks ?? []
})

describe('afterStandOf', () => {
  const stand = (r: Partial<JobRun>, t: Partial<Task> = {}, a: Partial<Job> = {}): string =>
    afterStandOf(state({ jobs: [job({ id: 'job_a', ...a })], runs: [run(r)], tasks: [task(t)] }), 'job_a')

  it('delivered: pushed, a pull request opened (not a draft), no remote (a note), or nothing to do', () => {
    expect(stand({ delivery: { at: NOW, sha: 'abc' } })).toBe('delivered')
    expect(stand({ pr: { at: NOW, url: 'u' } })).toBe('delivered')
    expect(stand({ pr: { at: NOW, note: 'no remote', branch: 'b' } })).toBe('delivered')
    expect(afterStandOf(state({ jobs: [job({ id: 'job_a', archivedAt: NOW, nothingToDo: { at: NOW, summary: 's' } })] }), 'job_a')).toBe('delivered')
  })

  it('waiting: running, completed and not delivered yet, or a draft pull request', () => {
    expect(stand({}, { status: 'ready' })).toBe('waiting')
    expect(stand({})).toBe('waiting')
    expect(stand({ pr: { at: NOW, url: 'u', draft: true } })).toBe('waiting')
    expect(afterStandOf(state({ jobs: [job({ id: 'job_a', pendingStart: true })] }), 'job_a')).toBe('waiting')
  })

  it('stopped: gave up, a delivery stopped, archived (rejected too) or gone', () => {
    expect(stand({}, { status: 'failed', consecutiveFailures: 3 })).toBe('stopped')
    expect(stand({ delivery: { at: NOW, error: 'not on main' } })).toBe('stopped')
    expect(stand({ pr: { at: NOW, error: 'no gh' } })).toBe('stopped')
    expect(stand({}, { status: 'ready' }, { archivedAt: NOW, rejected: { at: NOW } })).toBe('stopped')
    expect(afterStandOf(state(), 'job_gone')).toBe('stopped')
  })
})

describe('afterRefusal and afterSweep', () => {
  it('refuses itself, an unknown job, and a chain that comes back', () => {
    const s = state({ jobs: [job({ id: 'a', after: 'b' }), job({ id: 'b', after: 'c' }), job({ id: 'c' })] })
    expect(afterRefusal(s, 'a', 'a')?.error).toContain('itself')
    expect(afterRefusal(s, 'a', 'x')).toEqual({ error: 'unknown job: x', missing: true })
    expect(afterRefusal(s, 'c', 'a')?.error).toContain('wait on itself')
    expect(afterRefusal(s, 'c', 'b')?.error).toContain('wait on itself')
    expect(afterRefusal(s, 'a', 'c')).toBeNull()
  })

  it('marks once while the predecessor is stopped and clears the mark when it is not', () => {
    const s = state({ jobs: [job({ id: 'job_a', archivedAt: NOW }), job({ id: 'job_b', pendingStart: true, after: 'job_a' })] })
    const marked = afterSweep(s, NOW)
    expect(marked.jobs[1].afterStopNotified).toBe(NOW)
    expect(afterSweep(marked, '2026-10-19T00:00:00.000Z')).toBe(marked)
    const unarchived = { ...marked, jobs: marked.jobs.map((j) => (j.id === 'job_a' ? { ...j, archivedAt: undefined } : j)) }
    expect(afterSweep(unarchived, NOW).jobs[1].afterStopNotified).toBeUndefined()
    expect(afterStartsDue(s)).toEqual([])
  })
})

const rig = (s: OrchState) => {
  const box = { state: s }
  const started: string[] = []
  const deps = {
    getState: () => box.state,
    setState: async (next: OrchState) => {
      box.state = next
    },
    now: () => NOW,
    listAccounts: async () => [{ id: 'acc', label: 'acc', provider: 'claude' }],
    resolveProjectRoot: async (p: string) => p,
    startCoordinator: async (a: { runId: string }) => {
      started.push(a.runId)
      return { sessionId: `planner-${a.runId}` }
    }
  } as unknown as OrchServerDeps
  const call = (cmd: string, args: Record<string, unknown>, sessionId = HOST_CALLER, role?: 'mcp') =>
    handleCommand(deps, { sessionId, ...(role ? { role } : {}) }, cmd, args)
  return { call, started, state: () => box.state }
}

describe('jobs-set --after and jobs-plan (W8-C)', () => {
  it('sets, refuses a cycle (400) and an unknown job (404), and clears with none', async () => {
    const h = rig(state({ jobs: [job({ id: 'job_a', pendingStart: true, coordinatorAccountId: 'acc', after: 'job_b' }), job({ id: 'job_b', pendingStart: true, coordinatorAccountId: 'acc' })] }))
    expect((await h.call('jobs-set', { id: 'job_b', after: 'job_a' })).status).toBe(400)
    expect((await h.call('jobs-set', { id: 'job_b', after: 'job_b' })).status).toBe(400)
    expect((await h.call('jobs-set', { id: 'job_b', after: 'job_x' })).status).toBe(404)
    expect((await h.call('jobs-set', { id: 'job_a', after: 'none' })).status).toBe(200)
    expect(h.state().jobs[0].after).toBeUndefined()
    expect((await h.call('jobs-set', { id: 'job_b', after: 'job_a' })).status).toBe(200)
    expect(h.state().jobs[1].after).toBe('job_a')
  })

  it('refuses a Job that started (409), an agent session and an MCP client', async () => {
    const h = rig(state({ jobs: [job({ id: 'job_a' }), job({ id: 'job_b', coordinatorAccountId: 'acc' })] }))
    expect((await h.call('jobs-set', { id: 'job_b', after: 'job_a' })).status).toBe(409)
    expect((await h.call('jobs-set', { id: 'job_b', after: 'job_a' }, 'sess-agent')).status).toBe(403)
    expect((await h.call('jobs-set', { id: 'job_b', after: 'job_a' }, '', 'mcp')).status).toBe(403)
  })

  it('jobs-plan is refused while queued, and goes once the plan it waits on is delivered', async () => {
    const h = rig(state())
    const r = await h.call('jobs-plan', { id: 'job_b' })
    expect(r.status).toBe(409)
    expect((r.body as { error: string }).error).toBe('queued after Plan A: it starts by itself once that plan is delivered')
    expect(h.started).toEqual([])
    const h2 = rig(state({ runs: [run({ delivery: { at: NOW, sha: 'abc' } })], tasks: [task()] }))
    expect((await h2.call('jobs-plan', { id: 'job_b' })).status).toBe(200)
    expect(h2.started).toEqual(['job_b'])
  })

  it('jobs-create --after queues the new Job; an unknown one is 404', async () => {
    const h = rig(state({ jobs: [job({ id: 'job_a' })] }))
    expect((await h.call('jobs-create', { objective: 'next', cwd: '/repo', coordinatorAccount: 'acc', after: 'job_x' })).status).toBe(404)
    expect((await h.call('jobs-create', { objective: 'next', cwd: '/repo', after: 'job_a' })).status).toBe(400)
    const r = await h.call('jobs-create', { objective: 'next', cwd: '/repo', coordinatorAccount: 'acc', after: 'job_a' })
    expect(r.status).toBe(200)
    const made = h.state().jobs.find((j) => j.id === (r.body as { id: string }).id)
    expect(made).toMatchObject({ after: 'job_a', pendingStart: true })
  })
})

describe('the board and the feed (W8-C)', () => {
  it("a queued plan's Task says Queued after <plan>, and Waiting on <plan>, which stopped", () => {
    const def = task({ runId: undefined, jobId: 'job_b', status: 'pending' })
    const queued = taskBoardsOf(state({ tasks: [def] })).get('t1')?.reason
    expect(queued).toEqual({ kind: 'pending-start', after: { id: 'job_a', title: 'Plan A' } })
    const s = state({ tasks: [def] })
    const stopped = taskBoardsOf({ ...s, jobs: s.jobs.map((j) => (j.id === 'job_a' ? { ...j, archivedAt: NOW } : j)) }).get('t1')?.reason
    expect(stopped).toEqual({ kind: 'pending-start', after: { id: 'job_a', title: 'Plan A', stopped: true } })
  })

  it('the mark is one task.escalated, "Waiting on <plan>, which stopped"', () => {
    const before = state({ jobs: [job({ id: 'job_a', title: 'Plan A', archivedAt: NOW }), job({ id: 'job_b', pendingStart: true, after: 'job_a' })] })
    const after = afterSweep(before, NOW)
    const events = deriveActivity(before, after).filter((e) => e.type === 'task.escalated')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ jobId: 'job_b', payload: { reason: 'Waiting on Plan A, which stopped' } })
    expect(deriveActivity(after, afterSweep(after, NOW)).filter((e) => e.type === 'task.escalated')).toHaveLength(0)
  })
})
