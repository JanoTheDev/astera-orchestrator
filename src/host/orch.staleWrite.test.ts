import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHostOrch } from './orch'
import { createJob, createTask, emptyState, openDispatch, startJobRun, type OrchState } from '../core/orchestration/state'

// The four review Dispatches lost on 2026-11-02 (host.log 22:36:34–37): `worker-start` read the state, awaited its
// account choice, and committed `openDispatch` of that read; four review starts — outside the command chain — had
// opened their Dispatches in that window, and the whole-state commit erased them. The reviewers ran with no Dispatch.

const NOW = '2026-11-02T22:36:34.000Z'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-hostorch-stale-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

const seed = async (n: number): Promise<string[]> => {
  const job = createJob(emptyState(), { objective: 'o', cwd: 'D:/p', concurrency: 10 }, NOW)
  if (!job.ok) throw new Error(job.error)
  const run = startJobRun(job.state, job.value.id, NOW)
  if (!run.ok) throw new Error(run.error)
  let state: OrchState = run.state
  const ids: string[] = []
  for (let i = 0; i < n; i++) {
    const t = createTask(state, { runId: run.value.id, title: `t${i}`, spec: 's', deps: [] }, NOW)
    if (!t.ok) throw new Error(t.error)
    state = t.state
    ids.push(t.value.id)
  }
  await fs.writeFile(path.join(dir, 'orchestration.json'), JSON.stringify(state, null, 2), 'utf8')
  return ids
}

const tick = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const orchOver = (over: Partial<Parameters<typeof createHostOrch>[0]> = {}): ReturnType<typeof createHostOrch> => {
  let started = 0
  return createHostOrch({
    profileDir: dir,
    version: '9.9.9',
    now: () => NOW,
    hostStartedAt: () => '2026-11-02T20:00:00.000Z',
    runningSessions: () => 0,
    aliveSessionIds: () => new Set<string>(),
    act: async (name) => (name === 'startWorker' ? { sessionId: `ses${++started}`, cwd: 'D:/wt', specPath: 'D:/wt/s.md' } : {}),
    hasApp: () => true,
    onState: () => {},
    log: () => {},
    sessions: { listSessions: async () => [], readSession: async () => ({ cols: 80, rows: 24, screen: [], scrollback: [] }), sendSession: async () => {}, readChat: async () => [], sendChat: async () => {}, serial: (_id, run) => run() },
    ...over
  })
}

/** A commit made from outside the command chain, as a review start makes one: read, open, commit, no await between. */
const openOutsideChain = async (orch: ReturnType<typeof createHostOrch>, taskId: string): Promise<string> => {
  const deps = orch.internalDeps()
  const opened = openDispatch(deps.getState(), { taskId, provider: 'claude', accountId: 'acc2', sessionId: `pending:${taskId}`, cwd: 'D:/p', specPath: '' }, NOW)
  if (!opened.ok) throw new Error(opened.error)
  await deps.setState(opened.state)
  return opened.value.id
}

describe('a commit built on an older snapshot does not erase the commits made since', () => {
  it('keeps a Dispatch opened outside the chain while worker-start awaited its account check', async () => {
    const [mine, theirs] = await seed(2)
    let orch: ReturnType<typeof createHostOrch> | undefined = undefined
    let concurrent: string | undefined
    orch = orchOver({
      usageGuard: {
        // The await between worker-start's read and its commit; a review start lands its Dispatch inside it.
        refresh: async () => {
          await tick(5)
          concurrent = await openOutsideChain(orch!, theirs)
        },
        pauseOf: () => null
      }
    })
    const r = await orch.call({ cmd: 'worker-start', args: { task: mine, agent: 'codex', account: 'acc1', worktree: 'current' }, sessionId: '' })
    expect(r.status).toBe(200)
    const ids = orch.state().dispatches.map((d) => d.id)
    expect(ids).toContain((r.body as { dispatchId: string }).dispatchId)
    expect(ids, 'the Dispatch committed during worker-start’s await was erased').toContain(concurrent)
    // And on disk, not only in memory.
    await tick(50)
    const disk = JSON.parse(await fs.readFile(path.join(dir, 'orchestration.json'), 'utf8')) as OrchState
    expect(disk.dispatches.map((d) => d.id)).toEqual(expect.arrayContaining([concurrent, (r.body as { dispatchId: string }).dispatchId]))
  })

  it('rebases any read → await → write onto the commits that landed meanwhile, and says so', async () => {
    const [a, b] = await seed(2)
    const lines: string[] = []
    const orch = orchOver({ log: (m) => lines.push(m) })
    await orch.ready()
    const deps = orch.internalDeps()
    // The stale flow: reads, then awaits (a file read, a login check, a spawn)…
    const stale = deps.getState()
    await tick(5)
    // …while another flow commits.
    const concurrent = await openOutsideChain(orch, b)
    // …then commits what it built from its read.
    const mine = openDispatch(stale, { taskId: a, provider: 'codex', accountId: 'acc1', sessionId: 'pending:a', cwd: 'D:/p', specPath: '' }, NOW)
    if (!mine.ok) throw new Error(mine.error)
    await deps.setState(mine.state)
    const s = orch.state()
    expect(s.dispatches.map((d) => d.id).sort()).toEqual([concurrent, mine.value.id].sort())
    // Both Tasks keep their own move: neither write rolled the other's Task back to ready.
    expect(s.tasks.find((t) => t.id === a)?.status).toBe('dispatched')
    expect(s.tasks.find((t) => t.id === b)?.status).toBe('dispatched')
    expect(lines.some((l) => l.startsWith('stale write rebased:') && l.includes(`dispatches/${concurrent}`))).toBe(true)
  })

  it('lands a write built on the current state as given, with no rebase', async () => {
    const [a] = await seed(1)
    const lines: string[] = []
    const orch = orchOver({ log: (m) => lines.push(m) })
    await orch.ready()
    const deps = orch.internalDeps()
    const opened = openDispatch(deps.getState(), { taskId: a, provider: 'codex', accountId: 'acc1', sessionId: 'pending:a', cwd: 'D:/p', specPath: '' }, NOW)
    if (!opened.ok) throw new Error(opened.error)
    await deps.setState(opened.state)
    // A rollback built on the latest state still deletes what it means to
    const latest = deps.getState()
    await deps.setState({ ...latest, dispatches: latest.dispatches.filter((d) => d.id !== opened.value.id) })
    expect(orch.state().dispatches).toHaveLength(0)
    expect(lines.filter((l) => l.startsWith('stale write rebased:'))).toEqual([])
  })
})
