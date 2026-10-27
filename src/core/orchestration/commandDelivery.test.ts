// W6-H: how a finished plan lands. `run-deliver` (pr: run-open-pr; push: deliverPush, its record, its escalation and its
// worktrees), `projects-set`, `--delivery` on jobs-create and jobs-plan, the pure helpers of delivery.ts and the
// `plan.delivered` feed line. The push itself is exec/integrateGit.push.test.ts's.
import { afterEach, describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pushBranch } from '../github/prCreate'
import { handleCommand, type OrchServerDeps } from './command'
import { emptyState, type OrchState } from './state'
import type { JobRun, Project, Task } from './types'
import { HOST_CALLER } from '../host/driver'
import { cleanAfterDelivery, DELIVERY_FIX_MARK, deliveryChecksOf, deliveryIssuesOf, deliveryMessage, deliveryOf, recordDelivery, setProjectDelivery } from './delivery'
import { outcomeOf } from './running'
import { deriveActivity, noticeOf, type ActivityEvent } from './activity'
import type { PushDelivery, PushResult } from './exec/integrateGit'
import type { DeliverySetup } from './deliveryChoices'
import { deliveryFallbackLine, deliveryFallbackOf, deliveryLandingOf, forgetDeliverySetups } from './delivery'

const NOW = '2026-10-18T00:00:00.000Z'
const REPO = '/repo'

const task = (over: Partial<Task> = {}): Task =>
  ({ id: 't1', runId: 'r1', title: 'Fix login', spec: 's', deps: [], status: 'completed', consecutiveFailures: 0, createdAt: NOW, updatedAt: NOW, ...over }) as Task
const project = (over: Partial<Project> = {}): Project => ({ id: 'p1', path: REPO, name: 'gameful', addedAt: NOW, ...over })

