import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHostOrch } from './orch'
import { createJob, createTask, emptyState, openDispatch, startJobRun, type OrchState } from '../core/orchestration/state'

// 2026-11-03: a `send worker_done` held the Host's command chain for 67 s while its limit probe read files on a
// memory-starved machine, and a `jobs-create` for 24.8 s while the project root was resolved (every account's
// transcript folders, and git); every other command queued behind them, and the app and MCP timed out. Those reads now
// run with the chain handed on (outsideChain), and the command's commit is built on the state read after them, so a
// commit another command lands meanwhile is kept (the Gameful lost dispatches the chain exists for).

const NOW = '2026-11-03T07:07:45.000Z'

let dir: string
const made: Array<{ flush(): Promise<void> }> = []
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-hostorch-slowreads-'))
})
afterEach(async () => {
  await Promise.all(made.splice(0).map((o) => o.flush().catch(() => {})))
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

/** A slow read held until `release`: `entered` resolves once a command is inside it. */
const gate = <T>(answer: T) => {
  let release = (): void => {}
  let enter = (): void => {}
  const entered = new Promise<void>((r) => (enter = r))
  const open = new Promise<void>((r) => (release = r))
  let calls = 0
  const effect = async (): Promise<T> => {
    calls++
    enter()
    await Promise.race([open, new Promise((r) => setTimeout(r, 10_000))])
    return answer
  }
  return { effect, entered, release: () => release(), calls: () => calls }
}

/** One plan, one Run, two Tasks; the first has an open Dispatch (`dsp`) its worker reports on. */
const seed = async (): Promise<{ runId: string; working: string; other: string; dsp: string }> => {
  const job = createJob(emptyState(), { objective: 'o', cwd: 'D:/p', concurrency: 4 }, NOW)
  if (!job.ok) throw new Error(job.error)
  const run = startJobRun(job.state, job.value.id, NOW)
  if (!run.ok) throw new Error(run.error)
  const a = createTask(run.state, { runId: run.value.id, title: 'working', spec: 's', deps: [] }, NOW)
  if (!a.ok) throw new Error(a.error)
  const b = createTask(a.state, { runId: run.value.id, title: 'other', spec: 's', deps: [] }, NOW)
  if (!b.ok) throw new Error(b.error)
  const d = openDispatch(b.state, { taskId: a.value.id, provider: 'claude', accountId: 'acc1', sessionId: 'ses1', cwd: 'D:/wt/a', specPath: '' }, NOW)
  if (!d.ok) throw new Error(d.error)
  const s: OrchState = d.state
  await fs.writeFile(path.join(dir, 'orchestration.json'), JSON.stringify(s), 'utf8')
  return { runId: run.value.id, working: a.value.id, other: b.value.id, dsp: d.value.id }
}

const stub = async () => ({}) as never

const orchOver = (over: Partial<Parameters<typeof createHostOrch>[0]> = {}, probeLimit: () => Promise<number | null> = async () => null) => {
  const o = createHostOrch({
    profileDir: dir,
    version: '9.9.9',
    now: () => NOW,
    hostStartedAt: () => '2026-11-03T07:00:00.000Z',
    // The reporting worker's session is alive, so loading does not close its Dispatch as lost
    aliveSessionIds: () => new Set<string>(['ses1']),
    runningSessions: () => 1,
    act: async () => ({}),
    hasApp: () => false,
    onState: () => {},
    log: () => {},
    local: {
      startWorker: stub,
      startCoordinator: stub,
      releaseWorker: stub,
      readWorker: stub,
      probeLimit,
      readReviewFile: async () => null,
      makeRunWorktree: stub,
      mergeWorktrees: stub,
      removeWorktrees: stub,
      owns: () => true
    } as never,
    sessions: {
      listSessions: async () => [],
      readSession: async () => ({ cols: 80, rows: 24, screen: [], scrollback: [] }),
      sendSession: async () => {},
      readChat: async () => [],
      sendChat: async () => {},
      serial: (_id, run) => run()
    },
    ...over
  })
  made.push(o)
  return o
}

type Orch = ReturnType<typeof createHostOrch>
const call = (orch: Orch, cmd: string, args: Record<string, unknown>) => orch.call({ cmd, args, sessionId: '' })

/** Milliseconds `cmd` took to answer, or Infinity past `ms`. */
const answersWithin = async (orch: Orch, cmd: string, args: Record<string, unknown>, ms = 500): Promise<number> => {
  const t0 = Date.now()
  const r = await Promise.race([call(orch, cmd, args), new Promise<null>((res) => setTimeout(() => res(null), ms))])
  return r === null ? Infinity : Date.now() - t0
}

describe("a report's and a new plan's slow reads leave the command chain", () => {
  it("answers task-update while a failed worker_done's limit probe reads, and keeps that commit", async () => {
    const { working, other, dsp } = await seed()
    const probe = gate<number | null>(null)
    const orch = orchOver({}, probe.effect)
    await orch.ready()
    const reporting = call(orch, 'send', { type: 'worker_done', taskId: working, dispatchId: dsp, outcome: 'failed', subject: 'tests fail', body: 'b' })
    try {
      await probe.entered
      // A write that would have queued behind the report for as long as the probe took
      expect(await answersWithin(orch, 'task-update', { id: other, title: 'renamed meanwhile' })).toBeLessThan(500)
    } finally {
      probe.release()
    }
    const r = await reporting
    expect(r.status).toBe(200)
    expect(probe.calls()).toBe(1)
    const st = orch.state()
    // The report's own commit landed...
    expect(st.dispatches.find((d) => d.id === dsp)).toMatchObject({ outcome: 'failed' })
    expect(st.messages.some((m) => m.type === 'worker_done' && m.dispatchId === dsp)).toBe(true)
    // ...on the state as it was after the probe: the commit made meanwhile is kept
    expect(st.tasks.find((t) => t.id === other)?.title).toBe('renamed meanwhile')
  })

  it('keeps the chain for a succeeded worker_done, which reads nothing slow', async () => {
    const { working, dsp } = await seed()
    let probed = 0
    const orch = orchOver({}, async () => (probed++, null))
    await orch.ready()
    const r = await call(orch, 'send', { type: 'worker_done', taskId: working, dispatchId: dsp, outcome: 'succeeded', subject: 'done', body: 'b' })
    expect(r.status).toBe(200)
    expect(probed).toBe(0)
    expect(orch.state().dispatches.find((d) => d.id === dsp)).toMatchObject({ outcome: 'succeeded' })
  })

  // 2026-11-03T07:58: a worker-start ran 483 s (worktree checks, git, the pty spawn on a starved machine)
  it("answers task-update while a worker-start's spawn runs, and keeps both commits", async () => {
    const { working, other } = await seed()
    const spawn = gate({ sessionId: 'ses2', cwd: 'D:/wt/b', specPath: 'D:/specs/b.md' })
    const orch = orchOver({
      local: {
        startWorker: spawn.effect,
        startCoordinator: stub,
        releaseWorker: stub,
        readWorker: stub,
        probeLimit: async () => null,
        readReviewFile: async () => null,
        makeRunWorktree: stub,
        mergeWorktrees: stub,
        removeWorktrees: stub,
        owns: () => true
      } as never
    })
    await orch.ready()
    const starting = call(orch, 'worker-start', { task: other, agent: 'claude', account: 'acc1', worktree: 'current' })
    try {
      await spawn.entered
      // The start's Dispatch is committed before the spawn, and another command commits meanwhile
      expect(orch.state().dispatches.some((d) => d.taskId === other && !d.endedAt)).toBe(true)
      expect(await answersWithin(orch, 'jobs-rename', { id: orch.state().jobs[0].id, title: 'renamed meanwhile' })).toBeLessThan(500)
    } finally {
      spawn.release()
    }
    const r = await starting
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    const st = orch.state()
    expect(st.dispatches.find((d) => d.taskId === other && !d.endedAt)).toMatchObject({ sessionId: 'ses2', cwd: 'D:/wt/b' })
    expect(st.jobs[0].title).toBe('renamed meanwhile')
    expect(st.tasks.find((t) => t.id === working)?.status).toBe('dispatched')
  })

  it("answers task-update while jobs-create resolves the project root, and keeps that commit", async () => {
    const { other } = await seed()
    const resolve = gate('D:/p')
    const orch = orchOver({ resolveProjectRoot: () => resolve.effect() })
    await orch.ready()
    const creating = call(orch, 'jobs-create', { objective: 'a new plan', cwd: 'D:/p/sub' })
    try {
      await resolve.entered
      expect(await answersWithin(orch, 'task-update', { id: other, title: 'renamed meanwhile' })).toBeLessThan(500)
    } finally {
      resolve.release()
    }
    const r = await creating
    expect(r.status).toBe(200)
    const st = orch.state()
    expect(st.jobs.some((j) => j.objective === 'a new plan' && j.cwd === 'D:/p')).toBe(true)
    expect(st.jobs).toHaveLength(2)
    expect(st.tasks.find((t) => t.id === other)?.title).toBe('renamed meanwhile')
  })
})
