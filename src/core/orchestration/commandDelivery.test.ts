// W6-H: how a finished plan lands. `run-deliver` (pr: run-open-pr; push: deliverPush, its record, its escalation and its
// worktrees), `projects-set`, `--delivery` on jobs-create and jobs-plan, the pure helpers of delivery.ts and the
// `plan.delivered` feed line. The push itself is exec/integrateGit.push.test.ts's.
import { describe, it, expect } from 'vitest'
import { handleCommand, type OrchServerDeps } from './command'
import { emptyState, type OrchState } from './state'
import type { JobRun, Project, Task } from './types'
import { HOST_CALLER } from '../host/driver'
import { deliveryChecksOf, deliveryIssuesOf, deliveryMessage, deliveryOf, recordDelivery, setProjectDelivery } from './delivery'
import { deriveActivity, noticeOf, type ActivityEvent } from './activity'
import type { PushDelivery, PushResult } from './exec/integrateGit'

const NOW = '2026-10-18T00:00:00.000Z'
const REPO = '/repo'

const task = (over: Partial<Task> = {}): Task =>
  ({ id: 't1', runId: 'r1', title: 'Fix login', spec: 's', deps: [], status: 'completed', consecutiveFailures: 0, createdAt: NOW, updatedAt: NOW, ...over }) as Task
const project = (over: Partial<Project> = {}): Project => ({ id: 'p1', path: REPO, name: 'gameful', addedAt: NOW, ...over })

const setup = (o: { project?: Partial<Project>; tasks?: Task[]; run?: Partial<JobRun>; push?: PushResult; noPush?: boolean } = {}) => {
  const box: { state: OrchState } = {
    state: {
      ...emptyState(),
      projects: [project(o.project)],
      jobs: [{ id: 'job_1', objective: 'Fix auth', cwd: REPO, projectId: 'p1', createdAt: NOW }],
      runs: [{ id: 'r1', jobId: 'job_1', ordinal: 1, createdAt: NOW, ...o.run } as JobRun],
      tasks: o.tasks ?? [task({ validateConfigIds: ['test'] }), task({ id: 't2', validateConfigIds: ['lint', 'test'] })],
      dispatches: [{ id: 'd1', taskId: 't1', cwd: '/wt/t1', accountId: 'a' } as never, { id: 'd2', taskId: 't2', cwd: '/wt/t2', accountId: 'a' } as never]
    }
  }
  const pushes: (PushDelivery & { checks: string[] })[] = []
  const removed: string[][] = []
  const opened: string[] = []
  const deps = {
    getState: () => box.state,
    setState: async (next: OrchState) => {
      box.state = next
    },
    now: () => NOW,
    listAccounts: () => [],
    removeWorktrees: async (paths: string[]) => {
      removed.push(paths)
      return { failed: [] }
    },
    ...(o.noPush
      ? {}
      : {
          deliverPush: async (a: PushDelivery & { checks: string[] }) => {
            pushes.push(a)
            return o.push ?? { ok: true, branch: 'main', sha: 'abc1234def', merged: a.worktrees, validated: a.checks.length }
          }
        }),
    // run-open-pr's own refusal when there is no GitHub: enough to see that `pr` went there
    github: undefined
  } as unknown as OrchServerDeps
  const call = (cmd: string, args: Record<string, unknown>, sessionId = HOST_CALLER, role?: 'mcp') =>
    handleCommand(deps, { sessionId, ...(role ? { role } : {}) }, cmd, args)
  return { call, pushes, removed, opened, state: () => box.state }
}