const setup = (o: { project?: Partial<Project>; tasks?: Task[]; run?: Partial<JobRun>; push?: PushResult; noPush?: boolean; cleanThrows?: boolean; mergeFails?: string; merge?: OrchServerDeps['mergeWorktrees']; folder?: DeliverySetup } = {}) => {
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
  const cleaned: string[] = []
  const deps = {
    getState: () => box.state,
    setState: async (next: OrchState) => {
      box.state = next
    },
    now: () => NOW,
    listAccounts: () => [{ id: 'a', label: 'a', provider: 'claude' }],
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
    // W9-J
    cleanWorktrees: async (runId: string) => {
      cleaned.push(runId)
      if (o.cleanThrows) throw new Error('boom')
    },
    ...(o.mergeFails ? { mergeWorktrees: async () => ({ ok: false as const, reason: o.mergeFails }) } : {}),
    ...(o.merge ? { mergeWorktrees: o.merge } : {}),
    // run-open-pr's own refusal when there is no GitHub: enough to see that `pr` went there
    github: o.folder ? { deliverySetup: async () => o.folder } : o.mergeFails ? {} : undefined
  } as unknown as OrchServerDeps
  const call = (cmd: string, args: Record<string, unknown>, sessionId = HOST_CALLER, role?: 'mcp') =>
    handleCommand(deps, { sessionId, ...(role ? { role } : {}) }, cmd, args)
  return { call, pushes, removed, opened, cleaned, state: () => box.state }
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
    expect(r).toEqual({
      status: 200,
      body: { delivery: 'push', branch: 'main', sha: 'abc1234def', pushed: true, validated: 2, deliveryState: { state: 'delivered', attempts: 1, lastAttemptAt: NOW } }
    })
    expect(h.pushes).toEqual([
      { cwd: REPO, branch: 'main', worktrees: ['/wt/t1', '/wt/t2'], message: 'Deliver plan: Fix auth\n\nFixes #7', checks: ['test', 'lint'] }
    ])
    expect(h.state().runs[0].delivery).toEqual({ at: NOW, branch: 'main', sha: 'abc1234def' })
    expect(h.removed).toEqual([['/wt/t1', '/wt/t2']])
    // Asked again: nothing pushed twice
    expect((await h.call('run-deliver', { run: 'r1' })).body).toMatchObject({ pushed: false, sha: 'abc1234def' })
    expect(h.pushes).toHaveLength(1)
  })

  it('records a stop with its retry time (T3: no escalation before the last attempt), keeps the worktrees, and tries again only with --force', async () => {
    const h = setup({ project: { delivery: 'push' }, push: { ok: false, branch: 'main', reason: 'your folder /repo is on branch dev, not main' } })
    const r = await h.call('run-deliver', { run: 'r1' })
    expect(r.status).toBe(409)
    expect(h.state().runs[0].delivery).toEqual({ at: NOW, branch: 'main', error: 'your folder /repo is on branch dev, not main' })
    expect(h.state().runs[0].deliveryState).toMatchObject({ state: 'retrying', attempts: 1, nextRetryAt: new Date(Date.parse(NOW) + 60_000).toISOString() })
    expect(h.state().messages.filter((m) => m.type === 'escalation')).toEqual([])
    expect(h.removed).toEqual([])
    expect((await h.call('run-deliver', { run: 'r1' })).status).toBe(409)
    expect(h.pushes).toHaveLength(1)
    await h.call('run-deliver', { run: 'r1', force: true })
    expect(h.pushes).toHaveLength(2)
  })

  it('a push that stopped reads failed with its reason, and a forced push that lands reads completed again', async () => {
    const h = setup({ project: { delivery: 'push' }, push: { ok: false, branch: 'main', reason: 'push refused' } })
    expect(outcomeOf(h.state(), 'r1')).toBe('completed')
    await h.call('run-deliver', { run: 'r1' })
    expect(outcomeOf(h.state(), 'r1')).toBe('failed')
    const ok = setup({ project: { delivery: 'push' }, run: { delivery: { at: NOW, error: 'push refused' } } })
    expect(outcomeOf(ok.state(), 'r1')).toBe('failed')
    expect((await ok.call('run-deliver', { run: 'r1', force: true })).status).toBe(200)
    expect(outcomeOf(ok.state(), 'r1')).toBe('completed')
  })

  it('a conflicting branch at delivery leaves the Run failed with the conflict as its reason', async () => {
    const why = 'git merge-tree says x does not merge cleanly'
    const h = setup({ run: { worktree: '/wt/run' }, mergeFails: why })
    const r = await h.call('run-deliver', { run: 'r1' })
    expect(r.status).toBe(409)
    expect(h.state().runs[0].pr).toEqual({ at: NOW, error: why })
    expect(outcomeOf(h.state(), 'r1')).toBe('failed')
    // --force asks again as a Run whose Tasks completed, not as a failed plan (no draft pull request)
    const again = await h.call('run-deliver', { run: 'r1', force: true })
    expect(again.body).toMatchObject({ error: why, deliveryState: { state: 'retrying', attempts: 1 } })
  })

  // T3: the driving loop's steps, over the real command
  it("T6: merges a merge project's Run into its branch on this computer, validated, and pushes nothing", async () => {
    const h = setup({ project: { delivery: 'merge', defaultBranch: 'main' } })
    const r = await h.call('run-deliver', { run: 'r1' })
    expect(r).toEqual({
      status: 200,
      body: { delivery: 'merge', branch: 'main', sha: 'abc1234def', pushed: false, validated: 2, deliveryState: { state: 'delivered', attempts: 1, lastAttemptAt: NOW } }
    })
    expect(h.pushes).toEqual([
      { cwd: REPO, defaultBranch: 'main', worktrees: ['/wt/t1', '/wt/t2'], message: 'Deliver plan: Fix auth', checks: ['test', 'lint'], local: true }
    ])
    expect(h.state().runs[0].delivery).toEqual({ at: NOW, branch: 'main', sha: 'abc1234def' })
    // A manual plan may be merged on this computer by its owner, and an agent may not merge one
    const m = setup({ project: { delivery: 'manual' } })
    expect((await m.call('run-deliver', { run: 'r1', as: 'merge' }, 'worker-session')).status).toBe(403)
    expect((await m.call('run-deliver', { run: 'r1', as: 'merge' })).body).toMatchObject({ delivery: 'merge', pushed: false })
    expect(m.pushes[0].local).toBe(true)
  })

  it('T6: a merge that the dirty project folder refuses is a stop with the reason', async () => {
    const reason = 'your folder /repo has 2 uncommitted change(s)'
    const h = setup({ project: { delivery: 'merge' }, push: { ok: false, reason, branch: 'main' } })
    const r = await h.call('run-deliver', { run: 'r1' })
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ error: reason, branch: 'main' })
    expect(h.removed).toEqual([])
  })

  it('T6: the plan branch of a merge plan is never pushed after a Task', async () => {
    const h = setup({ project: { delivery: 'merge' }, run: { worktree: '/wt/plan' } })
    expect(await h.call('run-draft-pr', { run: 'r1' })).toMatchObject({ status: 409, body: { error: expect.stringContaining('No plan-branch push is due') } })
    const p = setup({ project: { delivery: 'push' }, run: { worktree: '/wt/plan' } })
    expect((await p.call('run-draft-pr', { run: 'r1' })).body).not.toMatchObject({ error: expect.stringContaining('No plan-branch push is due') })
  })

  it('jobs-create --delivery merge and projects-set --delivery merge are accepted', async () => {
    const h = setup()
    expect((await h.call('projects-set', { id: 'p1', delivery: 'merge' })).status).toBe(200)
    expect(h.state().projects[0].delivery).toBe('merge')
    const r = await h.call('jobs-create', { objective: 'Ship it', cwd: REPO, delivery: 'merge' })
    expect(h.state().jobs.find((j) => j.id === (r.body as { id: string }).id)?.delivery).toBe('merge')
  })

  it('T3: the pending mark, an auto attempt only when due, and the fifth failure asks the owner exactly once', async () => {
    const h = setup({ project: { delivery: 'push' }, push: { ok: false, branch: 'main', reason: 'git fetch origin main failed: offline', code: 'fetch-failed' } })
    expect((await h.call('run-deliver', { run: 'r1', auto: true })).status).toBe(409) // nothing pending yet
    expect(h.pushes).toHaveLength(0)
    await h.call('run-deliver', { run: 'r1', pending: true })
    expect(h.state().runs[0].deliveryState).toEqual({ state: 'pending', attempts: 0 })
    const first = await h.call('run-deliver', { run: 'r1', auto: true })
    expect(first.body).toMatchObject({ code: 'fetch-failed', deliveryState: { state: 'retrying', attempts: 1 } })
    // not due again until its retry time
    expect((await h.call('run-deliver', { run: 'r1', auto: true })).status).toBe(409)
    expect(h.pushes).toHaveLength(1)
    for (let i = 2; i <= 5; i++) {
      // its retry time came
      const run = h.state().runs[0]
      h.state().runs[0] = { ...run, deliveryState: { ...run.deliveryState!, nextRetryAt: NOW } }
      await h.call('run-deliver', { run: 'r1', auto: true })
    }
    expect(h.pushes).toHaveLength(5)
    const questions = h.state().messages.filter((m) => m.type === 'escalation' && m.runId === 'r1')
    expect(questions).toHaveLength(1)
    expect(questions[0].options).toEqual(['Retry now', "I'll push it myself"])
    expect(h.state().runs[0].deliveryState).toMatchObject({ state: 'needs-owner', attempts: 5, questionId: questions[0].id })
  })

  it("T3: a push plan that ended failed is recorded failed once, with why, and never pushed", async () => {
    const h = setup({ project: { delivery: 'push' }, tasks: [task({ status: 'failed', consecutiveFailures: 3 }), task({ id: 't2' })] })
    await h.call('run-deliver', { run: 'r1', pending: true })
    const r = await h.call('run-deliver', { run: 'r1', auto: true })
    expect(r.body).toMatchObject({ code: 'not-completed', deliveryState: { state: 'failed' } })
    expect((await h.call('run-deliver', { run: 'r1', auto: true })).status).toBe(409)
    expect(h.pushes).toEqual([])
  })

  it("T3: \"I'll push it myself\" reads delivered-by-owner once git confirms the commits reached the branch", async () => {
    const h = setup({ project: { delivery: 'push' } })
    expect((await h.call('run-deliver', { run: 'r1', ownerPushed: true })).status).toBe(409) // nobody asked the owner
    const s = h.state()
    h.state().runs[0] = { ...s.runs[0], deliveryState: { state: 'needs-owner', attempts: 5, questionId: 'msg_q' } }
    const r = await h.call('run-deliver', { run: 'r1', ownerPushed: true })
    expect(r.status).toBe(200)
    expect(h.pushes[0]).toMatchObject({ ownerPushed: true, worktrees: ['/wt/t1', '/wt/t2'] })
    expect(h.state().runs[0].deliveryState).toMatchObject({ state: 'delivered-by-owner', ownerPushes: true })
    expect(h.state().runs[0].delivery).toMatchObject({ sha: 'abc1234def' })
  })

  it('T3: the loop steps are refused from an agent session', async () => {
    const h = setup({ project: { delivery: 'push' } })
    expect((await h.call('run-deliver', { run: 'r1', pending: true }, 'sess_agent', 'mcp')).status).toBe(403)
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
    expect((await h.call('projects-set', { id: 'p1', delivery: 'squash' })).status).toBe(400)
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

  it('#117: on a hands-off plan a stop is a refused decision and a plan.refused line, not an escalation', () => {
    const base = setup({ project: { delivery: 'push', handsOff: true } }).state()
    const stopped = recordDelivery(base, 'r1', { at: NOW, branch: 'main', error: 'checks failed' })
    expect(stopped.messages.filter((m) => m.type === 'escalation')).toEqual([])
    expect(stopped.jobs[0].decisions).toEqual([
      { at: NOW, kind: 'refused', question: 'Push the plan to main?', choice: 'not pushed', why: 'Delivery stopped: checks failed' }
    ])
    expect(deriveActivity(base, stopped).map((l) => l.type)).toEqual(['plan.refused'])
  })
})

describe('worktrees are cleaned once a plan is delivered (W9-J)', () => {
  it('a pushed plan asks for its Run’s ready worktrees to be removed', async () => {
    const h = setup({ project: { delivery: 'push', deliveryBranch: 'main' } })
    await h.call('run-deliver', { run: 'r1' })
    expect(h.cleaned).toEqual(['r1'])
  })
  it('a push that stopped cleans nothing', async () => {
    const h = setup({ project: { delivery: 'push' }, push: { ok: false, reason: 'checks failed' } as PushResult })
    await h.call('run-deliver', { run: 'r1' })
    expect(h.cleaned).toEqual([])
  })
  it('a pull request that could not be opened cleans nothing', async () => {
    const h = setup()
    expect((await h.call('run-deliver', { run: 'r1' })).status).toBe(409)
    expect(h.cleaned).toEqual([])
  })
  it('a clean-up that throws is logged by cleanAfterDelivery and never fails the delivery', async () => {
    const h = setup({ project: { delivery: 'push', deliveryBranch: 'main' }, cleanThrows: true })
    expect((await h.call('run-deliver', { run: 'r1' })).status).toBe(200)
  })
  it('cleanAfterDelivery without the dep (an app caller) does nothing', async () => {
    await expect(cleanAfterDelivery({}, 'r1')).resolves.toBeUndefined()
  })
})

