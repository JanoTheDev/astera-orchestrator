import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHostOrch } from './orch'
import { createJob, createTask, emptyState, startJobRun, type OrchState } from '../core/orchestration/state'
import { deliveryDue } from '../core/orchestration/delivery'
import type { DeliveryProgress } from '../core/orchestration/types'
import type { PushResult } from '../core/orchestration/exec/integrateGit'
import type { ChangedFile } from '../core/git/changedFile'

// T4: long git and gh work runs with the Host's command chain handed on (outsideChain). A delivery, a merge or a
// changed-files read that takes minutes must not hold every other command behind it.

const NOW = '2026-10-20T11:02:04.000Z'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-hostorch-slowgit-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

/** A push plan whose one Task completed in a worktree of its own, with the Run's git range recorded. */
const seed = async (delivery?: DeliveryProgress): Promise<{ runId: string; taskId: string }> => {
  const job = createJob(emptyState(), { objective: 'o', cwd: 'D:/p', concurrency: 10 }, NOW)
  if (!job.ok) throw new Error(job.error)
  const run = startJobRun(job.state, job.value.id, NOW)
  if (!run.ok) throw new Error(run.error)
  const task = createTask(run.state, { runId: run.value.id, title: 't', spec: 's', deps: [] }, NOW)
  if (!task.ok) throw new Error(task.error)
  const s: OrchState = {
    ...task.state,
    jobs: task.state.jobs.map((j) => ({ ...j, delivery: 'push' as const })),
    runs: task.state.runs.map((r) => ({ ...r, git: { base: 'b0', head: 'h0' }, ...(delivery ? { deliveryState: delivery } : {}) })),
    tasks: task.state.tasks.map((t) => ({ ...t, status: 'completed' as const })),
    dispatches: [
      { id: 'dsp1', taskId: task.value.id, sessionId: 'ses1', accountId: 'acc1', cwd: 'D:/wt/t', startedAt: NOW, endedAt: NOW, outcome: 'succeeded' } as never
    ]
  }
  await fs.writeFile(path.join(dir, 'orchestration.json'), JSON.stringify(s, null, 2), 'utf8')
  return { runId: run.value.id, taskId: task.value.id }
}

/** A slow effect held until `release`: `entered` resolves once a command is inside it. */
const gate = <T>(answer: T) => {
  let release = (): void => {}
  let enter = (): void => {}
  const entered = new Promise<void>((r) => (enter = r))
  const open = new Promise<void>((r) => (release = r))
  let calls = 0
  const effect = async (): Promise<T> => {
    calls++
    enter()
    // The 10 s a real one can take, unless the test lets it go first
    await Promise.race([open, new Promise((r) => setTimeout(r, 10_000))])
    return answer
  }
  return { effect, entered, release: () => release(), calls: () => calls }
}

const orchOver = (over: Partial<Parameters<typeof createHostOrch>[0]> = {}): ReturnType<typeof createHostOrch> =>
  createHostOrch({
    profileDir: dir,
    version: '9.9.9',
    now: () => NOW,
    hostStartedAt: () => '2026-10-20T10:00:00.000Z',
    runningSessions: () => 0,
    aliveSessionIds: () => new Set<string>(),
    act: async () => ({}),
    hasApp: () => true,
    onState: () => {},
    log: () => {},
    sessions: { listSessions: async () => [], readSession: async () => ({ cols: 80, rows: 24, screen: [], scrollback: [] }), sendSession: async () => {}, readChat: async () => [], sendChat: async () => {}, serial: (_id, run) => run() },
    ...over
  })

type Orch = ReturnType<typeof createHostOrch>
const call = (orch: Orch, cmd: string, args: Record<string, unknown>) => orch.call({ cmd, args, sessionId: '' })

/** Milliseconds `cmd` took to answer, or Infinity past `ms`. */
const answersWithin = async (orch: Orch, cmd: string, args: Record<string, unknown>, ms = 500): Promise<number> => {
  const t0 = Date.now()
  const r = await Promise.race([call(orch, cmd, args), new Promise<null>((res) => setTimeout(() => res(null), ms))])
  return r === null ? Infinity : Date.now() - t0
}

