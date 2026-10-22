// A Task completes only once its commits are merged into the plan branch (the Run's own worktree): a succeeded Task
// waits in `merging`, the app's wave merge (dispatchLoop mergeWaves) lands it, and only then is it completed. Real temp
// repositories and the real command layer; only the session spawn is faked.
import { describe, it, expect, beforeEach } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { makeRepo, gitSync, tempDir } from '../../worktrees/testRepo'
import { WorktreeRegistry } from '../../worktrees/registry'
import { git } from '../../worktrees/git'
import { forkWorktree, integrateWorktrees, type Integration } from './integrateGit'
import { createDispatchLoop, type DispatchLoopContext } from './dispatchLoop'
import { handleCommand, type OrchServerDeps } from '../command'
import { APP_CALLER } from '../../host/driver'
import { emptyState, openDispatch, type OrchState } from '../state'
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
    state: () => state,
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
    expect(h.get('tsk_B').status).toBe('merging')
    await h.loop.nudge()
    expect(h.get('tsk_B').status).toBe('completed')
    expect(await isAncestor(shaB, runWt)).toBe(true)
  })

  it('a conflicting branch stays merging, gets one merge Task, and completes when that merge Task does', async () => {
    const runWt = await fork('run')
    const h = rig(runWt, [task({ id: 'tsk_A' })])
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
    const h = rig(runWt, [task({ id: 'tsk_A' })])
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
    const h = rig(runWt, [task({ id: 'tsk_A' })])
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