// T3: the plan branch is pushed after each Task, over real repositories: the Task's commit is on origin's plan branch
describe('run-draft-pr pushes the plan branch after a Task (T3, real git)', () => {
  it('a Task merged into the plan branch leaves origin with that commit on the plan branch', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'plan-push-'))
    const sh = (cwd: string, ...a: string[]): string =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' }).trim()
    const origin = path.join(dir, 'origin.git')
    const repo = path.join(dir, 'repo')
    const wt = path.join(dir, 'wt-run')
    sh(dir, 'init', '--bare', '-b', 'main', origin)
    sh(dir, 'init', '-b', 'main', repo)
    writeFileSync(path.join(repo, 'a.txt'), 'a')
    sh(repo, 'add', '-A')
    sh(repo, 'commit', '-m', 'init')
    sh(repo, 'remote', 'add', 'origin', origin)
    sh(repo, 'push', '-u', 'origin', 'main')
    sh(repo, 'worktree', 'add', '-b', 'astera/run', wt)
    // the Task's work, merged into the plan branch (the Run's worktree)
    writeFileSync(path.join(wt, 'task.txt'), 'done')
    sh(wt, 'add', '-A')
    sh(wt, 'commit', '-m', 'task t1')
    const box: { state: OrchState } = {
      state: {
        ...emptyState(),
        projects: [project({ path: repo, delivery: 'push' })],
        jobs: [{ id: 'job_1', objective: 'Fix auth', cwd: repo, projectId: 'p1', createdAt: NOW }],
        runs: [{ id: 'r1', jobId: 'job_1', ordinal: 1, createdAt: NOW, worktree: wt } as JobRun],
        tasks: [task({ mergedIntoPlanAt: NOW }), task({ id: 't2', status: 'ready' })],
        dispatches: [{ id: 'd1', taskId: 't1', cwd: wt, accountId: 'a', endedAt: NOW, outcome: 'succeeded' } as never]
      }
    }
    const deps = {
      getState: () => box.state,
      setState: async (next: OrchState) => {
        box.state = next
      },
      now: () => NOW,
      listAccounts: () => [],
      github: {
        run: async () => ({ ok: false, stdout: '', stderr: 'no gh here' }),
        worktreeOf: (p: string) => (p === wt ? { path: wt, repoPath: repo, branch: 'astera/run', baseRef: 'main' } : null),
        push: (w: string, b: string) => pushBranch(w, b)
      }
    } as unknown as OrchServerDeps
    const r = await handleCommand(deps, { sessionId: HOST_CALLER }, 'run-draft-pr', { run: 'r1' })
    expect(r.body).toMatchObject({ branch: 'astera/run', pushed: true })
    expect(sh(origin, 'rev-parse', 'astera/run')).toBe(sh(wt, 'rev-parse', 'HEAD'))
    expect(sh(origin, 'rev-parse', 'main')).toBe(sh(repo, 'rev-parse', 'main')) // main is never pushed here
    expect(box.state.runs[0].branchPush).toMatchObject({ state: 'delivered', tasksDone: 1 })
  })
})

describe('a plan-branch push that keeps failing asks the owner (T4)', () => {
  const pushSetup = () => {
    const outcome: { ok: boolean } = { ok: false }
    let clock = Date.parse(NOW)
    const box: { state: OrchState } = {
      state: {
        ...emptyState(),
        projects: [project({ delivery: 'push' })],
        jobs: [{ id: 'job_1', objective: 'Fix auth', cwd: REPO, projectId: 'p1', createdAt: NOW }],
        runs: [{ id: 'r1', jobId: 'job_1', ordinal: 1, createdAt: NOW, worktree: '/wt/run' } as JobRun],
        tasks: [task(), task({ id: 't2', status: 'ready' })],
        dispatches: []
      }
    }
    const deps = {
      getState: () => box.state,
      setState: async (next: OrchState) => {
        box.state = next
      },
      now: () => new Date(clock).toISOString(),
      listAccounts: () => [],
      github: {
        run: async () => ({ ok: false, stdout: '', stderr: 'no gh here' }),
        worktreeOf: (p: string) => (p === '/wt/run' ? { path: '/wt/run', repoPath: REPO, branch: 'astera/run', baseRef: 'main' } : null),
        push: async () => (outcome.ok ? { ok: true } : { ok: false, kind: 'rejected', detail: 'remote hung up' })
      }
    } as unknown as OrchServerDeps
    const push = async (args: Record<string, unknown> = {}) => {
      clock += 61 * 60_000 // past every retry wait
      return handleCommand(deps, { sessionId: HOST_CALLER }, 'run-draft-pr', { run: 'r1', ...args })
    }
    const questions = () => box.state.messages.filter((m) => m.type === 'escalation')
    return { outcome, push, questions, state: () => box.state }
  }

  it('the fifth consecutive failure raises exactly one question with Retry now / I\'ll push it myself; a later success answers it', async () => {
    const { outcome, push, questions, state } = pushSetup()
    for (let i = 1; i <= 4; i++) expect((await push()).status).toBe(409)
    expect(questions()).toHaveLength(0)
    expect(state().runs[0].branchPush).toMatchObject({ state: 'retrying', attempts: 4 })
    await push()
    await push()
    expect(questions()).toHaveLength(1)
    expect(questions()[0]).toMatchObject({ options: ['Retry now', "I'll push it myself"], answered: false })
    expect(questions()[0].subject).toContain('Pushing the plan branch')
    expect(state().runs[0].branchPush).toMatchObject({ state: 'needs-owner', attempts: 6, questionId: questions()[0].id })
    outcome.ok = true
    expect((await push()).status).toBe(200)
    expect(questions()[0]).toMatchObject({ answered: true })
    expect(state().runs[0].branchPush).toMatchObject({ state: 'delivered', tasksDone: 1 })
    // the count starts afresh: four failures after a success ask nothing
    outcome.ok = false
    for (let i = 1; i <= 4; i++) await push({ synced: true })
    expect(questions()).toHaveLength(1)
    expect(state().runs[0].branchPush).toMatchObject({ state: 'retrying', attempts: 4 })
  })

  it('"Retry now" (--force) counts afresh; "I\'ll push it myself" stops the plan-branch pushes', async () => {
    const { push, questions, state } = pushSetup()
    for (let i = 1; i <= 5; i++) await push()
    expect(questions()).toHaveLength(1)
    await push({ force: true })
    expect(state().runs[0].branchPush).toMatchObject({ state: 'retrying', attempts: 1 })
    for (let i = 1; i <= 4; i++) await push()
    expect(questions()).toHaveLength(2)
    expect((await push({ ownerPushes: true })).status).toBe(200)
    expect(state().runs[0].branchPush).toMatchObject({ ownerPushes: true })
    expect((await push()).status).toBe(409) // never due again
    expect(state().runs[0].branchPush).toMatchObject({ ownerPushes: true, attempts: 5 })
  })
})