const othersAnswerMeanwhile = async (orch: Orch, taskId: string, runId: string): Promise<void> => {
  expect(await answersWithin(orch, 'task-update', { id: taskId, title: 'renamed meanwhile' })).toBeLessThan(500)
  expect(await answersWithin(orch, 'tasks-list', { run: runId })).toBeLessThan(500)
}

const PUSHED: PushResult = { ok: true, branch: 'main', sha: 'abc1234def', merged: [], validated: 0 }

describe('slow git and gh work leaves the command chain (T4)', () => {
  it('answers task-update and tasks-list while run-deliver pushes, then answers with the delivery', async () => {
    const { runId, taskId } = await seed()
    const push = gate(PUSHED)
    const orch = orchOver({ deliverPush: push.effect })
    const delivering = call(orch, 'run-deliver', { run: runId })
    try {
      await push.entered
      await othersAnswerMeanwhile(orch, taskId, runId)
      // A commit made meanwhile (one a completed Task takes)
      expect((await call(orch, 'task-update', { id: taskId, mergedIntoPlan: true })).status).toBe(200)
    } finally {
      push.release()
    }
    const r = await delivering
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ delivery: 'push', sha: 'abc1234def', deliveryState: { state: 'delivered' } })
    // ...is kept: the delivery's own record is built on the state as it is after the push, not as it was read before
    expect(orch.state().tasks.find((t) => t.id === taskId)?.mergedIntoPlanAt).toBe(NOW)
    expect(orch.state().runs.find((x) => x.id === runId)?.delivery).toMatchObject({ sha: 'abc1234def' })
  })

  it('answers a second run-deliver of the same Run 409 while the first runs, and pushes once', async () => {
    const { runId } = await seed()
    const push = gate(PUSHED)
    const orch = orchOver({ deliverPush: push.effect })
    const first = call(orch, 'run-deliver', { run: runId })
    try {
      await push.entered
      const second = await call(orch, 'run-deliver', { run: runId, force: true })
      expect(second.status).toBe(409)
      expect(second.body).toMatchObject({ code: 'running' })
      expect(orch.state().runs.find((x) => x.id === runId)?.deliveryState?.state).toBe('delivering')
    } finally {
      push.release()
    }
    expect((await first).status).toBe(200)
    expect(push.calls()).toBe(1)
    // Once it ended the Run takes the next one again
    expect((await call(orch, 'run-deliver', { run: runId })).body).toMatchObject({ pushed: false, sha: 'abc1234def' })
  })

  it('answers task-update and tasks-list while run-merge merges', async () => {
    const { runId, taskId } = await seed()
    const merge = gate({ ok: true, merged: ['D:/wt/t'], uncommitted: 0 })
    const orch = orchOver({ act: async (name) => (name === 'mergeWorktrees' ? merge.effect() : {}) })
    const merging = call(orch, 'run-merge', { run: runId })
    try {
      await merge.entered
      await othersAnswerMeanwhile(orch, taskId, runId)
    } finally {
      merge.release()
    }
    const r = await merging
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ merged: ['D:/wt/t'] })
  })

  it('answers task-update and tasks-list while runs-changed-files reads git', async () => {
    const { runId, taskId } = await seed()
    const files: ChangedFile[] = [{ id: 'f1', path: 'a.ts', status: 'modified' }]
    const read = gate(files)
    const orch = orchOver({ changes: { read: () => read.effect(), diff: async () => null } })
    const reading = call(orch, 'runs-changed-files', { id: runId })
    try {
      await read.entered
      await othersAnswerMeanwhile(orch, taskId, runId)
    } finally {
      read.release()
    }
    const r = await reading
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ git: { files: [{ path: 'a.ts' }] } })
  })

  it('clears a delivering mark a Host restart left on load, so the delivery is due again', async () => {
    const { runId } = await seed({ state: 'delivering', attempts: 2, lastAttemptAt: NOW })
    const orch = orchOver()
    await orch.ready()
    const p = orch.state().runs.find((x) => x.id === runId)?.deliveryState
    expect(p).toMatchObject({ state: 'pending', attempts: 2 })
    expect(deliveryDue(p, Date.parse(NOW))).toBe(true)
  })
})