describe('run-deliver (W6-H)', () => {
  it('is run-open-pr for a project that set nothing', async () => {
    const h = setup()
    const r = await h.call('run-deliver', { run: 'r1' })
    expect(r.status).toBe(409)
    expect(JSON.stringify(r.body)).toContain('GitHub commands are answered by the Astera Host')
    expect(h.pushes).toEqual([])
  })

  it("pushes a push project's Run with its worktrees, checks, Fixes message and branch, records it and removes the worktrees", async () => {
    const h = setup({
      project: { delivery: 'push', deliveryBranch: 'main' },
      tasks: [task({ validateConfigIds: ['test'], links: { issue: { number: 7, url: 'u', closes: true } } }), task({ id: 't2', validateConfigId: 'lint' })]
    })
    const r = await h.call('run-deliver', { run: 'r1' })
    expect(r).toEqual({ status: 200, body: { delivery: 'push', branch: 'main', sha: 'abc1234def', pushed: true, validated: 2 } })
    expect(h.pushes).toEqual([
      { cwd: REPO, branch: 'main', worktrees: ['/wt/t1', '/wt/t2'], message: 'Deliver plan: Fix auth\n\nFixes #7', checks: ['test', 'lint'] }
    ])
    expect(h.state().runs[0].delivery).toEqual({ at: NOW, branch: 'main', sha: 'abc1234def' })
    expect(h.removed).toEqual([['/wt/t1', '/wt/t2']])
    // Asked again: nothing pushed twice
    expect((await h.call('run-deliver', { run: 'r1' })).body).toMatchObject({ pushed: false, sha: 'abc1234def' })
    expect(h.pushes).toHaveLength(1)
  })

  it('records a stop, escalates it, keeps the worktrees, and tries again only with --force', async () => {
    const h = setup({ project: { delivery: 'push' }, push: { ok: false, branch: 'main', reason: 'your folder /repo is on branch dev, not main' } })
    const r = await h.call('run-deliver', { run: 'r1' })
    expect(r.status).toBe(409)
    expect(h.state().runs[0].delivery).toEqual({ at: NOW, branch: 'main', error: 'your folder /repo is on branch dev, not main' })
    const esc = h.state().messages.filter((m) => m.type === 'escalation')
    expect(esc).toHaveLength(1)
    expect(esc[0]).toMatchObject({ runId: 'r1', subject: 'Delivery stopped: your folder /repo is on branch dev, not main' })
    expect(h.removed).toEqual([])
    expect((await h.call('run-deliver', { run: 'r1' })).status).toBe(409)
    expect(h.pushes).toHaveLength(1)
    await h.call('run-deliver', { run: 'r1', force: true })
    expect(h.pushes).toHaveLength(2)
  })

  it("follows the Job's own delivery over its project's", async () => {
    const h = setup({ project: { delivery: 'push' } })
    const s = h.state()
    expect(deliveryOf(s, s.jobs[0])).toBe('push')
    expect(deliveryOf(s, { ...s.jobs[0], delivery: 'pr' })).toBe('pr')
    expect(deliveryOf({ ...s, projects: [] }, s.jobs[0])).toBe('pr')
  })

  it('refuses a push from an agent session and an MCP client, a Run still at work, and a caller with no Host push', async () => {
    const h = setup({ project: { delivery: 'push' } })
    expect((await h.call('run-deliver', { run: 'r1' }, 'coordinator-session')).status).toBe(403)
    expect((await h.call('run-deliver', { run: 'r1' }, '', 'mcp')).status).toBe(403)
    expect((await setup({ project: { delivery: 'push' }, tasks: [task({ status: 'dispatched' })] }).call('run-deliver', { run: 'r1' })).status).toBe(409)
    expect((await setup({ project: { delivery: 'push' }, noPush: true }).call('run-deliver', { run: 'r1' })).status).toBe(409)
    expect(h.pushes).toEqual([])
  })
})

describe('projects-set and --delivery (W6-H)', () => {
  it("sets a project's delivery and branch, and an empty branch drops it", async () => {
    const h = setup()
    expect((await h.call('projects-set', { id: 'p1', delivery: 'push', deliveryBranch: 'main' })).status).toBe(200)
    expect(h.state().projects[0]).toMatchObject({ delivery: 'push', deliveryBranch: 'main' })
    await h.call('projects-set', { id: 'p1', deliveryBranch: '' })
    expect(h.state().projects[0].deliveryBranch).toBeUndefined()
    expect(h.state().projects[0].delivery).toBe('push')
  })

  it('refuses a bad value, an unknown project, an agent and an MCP client', async () => {
    const h = setup()
    expect((await h.call('projects-set', { id: 'p1', delivery: 'merge' })).status).toBe(400)
    expect((await h.call('projects-set', { id: 'p1', deliveryBranch: '--force' })).status).toBe(400)
    expect((await h.call('projects-set', { id: 'nope', delivery: 'push' })).status).toBe(404)
    expect((await h.call('projects-set', { id: 'p1', delivery: 'push' }, 'worker-session')).status).toBe(403)
    expect((await h.call('projects-set', { id: 'p1', delivery: 'push' }, '', 'mcp')).status).toBe(403)
    expect(h.state().projects[0].delivery).toBeUndefined()
  })

  it('jobs-create --delivery sets the Job its own delivery, and refuses a bad value', async () => {
    const h = setup()
    const r = await h.call('jobs-create', { objective: 'Ship it', cwd: REPO, delivery: 'push' })
    expect(r.status).toBe(200)
    const id = (r.body as { id: string }).id
    expect(h.state().jobs.find((j) => j.id === id)?.delivery).toBe('push')
    expect((await h.call('jobs-create', { objective: 'x', cwd: REPO, delivery: 'yes' })).status).toBe(400)
  })

  it('jobs-plan --delivery sets it before the planner starts, and refuses a bad value', async () => {
    const h = setup()
    const s = h.state()
    const planned = { ...s, jobs: [{ ...s.jobs[0], pendingStart: true }] }
    const box = { state: planned as OrchState }
    const deps = {
      getState: () => box.state,
      setState: async (n: OrchState) => void (box.state = n),
      now: () => NOW,
      listAccounts: () => [{ id: 'acc', label: 'acc', provider: 'claude' }],
      startCoordinator: async () => ({ sessionId: 'plan-1' })
    } as unknown as OrchServerDeps
    expect((await handleCommand(deps, { sessionId: HOST_CALLER }, 'jobs-plan', { id: 'job_1', account: 'acc', delivery: 'nope' })).status).toBe(400)
    expect(box.state.jobs[0].delivery).toBeUndefined()
    expect((await handleCommand(deps, { sessionId: HOST_CALLER }, 'jobs-plan', { id: 'job_1', account: 'acc', delivery: 'push' })).status).toBe(200)
    expect(box.state.jobs[0].delivery).toBe('push')
  })
})