// ── T1: delivery state machine ──
describe('T1: a pull request merged or closed on GitHub is delivered', () => {
  const ghSetup = (state: 'MERGED' | 'CLOSED' | 'OPEN') => {
    const calls: string[][] = []
    const box: { state: OrchState } = {
      state: {
        ...emptyState(),
        projects: [project()],
        jobs: [{ id: 'job_1', objective: 'Fix auth', cwd: REPO, projectId: 'p1', createdAt: NOW }],
        runs: [
          {
            id: 'r1',
            jobId: 'job_1',
            ordinal: 1,
            createdAt: NOW,
            worktree: '/wt/run',
            pr: { at: NOW, url: 'https://github.com/o/r/pull/5', number: 5, draft: true, wavesDone: 2, error: 'gh pr ready: Pull request is in merged state' },
            deliveryState: { state: 'needs-owner', attempts: 5, lastError: 'gh pr ready failed', nextRetryAt: NOW, questionId: 'msg_q' }
          } as JobRun
        ],
        tasks: [task()],
        messages: [{ id: 'msg_q', runId: 'r1', type: 'escalation', subject: 'Delivery failed', body: '', answered: false, createdAt: NOW } as never],
        dispatches: []
      }
    }
    const deps = {
      getState: () => box.state,
      setState: async (next: OrchState) => {
        box.state = next
      },
      now: () => NOW,
      listAccounts: () => [],
      cleanWorktrees: async () => {
        throw new Error('nothing is cleaned for a PR GitHub ended')
      },
      github: {
        run: async (args: string[]) => {
          calls.push(args)
          if (args[0] === 'pr' && args[1] === 'view') return { ok: true, stdout: JSON.stringify({ state, mergedAt: null, closedAt: null }), stderr: '' }
          return { ok: false, stdout: '', stderr: `unexpected gh ${args.join(' ')}` }
        },
        worktreeOf: () => ({ path: '/wt/run', repoPath: REPO, branch: 'astera/run', baseRef: 'main' }),
        push: async () => ({ ok: false, kind: 'rejected', detail: 'must not push' })
      }
    } as unknown as OrchServerDeps
    const call = (cmd: string, args: Record<string, unknown>) => handleCommand(deps, { sessionId: HOST_CALLER }, cmd, args)
    return { call, calls, state: () => box.state }
  }

  it('a merged draft reads delivered: no push, no gh pr ready, the error and the owner question cleared, no more attempts', async () => {
    const h = ghSetup('MERGED')
    const r = await h.call('run-deliver', { run: 'r1', auto: true })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ landed: 'merged', deliveryState: { state: 'delivered', attempts: 5 } })
    expect(h.calls).toEqual([['pr', 'view', 'https://github.com/o/r/pull/5', '--json', 'state,mergedAt,closedAt']])
    const run = h.state().runs[0]
    expect(run.pr).toEqual({ at: NOW, url: 'https://github.com/o/r/pull/5', number: 5, landed: 'merged' })
    expect(outcomeOf(h.state(), 'r1')).toBe('completed')
    expect(h.state().messages[0]).toMatchObject({ answered: true, answerBody: 'merged on GitHub' })
    // the loop finds nothing due
    expect((await h.call('run-deliver', { run: 'r1', auto: true })).status).toBe(409)
    expect(h.calls).toHaveLength(1)
  })

  it('a closed draft reads delivered with the note "closed on GitHub"', async () => {
    const h = ghSetup('CLOSED')
    await h.call('run-deliver', { run: 'r1', auto: true })
    expect(h.state().runs[0].deliveryState).toMatchObject({ state: 'delivered', note: 'closed on GitHub' })
    expect(h.state().runs[0].pr).toMatchObject({ landed: 'closed' })
    expect(outcomeOf(h.state(), 'r1')).toBe('completed')
  })

  it('an open draft goes on as before (here: its push is rejected, one more failure)', async () => {
    const h = ghSetup('OPEN')
    const r = await h.call('run-deliver', { run: 'r1', auto: true })
    expect(r.status).toBe(409)
    expect(h.state().runs[0].pr).toMatchObject({ draft: true, error: expect.stringContaining('must not push') })
  })

  it('attribution-remap records a closed PR delivered instead of refusing it', async () => {
    const h = ghSetup('CLOSED')
    const r = await h.call('attribution-remap', { pr: 'https://github.com/o/r/pull/5' })
    expect(r.body).toMatchObject({ remapped: false, landed: 'closed' })
    expect(h.state().runs[0].deliveryState).toMatchObject({ state: 'delivered', note: 'closed on GitHub' })
  })
})

describe('T1: main that cannot fast-forward is retried by itself and clears once delivered', () => {
  it('records the main-diverged code, stays retryable through needs-owner, and a later push clears run.delivery.error', async () => {
    // deliverPush answers `o.push` at each call: the owner fixes their main between attempts
    const o: Parameters<typeof setup>[0] = {
      project: { delivery: 'push' },
      push: { ok: false, branch: 'main', reason: 'your main cannot fast-forward to origin/main', code: 'main-diverged' }
    }
    const h = setup(o)
    const due = (): void => {
      const run = h.state().runs[0]
      h.state().runs[0] = { ...run, deliveryState: { ...(run.deliveryState ?? { state: 'pending', attempts: 0 }), nextRetryAt: NOW } }
    }
    await h.call('run-deliver', { run: 'r1', pending: true })
    for (let i = 1; i <= 5; i++) {
      due()
      expect((await h.call('run-deliver', { run: 'r1', auto: true })).body).toMatchObject({ code: 'main-diverged' })
    }
    expect(h.state().runs[0].deliveryState).toMatchObject({ state: 'needs-owner', attempts: 5, lastCode: 'main-diverged' })
    expect(outcomeOf(h.state(), 'r1')).toBe('failed')
    // the loop's hourly look at needs-owner (deliveryDue) delivers it once main is fixed
    o.push = { ok: true, branch: 'main', sha: 'fixed123', merged: [], validated: 0 }
    due()
    expect((await h.call('run-deliver', { run: 'r1', auto: true })).status).toBe(200)
    expect(h.state().runs[0].delivery).toEqual({ at: NOW, branch: 'main', sha: 'fixed123' })
    expect(h.state().runs[0].deliveryState).toMatchObject({ state: 'delivered', attempts: 6 })
    expect(h.state().runs[0].deliveryState?.lastCode).toBeUndefined()
    expect(outcomeOf(h.state(), 'r1')).toBe('completed')
  })
})

describe('T5: a hands-free plan mends a failed delivery validation with fix Tasks', () => {
  const failed: PushResult = { ok: false, branch: 'main', reason: 'the validation failed on the merged main: npm test exited 1', code: 'validation-failed' }
  const fixTask = (n: number): Task => task({ id: `fx${n}`, parentId: 't2', spec: `${DELIVERY_FIX_MARK} (fix ${n} of 3)` })
  const questions = (h: ReturnType<typeof setup>) => h.state().messages.filter((m) => m.type === 'escalation' && m.runId === 'r1')
  const due = (h: ReturnType<typeof setup>): void => {
    const run = h.state().runs[0]
    h.state().runs[0] = { ...run, deliveryState: { ...run.deliveryState!, nextRetryAt: NOW } }
  }

  it.each([
    ['hands-off', { handsOff: true }],
    ['auto-approve', { autoApprove: true }]
  ])('a %s plan never reads needs-owner nor asks the owner while fix Tasks are left', async (_name, flags) => {
    const h = setup({ project: { delivery: 'push', ...flags }, run: { worktree: '/wt-run' }, push: failed })
    await h.call('run-deliver', { run: 'r1', pending: true })
    for (let i = 1; i <= 6; i++) {
      due(h)
      expect((await h.call('run-deliver', { run: 'r1', auto: true })).body).toMatchObject({ code: 'validation-failed', deliveryState: { state: 'retrying' } })
    }
    expect(h.state().runs[0].deliveryState).toMatchObject({ state: 'retrying', attempts: 6, lastCode: 'validation-failed' })
    expect(questions(h)).toEqual([])
  })

  it('after FAILURE_LIMIT fix Tasks the next failed validation asks the owner at once, with its reason', async () => {
    const h = setup({
      project: { delivery: 'push', handsOff: true },
      run: { worktree: '/wt-run' },
      push: failed,
      tasks: [task(), task({ id: 't2' }), fixTask(1), fixTask(2), fixTask(3)]
    })
    await h.call('run-deliver', { run: 'r1', pending: true })
    const r = await h.call('run-deliver', { run: 'r1', auto: true })
    expect(r.body).toMatchObject({ code: 'validation-failed', deliveryState: { state: 'needs-owner', attempts: 1 } })
    expect(questions(h)).toHaveLength(1)
    expect(questions(h)[0].body).toContain('npm test exited 1')
  })

  it('a fix Task that failed asks the owner with the last reason; not hands-free or an ordinary failed Task keeps not-completed', async () => {
    const failedFix = { ...fixTask(1), status: 'failed' as const, consecutiveFailures: 3 }
    const lastRun = { worktree: '/wt-run', deliveryState: { state: 'retrying' as const, attempts: 1, lastError: failed.reason, lastCode: 'validation-failed', nextRetryAt: NOW } }
    const h = setup({ project: { delivery: 'push', handsOff: true }, run: lastRun, push: failed, tasks: [task(), task({ id: 't2' }), failedFix] })
    const r = await h.call('run-deliver', { run: 'r1', auto: true })
    expect(r.body).toMatchObject({ code: 'validation-failed', deliveryState: { state: 'needs-owner' } })
    expect(questions(h)).toHaveLength(1)
    expect(questions(h)[0].body).toContain('npm test exited 1')
    for (const o of [
      { project: { delivery: 'push' as const }, tasks: [task(), task({ id: 't2' }), failedFix] },
      { project: { delivery: 'push' as const, handsOff: true }, tasks: [task(), task({ id: 't2', status: 'failed', consecutiveFailures: 3 }), failedFix] }
    ]) {
      const h2 = setup({ ...o, run: lastRun, push: failed })
      expect((await h2.call('run-deliver', { run: 'r1', auto: true })).body).toMatchObject({ code: 'not-completed' })
      expect(questions(h2)).toEqual([])
    }
  })

  it('a plan that is neither hands-off nor auto-approve keeps the backoff and asks at the fifth attempt', async () => {
    const h = setup({ project: { delivery: 'push' }, run: { worktree: '/wt-run' }, push: failed })
    await h.call('run-deliver', { run: 'r1', pending: true })
    for (let i = 1; i <= 5; i++) {
      due(h)
      await h.call('run-deliver', { run: 'r1', auto: true })
      expect(questions(h)).toHaveLength(i < 5 ? 0 : 1)
    }
    expect(h.state().runs[0].deliveryState).toMatchObject({ state: 'needs-owner', attempts: 5, lastCode: 'validation-failed' })
  })
})

