// A Task completes only once its commits are merged into the plan branch (the Run's own worktree): a succeeded Task
// waits in `merging`, the app's wave merge (dispatchLoop mergeWaves) lands it, and only then is it completed. Real temp
// repositories and the real command layer; only the session spawn is faked.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { makeRepo, gitSync, tempDir } from '../../worktrees/testRepo'
import { WorktreeRegistry } from '../../worktrees/registry'
import { git } from '../../worktrees/git'
import { forkWorktree, integrateWorktrees, type Integration } from './integrateGit'
import { createDispatchLoop, LANDING_STALE_MS, type DispatchLoopContext } from './dispatchLoop'
import { handleCommand, type OrchServerDeps } from '../command'
import { APP_CALLER } from '../../host/driver'
import { emptyState, openDispatch, type OrchState } from '../state'
import { buildIntegrationSpec, PLAN_CONFLICT_MARK } from '../integrate'
import { MERGING_WATCH_MS } from './mergingWatch'
import type { Task } from '../types'
import type { Account } from '../../types'

const NOW = '2026-10-20T00:00:00.000Z'
const commit = (cwd: string, file: string): string => {
  gitSync(cwd, ['add', file])
  gitSync(cwd, ['-c', 'user.name=Fixture', '-c', 'user.email=f@f', 'commit', '-m', `write ${file}`])
  return gitSync(cwd, ['rev-parse', 'HEAD'])
}
const write = async (cwd: string, file: string, text: string): Promise<string> => {
  await fs.writeFile(path.join(cwd, file), text)
  return commit(cwd, file)
}
const isAncestor = async (sha: string, cwd: string): Promise<boolean> =>
  (await git(['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd })).ok

const task = (over: Partial<Task> & Pick<Task, 'id'>): Task => ({
  runId: 'run_1',
  jobId: 'job_1',
  title: over.id,
  spec: 's',
  deps: [],
  status: 'ready',
  accountIds: ['accA'],
  consecutiveFailures: 0,
  createdAt: NOW,
  updatedAt: NOW,
  ...over
})

let repo: string, registry: WorktreeRegistry
beforeEach(async () => {
  repo = await makeRepo('astera-landing-')
  const root = await tempDir('astera-landing-root-')
  registry = new WorktreeRegistry(path.join(root, 'worktrees.json'), root)
  await registry.load()
})
const fork = (name: string): Promise<string> => forkWorktree({ repoPath: repo, name }, { registry, log: () => {} })

/** An auto-dispatch Run with its own worktree and no coordinator, over the real command layer and dispatch loop. */
function rig(runWt: string, tasks: Task[]) {
  let state: OrchState = {
    ...emptyState(),
    jobs: [{ id: 'job_1', objective: 'o', cwd: repo, createdAt: NOW, concurrency: 2, autoDispatch: true }],
    runs: [{ id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: NOW, worktree: runWt }],
    tasks
  }
  let spawned = 0
  const deps = {
    getState: () => state,
    // No loop run on commit: each test drives the merge step itself (loop.nudge)
    setState: async (next: OrchState) => {
      state = next
    },
    now: () => NOW,
    startWorker: async (a: { runCwd?: string }) => ({ sessionId: `s-${spawned++}`, cwd: a.runCwd ?? runWt, specPath: 'x' }),
    listAccounts: async () => [{ id: 'accA', label: 'accA', provider: 'claude' as const }],
    log: () => {},
    runningSessions: () => 0,
    appVersion: () => '1.0.0'
  } as unknown as OrchServerDeps
  const account: Account = { id: 'accA', label: 'accA', configDir: '/cfg/accA', color: '#000', createdAt: NOW, provider: 'claude' }
  const ctx: DispatchLoopContext = {
    handle: (cmd, args) => handleCommand(deps, { sessionId: APP_CALLER }, cmd, args),
    getState: () => state,
    accounts: () => [account],
    loginStatus: async () => true,
    lang: () => 'en',
    forkRunWorktree: async () => runWt,
    integrate: (root, merges) =>
      integrateWorktrees(root, merges, { reap: false }, { log: () => {}, gitOp: { begin: () => 'op', end: () => {} }, reap: async () => true }),
    reap: async () => true,
    isRegisteredWorktree: () => true,
    sessionAlive: () => true,
    sessionBusy: () => false,
    typeInto: () => {},
    mayStart: () => true,
    log: () => {},
    nowMs: () => Date.parse(NOW)
  }
  const loop = createDispatchLoop(ctx)
  return {
    ctx,
    loop,
    deps,
    state: () => state,
    put: (next: OrchState): void => {
      state = next
    },
    get: (id: string): Task => state.tasks.find((t) => t.id === id)!,
    /** A worker for this Task, in this folder (what worker-start records). */
    start: (taskId: string, cwd: string): void => {
      const r = openDispatch(state, { taskId, provider: 'claude', accountId: 'accA', sessionId: `ses_${taskId}`, cwd, specPath: '' }, NOW)
      if (!r.ok) throw new Error(r.error)
      state = r.state
    },
    /** The worker's own done report, from its session. */
    done: async (taskId: string, outcome: 'succeeded' | 'failed' = 'succeeded'): Promise<void> => {
      const d = [...state.dispatches].reverse().find((x) => x.taskId === taskId)!
      const r = await handleCommand(deps, { sessionId: d.sessionId }, 'send', {
        type: 'worker_done', taskId, dispatchId: d.id, outcome, subject: 'done', body: 'b'
      })
      expect(r.status).toBe(200)
    }
  }
}

describe('a Task completes only once merged into the plan branch', () => {
  /** T10: an open Task that depends on tsk_A, so tsk_A's work is merged into the plan branch before the delivery */
  const dependent = task({ id: 'tsk_Z', status: 'pending', deps: ['tsk_A'] })
  it('A -> B with no coordinator: A lands on the plan branch before B is ready, and B completes only after its own merge', async () => {
    const runWt = await fork('run')
    const h = rig(runWt, [task({ id: 'tsk_A' }), task({ id: 'tsk_B', status: 'pending', deps: ['tsk_A'] })])
    const a = await fork('a')
    h.start('tsk_A', a)
    const shaA = await write(a, 'a.txt', 'a')
    await h.done('tsk_A')
    expect(h.get('tsk_A').status).toBe('merging')
    expect(h.get('tsk_B').status).toBe('pending')
    expect(await isAncestor(shaA, runWt)).toBe(false)

    await h.loop.nudge()
    expect(h.get('tsk_A').status).toBe('completed')
    expect(h.get('tsk_A').mergedIntoPlanAt).toBe(NOW)
    expect(await isAncestor(shaA, runWt)).toBe(true)
    expect(h.get('tsk_B').status).toBe('ready')

    const b = await fork('b')
    h.start('tsk_B', b)
    const shaB = await write(b, 'b.txt', 'b')
    await h.done('tsk_B')
    // T10: no open Task depends on B, so it completes at once and the delivery merges its worktree
    expect(h.get('tsk_B').status).toBe('completed')
    await h.loop.nudge()
    expect(await isAncestor(shaB, runWt)).toBe(false)
  })

  it('a conflicting branch stays merging, gets one merge Task, and completes when that merge Task does', async () => {
    const runWt = await fork('run')
    const h = rig(runWt, [task({ id: 'tsk_A' }), dependent]) // T10: merged now only while an open Task depends on it
    const a = await fork('a')
    h.start('tsk_A', a)
    await write(a, 'f.txt', 'from A')
    await write(runWt, 'f.txt', 'from the plan branch')
    await h.done('tsk_A')

    await h.loop.nudge()
    expect(h.get('tsk_A').status).toBe('merging')
    const merges = h.state().tasks.filter((t) => t.parentId === 'tsk_A')
    expect(merges).toHaveLength(1)
    expect(merges[0].deps).toEqual([])
    expect(h.get(merges[0].id).status).toBe('dispatched')
    await h.loop.nudge()
    expect(h.state().tasks.filter((t) => t.parentId === 'tsk_A')).toHaveLength(1)
    expect(h.get('tsk_A').status).toBe('merging')

    // The merge worker works in the plan branch, so its own Task is completed at once; the merged Task with it
    await h.done(merges[0].id)
    expect(h.get(merges[0].id).status).toBe('completed')
    await h.loop.nudge()
    expect(h.get('tsk_A').status).toBe('completed')
    expect(h.get('tsk_A').mergedIntoPlanAt).toBe(NOW)
  })

  it('a failed merge Task opens a Gate, and the Task is never completed', async () => {
    const runWt = await fork('run')
    const h = rig(runWt, [task({ id: 'tsk_A' }), dependent]) // T10: merged now only while an open Task depends on it
    const a = await fork('a')
    h.start('tsk_A', a)
    await write(a, 'f.txt', 'from A')
    await write(runWt, 'f.txt', 'from the plan branch')
    await h.done('tsk_A')
    await h.loop.nudge()
    const merge = h.state().tasks.find((t) => t.parentId === 'tsk_A')!
    await h.done(merge.id, 'failed')
    await h.loop.nudge()
    expect(h.state().gates.filter((g) => g.taskId === merge.id && g.status === 'open')).toHaveLength(1)
    expect(h.get('tsk_A').status).toBe('merging')
  })

  it('a merge git cannot do opens a Gate on the Task, which is not completed', async () => {
    const runWt = await fork('run')
    const h = rig(runWt, [task({ id: 'tsk_A' }), dependent]) // T10: merged now only while an open Task depends on it
    const a = await fork('a')
    h.start('tsk_A', a)
    await write(a, 'a.txt', 'a')
    await h.done('tsk_A')
    h.ctx.integrate = async (): Promise<Integration> => ({ kind: 'human', reason: 'the plan branch has uncommitted changes' })
    await h.loop.nudge()
    expect(h.get('tsk_A').status).toBe('blocked')
    const gates = h.state().gates.filter((g) => g.taskId === 'tsk_A' && g.status === 'open')
    expect(gates).toHaveLength(1)
    expect(gates[0].question).toContain('the plan branch has uncommitted changes')
    expect(h.state().tasks.some((t) => t.parentId === 'tsk_A')).toBe(false)
  })

  it('a Task that worked in the plan branch itself (concurrency 1) goes straight to completed', async () => {
    const runWt = await fork('run')
    const h = rig(runWt, [task({ id: 'tsk_A' })])
    h.start('tsk_A', runWt)
    await write(runWt, 'a.txt', 'a')
    await h.done('tsk_A')
    expect(h.get('tsk_A').status).toBe('completed')
  })
})

describe('a merged Task never stays merging', () => {
  afterEach(() => {
    vi.useRealTimers()
  })
  const refreshSpec = buildIntegrationSpec({ mergeInto: '/plan', reason: `plan x delivered abc123 to main, and it ${PLAN_CONFLICT_MARK}: c`, worktrees: [] })

  it('a merging parent with a completed merge Task and an older refresh Task on the same anchor is recorded merged', async () => {
    const runWt = await fork('run')
    const h = rig(runWt, [
      task({ id: 'tsk_A', status: 'merging' }),
      task({ id: 'tsk_R', parentId: 'tsk_A', status: 'failed', spec: refreshSpec }),
      task({ id: 'tsk_M', parentId: 'tsk_A', status: 'completed' })
    ])
    await h.loop.nudge()
    expect(h.get('tsk_A').status).toBe('completed')
    expect(h.get('tsk_A').mergedIntoPlanAt).toBe(NOW)
  })

  it('a completed refresh Task never records its anchor as merged', async () => {
    const runWt = await fork('run')
    const h = rig(runWt, [task({ id: 'tsk_A', status: 'merging' }), task({ id: 'tsk_R', parentId: 'tsk_A', status: 'completed', spec: refreshSpec })])
    await h.loop.nudge()
    expect(h.get('tsk_A').status).toBe('merging')
    expect(h.get('tsk_A').mergedIntoPlanAt).toBeUndefined()
  })

  it('wave merge: the record is written in the same step as the merge, though the command chain never answers', async () => {
    const runWt = await fork('run')
    const h = rig(runWt, [task({ id: 'tsk_A' })])
    const a = await fork('a')
    h.start('tsk_A', a)
    const sha = await write(a, 'a.txt', 'a')
    await h.done('tsk_A')
    const real = h.ctx.handle
    h.ctx.handle = (cmd, args) => (cmd === 'task-update' ? new Promise(() => {}) : real(cmd, args))
    h.ctx.commit = async (change) => h.put(change(h.state()))
    await h.loop.nudge()
    expect(await isAncestor(sha, runWt)).toBe(true)
    expect(h.get('tsk_A').status).toBe('completed')
    expect(h.get('tsk_A').mergedIntoPlanAt).toBe(NOW)
  })

  it('merged with uncommitted work left: the Task keeps a merge Task for the rest', async () => {
    const runWt = await fork('run')
    const h = rig(runWt, [task({ id: 'tsk_A' })])
    const a = await fork('a')
    h.start('tsk_A', a)
    await h.done('tsk_A')
    h.ctx.integrate = async (): Promise<Integration> => ({ kind: 'merged', uncommitted: 1, dirty: [a] })
    await h.loop.nudge()
    expect(h.get('tsk_A').status).toBe('merging')
    const merge = h.state().tasks.find((t) => t.parentId === 'tsk_A')
    expect(merge?.status).toBe('dispatched')
  })

  it('merged with uncommitted work left and no merge Task can be made: the owner gets a Gate, never neither', async () => {
    const runWt = await fork('run')
    const h = rig(runWt, [task({ id: 'tsk_A' })])
    const a = await fork('a')
    h.start('tsk_A', a)
    await h.done('tsk_A')
    h.ctx.integrate = async (): Promise<Integration> => ({ kind: 'merged', uncommitted: 1, dirty: [a] })
    const real = h.ctx.handle
    h.ctx.handle = (cmd, args) => (cmd === 'task-create' ? Promise.resolve({ status: 400, body: { error: 'refused' } }) : real(cmd, args))
    await h.loop.nudge()
    expect(h.state().tasks.some((t) => t.parentId === 'tsk_A')).toBe(false)
    expect(h.get('tsk_A').status).toBe('blocked')
    expect(h.state().gates.filter((g) => g.taskId === 'tsk_A' && g.status === 'open')).toHaveLength(1)
  })

  it('a record whose command never answers is given up after 2 minutes, so the pass ends', async () => {
    const runWt = await fork('run')
    const h = rig(runWt, [task({ id: 'tsk_A', status: 'merging' }), task({ id: 'tsk_M', parentId: 'tsk_A', status: 'completed' })])
    const logs: string[] = []
    h.ctx.log = (m) => logs.push(m)
    const real = h.ctx.handle
    let askedAt: number | undefined
    h.ctx.handle = (cmd, args) => (cmd === 'task-update' ? ((askedAt = Date.now()), new Promise(() => {})) : real(cmd, args))
    vi.useFakeTimers({ now: Date.parse(NOW), toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    h.ctx.nowMs = () => Date.now()
    let ended = false
    void h.loop.nudge().then(() => (ended = true))
    while (askedAt === undefined) await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(askedAt + 119_000 - Date.now())
    expect(ended).toBe(false)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(ended).toBe(true)
    expect(logs.some((l) => l.includes("recording task=tsk_A's merge did not answer"))).toBe(true)
  })

  it('a merge pass whose await never resolves holds later passes back 5 minutes at most', async () => {
    const runWt = await fork('run')
    const h = rig(runWt, [task({ id: 'tsk_A' })])
    const a = await fork('a')
    h.start('tsk_A', a)
    await write(a, 'a.txt', 'a')
    await h.done('tsk_A')
    const logs: string[] = []
    h.ctx.log = (m) => logs.push(m)
    let pinnedAt: number | undefined
    h.ctx.integrate = () => ((pinnedAt = Date.now()), new Promise(() => {}))
    vi.useFakeTimers({ now: Date.parse(NOW), toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    h.ctx.nowMs = () => Date.now()
    void h.loop.nudge() // pinned in the merge of tsk_A
    while (pinnedAt === undefined) await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(60_000)
    // Another Task whose merge Task completed, after the pass began
    const at = new Date(Date.now()).toISOString()
    h.put({
      ...h.state(),
      tasks: [...h.state().tasks, task({ id: 'tsk_B', status: 'merging', updatedAt: at }), task({ id: 'tsk_M', parentId: 'tsk_B', status: 'completed', updatedAt: at })]
    })
    await h.loop.run()
    expect(h.get('tsk_B').status).toBe('merging')
    // Under 5 minutes old itself, so it is the new pass that records it, not the merging watch
    await vi.advanceTimersByTimeAsync(pinnedAt + LANDING_STALE_MS + 1 - Date.now())
    await h.loop.run()
    expect(h.get('tsk_B').status).toBe('completed')
    expect(logs.filter((l) => l.includes('is abandoned'))).toHaveLength(1)
  })

  it('the merging watch records a Task whose branch is already in the plan branch after 5 minutes, with its line', async () => {
    const runWt = await fork('run')
    const h = rig(runWt, [task({ id: 'tsk_A' }), task({ id: 'tsk_W' })])
    const a = await fork('a')
    h.start('tsk_A', a)
    await write(a, 'a.txt', 'a')
    await h.done('tsk_A')
    // Merged by hand, and a worker in the plan branch keeps the wave merge away
    gitSync(runWt, ['-c', 'user.name=F', '-c', 'user.email=f@f', 'merge', '--no-edit', gitSync(a, ['rev-parse', 'HEAD'])])
    h.start('tsk_W', runWt)
    const logs: string[] = []
    h.ctx.log = (m) => logs.push(m)
    h.ctx.nowMs = () => Date.parse(NOW) + MERGING_WATCH_MS - 1
    await h.loop.nudge()
    expect(h.get('tsk_A').status).toBe('merging')
    h.ctx.nowMs = () => Date.parse(NOW) + MERGING_WATCH_MS + 1
    await h.loop.nudge()
    expect(h.get('tsk_A').status).toBe('completed')
    expect(logs.some((l) => l.includes('recorded tsk_A merged: its branch tip is already in the plan branch'))).toBe(true)
  })
})