describe('delivery helpers (W6-H)', () => {
  it('closes the issue the Job came from and the ones made for this plan, not the ones it only refers to', () => {
    const s: OrchState = {
      ...emptyState(),
      jobs: [{ id: 'j', objective: 'o', cwd: REPO, createdAt: NOW, source: { id: 'github', itemId: '12', label: '#12' } }],
      runs: [{ id: 'r1', jobId: 'j', ordinal: 1, createdAt: NOW }],
      tasks: [
        task({ links: { issue: { number: 3, url: 'u', closes: true } } }),
        task({ id: 't2', links: { issue: { number: 9, url: 'u' } } })
      ]
    }
    expect(deliveryIssuesOf(s, s.runs[0])).toEqual([3, 12])
    expect(deliveryMessage('P', [3, 12])).toBe('Deliver plan: P\n\nFixes #3\nFixes #12')
    expect(deliveryMessage('P', [])).toBe('Deliver plan: P')
    expect(deliveryChecksOf(s, 'r1')).toEqual([])
  })

  it('setProjectDelivery keeps the branch unless told, and refuses a name with a space', () => {
    const s: OrchState = { ...emptyState(), projects: [project({ deliveryBranch: 'main' })] }
    const r = setProjectDelivery(s, 'p1', { delivery: 'push' })
    expect(r.ok && r.value).toMatchObject({ delivery: 'push', deliveryBranch: 'main' })
    expect(setProjectDelivery(s, 'p1', { branch: 'a b' }).ok).toBe(false)
  })

  it('a pushed Run is a plan.delivered line and a notice; a stopped one is not', () => {
    const s: OrchState = {
      ...emptyState(),
      jobs: [{ id: 'j', objective: 'Fix auth', cwd: REPO, createdAt: NOW }],
      runs: [{ id: 'r1', jobId: 'j', ordinal: 1, createdAt: NOW }]
    }
    const pushed = recordDelivery(s, 'r1', { at: NOW, branch: 'main', sha: 'abc1234' })
    const lines = deriveActivity(s, pushed)
    expect(lines).toEqual([expect.objectContaining({ type: 'plan.delivered', runId: 'r1', payload: expect.objectContaining({ title: 'Fix auth', branch: 'main', sha: 'abc1234' }) })])
    const notice = noticeOf({ ...lines[0], id: 'e1', sequence: 1, occurredAt: NOW } as ActivityEvent)
    expect(notice).toMatchObject({ title: 'Plan pushed to main', body: 'Fix auth' })
    expect(notice).not.toHaveProperty('alert')
    const stopped = recordDelivery(s, 'r1', { at: NOW, error: 'conflict' })
    expect(deriveActivity(s, stopped).filter((l) => l.type === 'plan.delivered')).toEqual([])
    // W6-B turns the stop's escalation message into the owner's notice and chime
    const esc = deriveActivity(s, stopped).filter((l) => l.type === 'task.escalated')
    expect(esc).toEqual([expect.objectContaining({ runId: 'r1', payload: expect.objectContaining({ title: 'Fix auth', reason: 'Delivery stopped: conflict' }) })])
    expect(noticeOf({ ...esc[0], id: 'e2', sequence: 2, occurredAt: NOW } as ActivityEvent)).toMatchObject({ alert: true })
  })
})