describe("T1: \"It's already pushed\" from any failed delivery", () => {
  const states = [
    ['failed', { deliveryState: { state: 'failed', attempts: 0, lastError: 'x' }, delivery: { at: NOW, error: 'x' } }],
    ['retrying', { deliveryState: { state: 'retrying', attempts: 2, lastError: 'x', nextRetryAt: NOW }, delivery: { at: NOW, error: 'x' } }],
    ['needs-owner', { deliveryState: { state: 'needs-owner', attempts: 5, lastError: 'x' }, delivery: { at: NOW, error: 'x' } }],
    ['legacy delivery.error', { delivery: { at: NOW, branch: 'main', error: 'your main cannot fast-forward' } }],
    ['legacy pr.error', { pr: { at: NOW, error: 'opening the pull request failed' } }]
  ] as const

  for (const [name, run] of states)
    it(`a push plan, from ${name}: delivered-by-owner once git sees the work, and no longer failed`, async () => {
      const h = setup({ project: { delivery: 'push' }, run: run as Partial<JobRun> })
      expect(outcomeOf(h.state(), 'r1')).toBe('failed')
      const r = await h.call('run-deliver', { run: 'r1', ownerPushed: true })
      expect(r.status).toBe(200)
      expect(h.pushes[0]).toMatchObject({ ownerPushed: true })
      expect(h.state().runs[0].deliveryState).toMatchObject({ state: 'delivered-by-owner', ownerPushes: true })
      expect(h.state().runs[0].pr?.error).toBeUndefined()
      expect(outcomeOf(h.state(), 'r1')).toBe('completed')
    })

  it('a pr plan clears pr.error and reads delivered-by-owner', async () => {
    const h = setup({ run: { pr: { at: NOW, url: 'https://github.com/o/r/pull/5', draft: true, error: 'gh pr ready failed' } } })
    expect(outcomeOf(h.state(), 'r1')).toBe('failed')
    expect((await h.call('run-deliver', { run: 'r1', ownerPushed: true })).status).toBe(200)
    expect(h.state().runs[0].pr).toEqual({ at: NOW, url: 'https://github.com/o/r/pull/5', draft: true })
    expect(h.state().runs[0].deliveryState).toMatchObject({ state: 'delivered-by-owner' })
    expect(outcomeOf(h.state(), 'r1')).toBe('completed')
  })

  it('work not on origin yet waits as needs-owner, checked again by the loop', async () => {
    const h = setup({ project: { delivery: 'push' }, run: { delivery: { at: NOW, error: 'x' } }, push: { ok: false, reason: "/wt/t1's commit abc is not on main yet" } })
    const r = await h.call('run-deliver', { run: 'r1', ownerPushed: true })
    expect(r.status).toBe(409)
    expect(h.state().runs[0].deliveryState).toMatchObject({ state: 'needs-owner', ownerPushes: true, nextRetryAt: expect.any(String) })
  })

  it('is refused for a delivery nothing failed in, and from an agent session', async () => {
    expect((await setup({ project: { delivery: 'push' } }).call('run-deliver', { run: 'r1', ownerPushed: true })).status).toBe(409)
    const h = setup({ project: { delivery: 'push' }, run: { delivery: { at: NOW, error: 'x' } } })
    expect((await h.call('run-deliver', { run: 'r1', ownerPushed: true }, 'sess_agent')).status).toBe(403)
  })
})

describe('T1: run-delivery-dismiss', () => {
  it('clears a legacy failed delivery: no longer failed, never attempted again, a feed line', async () => {
    const h = setup({ project: { delivery: 'push' }, run: { delivery: { at: NOW, branch: 'main', error: 'push refused' } } })
    const before = h.state()
    expect(outcomeOf(before, 'r1')).toBe('failed')
    const r = await h.call('run-delivery-dismiss', { run: 'r1' })
    expect(r.status).toBe(200)
    expect(h.state().runs[0].delivery).toEqual({ at: NOW, branch: 'main' })
    expect(h.state().runs[0].deliveryState).toMatchObject({ state: 'dismissed' })
    expect(outcomeOf(h.state(), 'r1')).toBe('completed')
    expect(deriveActivity(before, h.state())).toEqual([expect.objectContaining({ type: 'plan.deliveryDismissed', runId: 'r1' })])
    expect((await h.call('run-deliver', { run: 'r1', auto: true })).status).toBe(409)
    expect(h.pushes).toEqual([])
  })

  it('answers the open owner question of a needs-owner delivery', async () => {
    const h = setup({ project: { delivery: 'push' }, run: { deliveryState: { state: 'needs-owner', attempts: 5, questionId: 'msg_q' }, delivery: { at: NOW, error: 'x' } } })
    h.state().messages.push({ id: 'msg_q', runId: 'r1', type: 'escalation', subject: 's', body: '', answered: false, createdAt: NOW } as never)
    expect((await h.call('run-delivery-dismiss', { run: 'r1' })).status).toBe(200)
    expect(h.state().messages[0]).toMatchObject({ answered: true, answerBody: 'dismissed' })
  })

  it('is refused from an agent session and an MCP client, for a delivery that did not fail, and without --run', async () => {
    const h = setup({ project: { delivery: 'push' }, run: { delivery: { at: NOW, error: 'x' } } })
    expect((await h.call('run-delivery-dismiss', { run: 'r1' }, 'sess_agent')).status).toBe(403)
    expect((await h.call('run-delivery-dismiss', { run: 'r1' }, '', 'mcp')).status).toBe(403)
    expect((await h.call('run-delivery-dismiss', {})).status).toBe(400)
    expect((await setup().call('run-delivery-dismiss', { run: 'r1' })).status).toBe(409)
    expect(h.state().runs[0].delivery?.error).toBe('x')
  })
})

