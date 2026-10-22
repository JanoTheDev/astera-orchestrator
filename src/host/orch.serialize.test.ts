import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHostOrch } from './orch'
import { createJob, createTask, emptyState, startJobRun, type OrchState } from '../core/orchestration/state'

// The Host runs state-changing commands one at a time (`serially` in orch.ts). Before it, ten parallel
// `worker-start`s each committed a whole state read before their awaits, and only the last commit survived.

const NOW = '2026-10-20T11:02:04.000Z'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-hostorch-serial-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

/** One Job, one Run and `n` Tasks, written through the pure layer as the app writes them. */
const seed = async (n: number): Promise<{ runId: string; taskIds: string[] }> => {
  const job = createJob(emptyState(), { objective: 'o', cwd: 'D:/p', concurrency: 10 }, NOW)
  if (!job.ok) throw new Error(job.error)
  const run = startJobRun(job.state, job.value.id, NOW)
  if (!run.ok) throw new Error(run.error)
  let state: OrchState = run.state
  const taskIds: string[] = []
  for (let i = 0; i < n; i++) {
    const task = createTask(state, { runId: run.value.id, title: `t${i}`, spec: 's', deps: [] }, NOW)
    if (!task.ok) throw new Error(task.error)
    state = task.state
    taskIds.push(task.value.id)
  }
  await fs.writeFile(path.join(dir, 'orchestration.json'), JSON.stringify(state, null, 2), 'utf8')
  return { runId: run.value.id, taskIds }
}

const tick = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const orchOver = (over: Partial<Parameters<typeof createHostOrch>[0]> = {}): ReturnType<typeof createHostOrch> => {
  let started = 0
  return createHostOrch({
    profileDir: dir,
    version: '9.9.9',
    now: () => NOW,
    hostStartedAt: () => '2026-10-20T10:00:00.000Z',
    runningSessions: () => 0,
    aliveSessionIds: () => new Set<string>(),
    act: async (name) => (name === 'startWorker' ? { sessionId: `ses${++started}`, cwd: 'D:/wt', specPath: 'D:/wt/s.md' } : {}),
    hasApp: () => true,
    onState: () => {},
    log: () => {},
    // The await between a command's read and its commit, where the lost update happened.
    usageGuard: { refresh: () => tick(20), pauseOf: () => null },
    sessions: { listSessions: async () => [], readSession: async () => ({ cols: 80, rows: 24, screen: [], scrollback: [] }), sendSession: async () => {}, readChat: async () => [], sendChat: async () => {}, serial: (_id, run) => run() },
    ...over
  })
}

const workerStart = (orch: ReturnType<typeof createHostOrch>, taskId: string) =>
  orch.call({ cmd: 'worker-start', args: { task: taskId, agent: 'codex', account: 'acc1', worktree: 'current' }, sessionId: '' })

const openDispatches = (orch: ReturnType<typeof createHostOrch>) => orch.state().dispatches.filter((d) => !d.endedAt && !d.outcome)

describe('the Host runs commands one at a time', () => {
  it('keeps every Dispatch of ten worker-starts fired at once', async () => {
    const { taskIds } = await seed(10)
    const orch = orchOver()
    const replies = await Promise.all(taskIds.map((id) => workerStart(orch, id)))
    expect(replies.map((r) => r.status)).toEqual(taskIds.map(() => 200))
    const ids = replies.map((r) => (r.body as { dispatchId: string }).dispatchId)
    const known = new Set(orch.state().dispatches.map((d) => d.id))
    expect(ids.filter((id) => !known.has(id))).toEqual([])
    expect(openDispatches(orch)).toHaveLength(10)
  })

  it('holds the app-wide worker cap under ten worker-starts fired at once', async () => {
    const { taskIds } = await seed(10)
    await fs.writeFile(path.join(dir, 'app-settings.json'), JSON.stringify({ maxConcurrentWorkers: 4 }), 'utf8')
    const orch = orchOver()
    const replies = await Promise.all(taskIds.map((id) => workerStart(orch, id)))
    expect(replies.filter((r) => r.status === 200)).toHaveLength(4)
    expect(replies.filter((r) => r.status === 409 && (r.body as { atCapacity?: boolean }).atCapacity)).toHaveLength(6)
    expect(openDispatches(orch)).toHaveLength(4)
  })

  it('runs a call made from inside a running command inline, not behind itself', async () => {
    const { taskIds } = await seed(1)
    let nested: { status: number } | undefined
    let orch: ReturnType<typeof createHostOrch> | undefined = undefined
    orch = orchOver({
      usageGuard: {
        // The shape of `tasks-dispatch` -> the loop -> `orch.handle(...)`: a call back into the Host while the command
        // holds the chain (the spawn hands it on, so the call is made before it).
        refresh: async () => {
          nested = await orch!.handle('jobs-list', {})
        },
        pauseOf: () => null
      }
    })
    const r = await Promise.race([workerStart(orch, taskIds[0]), tick(2_000).then(() => 'deadlocked' as const)])
    expect(r).not.toBe('deadlocked')
    expect(nested?.status).toBe(200)
    expect(openDispatches(orch)).toHaveLength(1)
  })

  it('lets a worker-start through while a check --wait is waiting', async () => {
    const { runId, taskIds } = await seed(1)
    const orch = orchOver()
    await orch.ready()
    let waited = false
    const waiting = orch.call({ cmd: 'check', args: { run: runId, wait: true, timeoutMs: 1_500 }, sessionId: '' }).then((r) => {
      waited = true
      return r
    })
    await tick(30)
    const r = await workerStart(orch, taskIds[0])
    expect(r.status).toBe(200)
    expect(waited, 'worker-start was answered only after the wait ended').toBe(false)
    await waiting
  })

  it('a command that throws does not stop the next one', async () => {
    const { taskIds } = await seed(2)
    let first = true
    const orch = orchOver({
      usageGuard: {
        refresh: async () => {
          if (first) {
            first = false
            throw new Error('refresh broke')
          }
        },
        pauseOf: () => null
      }
    })
    const [a, b] = await Promise.all(taskIds.map((id) => workerStart(orch, id)))
    expect(a.status).toBe(500)
    expect(b.status).toBe(200)
  })
})