// Manual delivery: nothing lands by itself; the owner picks the route (--as) or merges the Run's open PR (run-pr-merge)
describe('manual delivery', () => {
  it('run-deliver --as push pushes a manual plan, and --as pr goes to run-open-pr', async () => {
    const h = setup({ project: { delivery: 'manual', deliveryBranch: 'main' } })
    expect((await h.call('run-deliver', { run: 'r1', as: 'push' })).body).toMatchObject({ delivery: 'push', pushed: true })
    expect(h.pushes).toHaveLength(1)
    const g = setup({ project: { delivery: 'manual' } })
    const r = await g.call('run-deliver', { run: 'r1', as: 'pr' })
    expect(JSON.stringify(r.body)).toContain('GitHub commands are answered by the Astera Host')
    expect((await g.call('run-deliver', { run: 'r1' })).status).toBe(409) // no --as: a PR
    expect(g.pushes).toEqual([])
  })

  it('refuses --as push to an agent session and an MCP client, and a value that is neither route', async () => {
    const h = setup({ project: { delivery: 'manual' } })
    expect((await h.call('run-deliver', { run: 'r1', as: 'push' }, 'sess_agent')).status).toBe(403)
    expect((await h.call('run-deliver', { run: 'r1', as: 'push' }, '', 'mcp')).status).toBe(403)
    expect((await h.call('run-deliver', { run: 'r1', as: 'squash' })).status).toBe(400)
    expect(h.pushes).toEqual([])
  })

  it('records a finished manual plan as awaiting review, and never delivers it by itself', async () => {
    const h = setup({ project: { delivery: 'manual' } })
    expect((await h.call('run-deliver', { run: 'r1', auto: true })).status).toBe(409)
    expect((await h.call('run-deliver', { run: 'r1', awaitReview: true })).status).toBe(200)
    expect(h.state().runs[0].deliveryState).toEqual({ state: 'awaiting-review', attempts: 0 })
    expect(outcomeOf(h.state(), 'r1')).toBe('completed')
    expect((await h.call('run-deliver', { run: 'r1', awaitReview: true }, 'sess_agent')).status).toBe(403)
    expect((await setup().call('run-deliver', { run: 'r1', awaitReview: true })).status).toBe(409)
  })
})

describe('run-pr-merge', () => {
  const withGh = (stderr?: string) => {
    const ghCalls: string[][] = []
    const h = setup({ project: { delivery: 'manual' }, run: { worktree: '/wt/run', pr: { at: NOW, url: 'https://github.com/o/r/pull/9', number: 9 } } })
    const run = async (cmd: string, args: Record<string, unknown>, sessionId = HOST_CALLER, role?: 'mcp') => {
      const deps = {
        getState: () => h.state(),
        setState: async (n: OrchState) => void (h.state().runs = n.runs),
        now: () => NOW,
        listAccounts: () => [],
        github: {
          run: async (a: string[]) => {
            ghCalls.push(a)
            return stderr ? { ok: false, stdout: '', stderr } : { ok: true, stdout: '', stderr: '' }
          }
        }
      } as unknown as OrchServerDeps
      return handleCommand(deps, { sessionId, ...(role ? { role } : {}) }, cmd, args)
    }
    return { run, ghCalls, h }
  }

  it('merges the Run PR with gh and records the Run delivered and merged', async () => {
    const { run, ghCalls, h } = withGh()
    const r = await run('run-pr-merge', { run: 'r1', method: 'squash' })
    expect(r.status).toBe(200)
    expect(ghCalls).toEqual([['pr', 'merge', '9', '--squash']])
    expect(h.state().runs[0].pr?.landed).toBe('merged')
    expect(h.state().runs[0].deliveryState?.state).toBe('delivered')
    expect((await run('run-pr-merge', { run: 'r1' })).status).toBe(409) // already merged
  })

  it('records a PR the owner already merged by hand on GitHub as merged, and answers success', async () => {
    const { run, ghCalls, h } = withGh('Pull request #9 is already merged')
    const r = await run('run-pr-merge', { run: 'r1', method: 'squash' })
    expect(ghCalls).toEqual([['pr', 'merge', '9', '--squash']])
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ merged: true, alreadyMerged: true })
    expect(h.state().runs[0].pr?.landed).toBe('merged')
    expect(h.state().runs[0].deliveryState?.state).toBe('delivered')
  })

  it('refuses a PR gh reports closed (not merged) with 409 and records nothing', async () => {
    const { run, h } = withGh('Pull request #9 is closed')
    const r = await run('run-pr-merge', { run: 'r1', method: 'squash' })
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ kind: 'already-merged' })
    expect(h.state().runs[0].pr?.landed).toBeUndefined()
    expect(h.state().runs[0].deliveryState).toBeUndefined()
  })

  it('is refused to an agent session and an MCP client, and does not run gh', async () => {
    const { run, ghCalls } = withGh()
    expect((await run('run-pr-merge', { run: 'r1' }, 'sess_agent')).status).toBe(403)
    expect((await run('run-pr-merge', { run: 'r1' }, '', 'mcp')).status).toBe(403)
    expect(ghCalls).toEqual([])
  })

  it('rejects a bad method, a missing run and a Run with no PR; reports gh stopping it', async () => {
    const { run, h } = withGh()
    expect((await run('run-pr-merge', { run: 'r1', method: 'ff' })).status).toBe(400)
    expect((await run('run-pr-merge', {})).status).toBe(400)
    expect((await run('run-pr-merge', { run: 'nope' })).status).toBe(404)
    const bare = setup()
    expect((await bare.call('run-pr-merge', { run: 'r1' })).status).toBe(409)
    const blocked = withGh('Pull request #9 is not mergeable: conflicts')
    const r = await blocked.run('run-pr-merge', { run: 'r1' })
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ kind: 'not-mergeable' })
    expect(blocked.h.state().runs[0].pr?.landed).toBeUndefined()
    expect(h.state().runs[0].pr?.landed).toBeUndefined()
  })

  it('merges by the PR URL in the project root when the worktree and job cwd are gone, never with an empty cwd', async () => {
    const h = setup({ project: { delivery: 'manual' }, run: { pr: { at: NOW, url: 'https://github.com/o/r/pull/9' } } })
    h.state().jobs = h.state().jobs.map((j) => ({ ...j, cwd: undefined })) as never
    const ghCalls: { args: string[]; cwd: string }[] = []
    const deps = {
      getState: () => h.state(),
      setState: async (n: OrchState) => void (h.state().runs = n.runs),
      now: () => NOW,
      listAccounts: () => [],
      github: {
        run: async (args: string[], cwd: string) => {
          ghCalls.push({ args, cwd })
          return { ok: true, stdout: '', stderr: '' }
        }
      }
    } as unknown as OrchServerDeps
    const r = await handleCommand(deps, { sessionId: HOST_CALLER }, 'run-pr-merge', { run: 'r1', method: 'squash' })
    expect(r.status).toBe(200)
    expect(ghCalls).toEqual([{ args: ['pr', 'merge', 'https://github.com/o/r/pull/9', '--squash'], cwd: REPO }])
  })

  it('refuses to merge, and runs no gh, when no folder for the Run is left at all', async () => {
    const h = setup({ project: { delivery: 'manual' }, run: { pr: { at: NOW, url: 'https://github.com/o/r/pull/9' } } })
    h.state().jobs = h.state().jobs.map((j) => ({ ...j, cwd: undefined })) as never
    h.state().projects = []
    const ghCalls: string[][] = []
    const deps = {
      getState: () => h.state(),
      setState: async (n: OrchState) => void (h.state().runs = n.runs),
      now: () => NOW,
      listAccounts: () => [],
      github: { run: async (args: string[]) => (ghCalls.push(args), { ok: true, stdout: '', stderr: '' }) }
    } as unknown as OrchServerDeps
    expect((await handleCommand(deps, { sessionId: HOST_CALLER }, 'run-pr-merge', { run: 'r1' })).status).toBe(409)
    expect(ghCalls).toEqual([])
  })
})

describe('run-integrate-all: merge everything, the AI merge Task fixes conflicts, then deliver', () => {
  const tasks = (): Task[] => [task({ accountIds: ['a'] }), task({ id: 't2', accountIds: ['a'] })]
  const conflicting = (calls: { into: string; paths: string[] }[]): OrchServerDeps['mergeWorktrees'] => async (into, paths) => {
    calls.push({ into, paths })
    return { ok: false, reason: 'git merge-tree says b does not merge cleanly', conflict: [{ path: '/wt/t2', branch: 'b' }] }
  }

  it('merges every Task worktree into the plan worktree, then delivers as run-deliver --force does', async () => {
    const calls: { into: string; paths: string[] }[] = []
    const h = setup({
      project: { delivery: 'push' },
      tasks: tasks(),
      run: { worktree: '/wt/run' },
      merge: async (into, paths) => {
        calls.push({ into, paths })
        return { ok: true, merged: paths, uncommitted: 0 }
      }
    })
    const r = await h.call('run-integrate-all', { run: 'r1' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ state: 'delivered', pushed: true, sha: 'abc1234def' })
    expect(calls).toEqual([{ into: '/wt/run', paths: ['/wt/t1', '/wt/t2'] }])
    expect(h.pushes).toHaveLength(1)
  })

  it('a conflict starts the AI merge Task under the Run and delivers nothing yet', async () => {
    const calls: { into: string; paths: string[] }[] = []
    const h = setup({ project: { delivery: 'push' }, tasks: tasks(), run: { worktree: '/wt/run' }, merge: conflicting(calls) })
    const r = await h.call('run-integrate-all', { run: 'r1' })
    expect(r.status).toBe(200)
    const body = r.body as { state: string; taskId: string }
    expect(body.state).toBe('fixing-conflicts')
    const merge = h.state().tasks.find((x) => x.id === body.taskId)!
    expect(merge).toMatchObject({ parentId: 't2', status: 'ready', accountIds: ['a'] })
    expect(merge.spec).toContain('git merge --no-edit refs/heads/b')
    expect(merge.spec).toContain('/wt/run')
    expect(h.pushes).toEqual([])
    // Asked again while it works: the same merge Task, not a second
    expect(((await h.call('run-integrate-all', { run: 'r1' })).body as { taskId: string }).taskId).toBe(body.taskId)
    expect(h.state().tasks.filter((x) => x.parentId === 't2')).toHaveLength(1)
  })

  it('a dirty worktree goes to the AI merge Task (commit first, never discard); asked again, the same Task', async () => {
    const h = setup({
      project: { delivery: 'push' },
      tasks: tasks(),
      run: { worktree: '/wt/run' },
      merge: async () => ({ ok: true, merged: ['/wt/t1'], uncommitted: 1, dirty: ['/wt/t2'] })
    })
    const r = await h.call('run-integrate-all', { run: 'r1' })
    expect(r.status).toBe(200)
    const body = r.body as { state: string; taskId: string; reason: string }
    expect(body.state).toBe('fixing-conflicts')
    expect(body.reason).toContain('/wt/t2')
    const merge = h.state().tasks.find((x) => x.id === body.taskId)!
    expect(merge).toMatchObject({ parentId: 't2', status: 'ready' })
    expect(merge.spec).toContain('commit the uncommitted work')
    expect(merge.spec).toContain('Never discard, reset, clean or force-remove')
    expect(merge.spec).toContain('/wt/t2')
    expect(h.pushes).toEqual([])
    expect(((await h.call('run-integrate-all', { run: 'r1' })).body as { taskId: string }).taskId).toBe(body.taskId)
    expect(h.state().tasks.filter((x) => x.parentId === 't2')).toHaveLength(1)
  })

  it('is the owner\'s: refused from an agent session and an MCP client', async () => {
    const h = setup({ project: { delivery: 'push' }, run: { worktree: '/wt/run' } })
    expect((await h.call('run-integrate-all', { run: 'r1' }, 'coordinator-session')).status).toBe(403)
    expect((await h.call('run-integrate-all', { run: 'r1' }, '', 'mcp')).status).toBe(403)
    expect(h.pushes).toEqual([])
  })
})

describe('run-merge hands a conflict to the AI merge Task', () => {
  it('starts the merge Task instead of failing', async () => {
    const h = setup({
      tasks: [task({ accountIds: ['a'] })],
      merge: async () => ({ ok: false, reason: 'git merge-tree says b does not merge cleanly', conflict: [{ path: '/wt/t1', branch: 'b' }] })
    })
    const r = await h.call('run-merge', { run: 'r1' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ merged: [], state: 'fixing-conflicts' })
    const merge = h.state().tasks.find((x) => x.id === (r.body as { taskId: string }).taskId)!
    expect(merge).toMatchObject({ parentId: 't1', status: 'ready' })
  })

  it('still fails on what only a person can settle', async () => {
    const h = setup({ tasks: [task({ accountIds: ['a'] })], merge: async () => ({ ok: false, reason: 'your folder has 2 uncommitted change(s)' }) })
    const r = await h.call('run-merge', { run: 'r1' })
    expect(r.status).toBe(409)
    expect(h.state().tasks).toHaveLength(1)
  })
})

// T32: a delivery that cannot work on the folder falls back at delivery time
describe('run-deliver on a folder where the delivery cannot work (T32)', () => {
  afterEach(() => forgetDeliverySetups())
  const github: DeliverySetup = { isGitRepo: true, remoteUrl: 'https://github.com/o/r.git', ghSignedIn: true, branch: 'main' }

  it('merges locally when a plan with no delivery is on a folder with no GitHub remote', async () => {
    const h = setup({ folder: { ...github, remoteUrl: null } })
    const r = await h.call('run-deliver', { run: 'r1' })
    expect(r.body).toMatchObject({ delivery: 'merge', pushed: false })
    expect(h.pushes).toHaveLength(1)
    expect(h.pushes[0]).toMatchObject({ local: true })
    expect(deliveryFallbackLine(h.state(), h.state().jobs[0])).toBe('Merged into main on this computer: no GitHub remote')
    expect(deliveryFallbackOf(h.state(), h.state().jobs[0])).toEqual({ mode: 'merge', reason: 'notGitHub', branch: 'main' })
  })

  it('merges locally when gh is signed out', async () => {
    const h = setup({ folder: { ...github, ghSignedIn: false } })
    expect((await h.call('run-deliver', { run: 'r1' })).body).toMatchObject({ delivery: 'merge', pushed: false })
    expect(h.pushes[0]).toMatchObject({ local: true })
    expect(deliveryFallbackLine(h.state(), h.state().jobs[0])).toBe('Merged into main on this computer: gh is not signed in')
  })

  it('leaves a folder that is not a git repository for review', async () => {
    const h = setup({ folder: { isGitRepo: false, remoteUrl: null, ghSignedIn: true, branch: null } })
    const r = await h.call('run-deliver', { run: 'r1' })
    expect(r.status).toBe(409)
    expect(h.pushes).toEqual([])
    expect(deliveryLandingOf(h.state(), h.state().jobs[0])).toEqual({ mode: 'manual', reason: 'notGit' })
    expect(deliveryFallbackLine(h.state(), h.state().jobs[0])).toBe('Left for your review: not a git repository')
    expect(deliveryFallbackOf(h.state(), h.state().jobs[0])).toEqual({ mode: 'manual', reason: 'notGit' })
  })

  it('leaves an explicit push that works as it is', async () => {
    const h = setup({ project: { delivery: 'push', deliveryBranch: 'main' }, folder: github })
    const r = await h.call('run-deliver', { run: 'r1' })
    expect(r.body).toMatchObject({ delivery: 'push', pushed: true })
    expect(h.pushes[0]).not.toHaveProperty('local')
    expect(deliveryFallbackLine(h.state(), h.state().jobs[0])).toBeNull()
  })

  it('still opens the pull request on a GitHub remote with gh signed in', async () => {
    const h = setup({ folder: github })
    const r = await h.call('run-deliver', { run: 'r1' })
    expect(h.pushes).toEqual([])
    expect(JSON.stringify(r.body)).toContain('no integration branch') // run-open-pr's own answer
    expect(deliveryLandingOf(h.state(), h.state().jobs[0])).toEqual({ mode: 'pr' })
  })
})

describe("a plan's own target branch (--delivery-branch)", () => {
  /** A plan with a Run worktree on a fake GitHub whose default branch is main; `prs` collects each PR's base. */
  const prSetup = (o: { deliveryBranch?: string; tasks?: Task[] } = {}) => {
    const WT = '/wt/run'
    const box: { state: OrchState } = {
      state: {
        ...emptyState(),
        projects: [project()],
        jobs: [{ id: 'job_1', objective: 'Fix auth', cwd: REPO, projectId: 'p1', createdAt: NOW, ...(o.deliveryBranch ? { deliveryBranch: o.deliveryBranch } : {}) }],
        runs: [{ id: 'r1', jobId: 'job_1', ordinal: 1, createdAt: NOW, worktree: WT } as JobRun],
        tasks: o.tasks ?? [task()],
        dispatches: []
      }
    }
    const bases: string[] = []
    const deps = {
      getState: () => box.state,
      setState: async (next: OrchState) => {
        box.state = next
      },
      now: () => NOW,
      listAccounts: () => [],
      github: {
        run: async (args: string[]) =>
          args[0] === 'repo' && args[1] === 'view' ? { ok: true, stdout: 'main\n', stderr: '' } : { ok: false, stdout: '', stderr: 'no gh here' },
        worktreeOf: (p: string) => (p === WT ? { id: 'w1', repoPath: REPO, path: WT, name: 'run', branch: 'astera/run', baseRef: 'main', createdAt: NOW } : null),
        push: async () => ({ ok: true }),
        createPr: async (req: { base: string }) => {
          bases.push(req.base)
          return { ok: true as const, url: 'https://github.com/o/r/pull/13' }
        },
        readCommits: async () => [{ subject: 'Fix login', body: '' }],
        isClean: async () => ({ changedCount: 0 })
      }
    } as unknown as OrchServerDeps
    const call = (cmd: string, args: Record<string, unknown>) => handleCommand(deps, { sessionId: HOST_CALLER }, cmd, args)
    return { call, bases, state: () => box.state }
  }

  it('run-open-pr opens the PR against the target branch, else the default branch', async () => {
    const own = prSetup({ deliveryBranch: 'release' })
    expect((await own.call('run-open-pr', { run: 'r1' }))).toMatchObject({ status: 200 })
    expect(own.bases).toEqual(['release'])
    const none = prSetup()
    expect((await none.call('run-open-pr', { run: 'r1' })).status).toBe(200)
    expect(none.bases).toEqual(['main'])
  })

  it('run-draft-pr opens the draft against the target branch', async () => {
    const h = prSetup({ deliveryBranch: 'release', tasks: [task({ mergedIntoPlanAt: NOW }), task({ id: 't2', status: 'ready' })] })
    const r = await h.call('run-draft-pr', { run: 'r1' })
    expect(r).toMatchObject({ status: 200 })
    expect(h.bases).toEqual(['release'])
  })

  it('jobs-set --delivery-branch sets, validates and clears the plan\'s own branch', async () => {
    const h = setup({ tasks: [task({ status: 'ready' })] })
    const set = await h.call('jobs-set', { id: 'job_1', deliveryBranch: 'release/2' })
    expect(set.status).toBe(200)
    expect(h.state().jobs[0].deliveryBranch).toBe('release/2')
    expect((await h.call('jobs-set', { id: 'job_1', deliveryBranch: 'a b' })).status).toBe(400)
    expect((await h.call('jobs-set', { id: 'job_1', deliveryBranch: '-x' })).status).toBe(400)
    expect(h.state().jobs[0].deliveryBranch).toBe('release/2')
    expect((await h.call('jobs-set', { id: 'job_1', deliveryBranch: '' })).status).toBe(200)
    expect('deliveryBranch' in h.state().jobs[0]).toBe(false)
  })

  it('jobs-create --delivery-branch keeps the branch on the new plan, and refuses a bad one', async () => {
    const h = setup()
    const made = await h.call('jobs-create', { objective: 'Ship it', cwd: REPO, deliveryBranch: 'develop' })
    expect(made.status).toBe(200)
    expect(h.state().jobs.find((j) => j.objective === 'Ship it')?.deliveryBranch).toBe('develop')
    expect((await h.call('jobs-create', { objective: 'Bad', cwd: REPO, deliveryBranch: 'a b' })).status).toBe(400)
  })
})

describe('run-mark-merged', () => {
  const awaiting = { deliveryState: { state: 'awaiting-review', attempts: 0 } } as Partial<JobRun>
  const openPr = { pr: { at: NOW, url: 'https://github.com/o/r/pull/1' } } as Partial<JobRun>

  it('lands a manual plan that waits for review as merged and cleans its worktrees', async () => {
    const h = setup({ run: awaiting })
    const r = await h.call('run-mark-merged', { run: 'r1' })
    expect(r.status).toBe(200)
    expect(h.state().runs[0].pr?.landed).toBe('merged')
    expect(h.state().runs[0].deliveryState?.state).toBe('delivered')
    expect(h.cleaned).toEqual(['r1'])
  })

  it('lands a ready pull request the owner merged where GitHub could not be asked', async () => {
    const h = setup({ run: openPr })
    expect((await h.call('run-mark-merged', { run: 'r1' })).status).toBe(200)
    expect(h.state().runs[0].pr).toMatchObject({ url: 'https://github.com/o/r/pull/1', landed: 'merged' })
  })

  it('is refused from an agent session and an MCP client, and changes nothing', async () => {
    const h = setup({ run: awaiting })
    expect((await h.call('run-mark-merged', { run: 'r1' }, 'sess_agent')).status).toBe(403)
    expect((await h.call('run-mark-merged', { run: 'r1' }, '', 'mcp')).status).toBe(403)
    expect(h.state().runs[0].pr).toBeUndefined()
    expect(h.cleaned).toEqual([])
  })

  it('is refused for a Run that already landed, a plan that is not Unmerged, a draft PR, and a missing or unknown --run', async () => {
    expect((await setup({ run: { pr: { at: NOW, url: 'u', landed: 'closed' }, ...awaiting } }).call('run-mark-merged', { run: 'r1' })).status).toBe(409)
    expect((await setup().call('run-mark-merged', { run: 'r1' })).status).toBe(409)
    expect((await setup({ run: { pr: { at: NOW, url: 'u', draft: true } } }).call('run-mark-merged', { run: 'r1' })).status).toBe(409)
    expect((await setup({ run: awaiting }).call('run-mark-merged', {})).status).toBe(400)
    expect((await setup({ run: awaiting }).call('run-mark-merged', { run: 'nope' })).status).toBe(404)
  })

  it('is refused while the Run is still working', async () => {
    const h = setup({ run: awaiting, tasks: [task({ status: 'dispatched' })] })
    expect((await h.call('run-mark-merged', { run: 'r1' })).status).toBe(409)
  })
})
