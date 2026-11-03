import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHostOrch, READS_OUTSIDE_CHAIN } from './orch'
import { createJob, createTask, emptyState, startJobRun, type OrchState } from '../core/orchestration/state'
import { OrchestrationStore } from '../core/orchestration/store'
import { ensureProject } from '../core/orchestration/projects'
import type { HostSession } from '../core/orchestration/command'

// T2: read commands answer from memory beside the command chain, never queued behind a long write (the 64-82 s
// `tasks list` at 17 sessions and 3 plans).

const NOW = '2026-11-01T10:00:00.000Z'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-hostorch-reads-'))
})
const made: Array<{ flush(): Promise<void> }> = []
afterEach(async () => {
  // Commits no longer wait for the disk: let the last write land before its folder goes.
  await Promise.all(made.splice(0).map((o) => o.flush().catch(() => {})))
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

const tick = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** `plans` running plans in one project, three Tasks each. */
const seed = async (plans: number): Promise<{ projectId: string; jobIds: string[]; runIds: string[]; taskIds: string[] }> => {
  const p = ensureProject(emptyState(), { path: 'D:/p', now: NOW })
  let state: OrchState = p.state
  const jobIds: string[] = []
  const runIds: string[] = []
  const taskIds: string[] = []
  for (let j = 0; j < plans; j++) {
    const job = createJob(state, { objective: `plan ${j}`, cwd: 'D:/p', concurrency: 4 }, NOW)
    if (!job.ok) throw new Error(job.error)
    const run = startJobRun(job.state, job.value.id, NOW)
    if (!run.ok) throw new Error(run.error)
    state = run.state
    jobIds.push(job.value.id)
    runIds.push(run.value.id)
    for (let t = 0; t < 3; t++) {
      const task = createTask(state, { runId: run.value.id, title: `p${j}t${t}`, spec: 's', deps: [] }, NOW)
      if (!task.ok) throw new Error(task.error)
      state = task.state
      taskIds.push(task.value.id)
    }
  }
  await fs.writeFile(path.join(dir, 'orchestration.json'), JSON.stringify(state, null, 2), 'utf8')
  return { projectId: p.project.id, jobIds, runIds, taskIds }
}

/** The state store with a disk write held until `release`, or `holdMs` at most: the commit moves memory at once. */
class SlowStore extends OrchestrationStore {
  holdMs = 0
  private released: () => void = () => {}
  saving: Promise<void> = new Promise(() => {})
  private began: () => void = () => {}
  constructor(file: string) {
    super(file)
    this.saving = new Promise((r) => (this.began = r))
  }
  release(): void {
    this.released()
  }
  override async save(...args: Parameters<OrchestrationStore['save']>): Promise<void> {
    const wrote = super.save(...args)
    if (this.holdMs > 0) {
      this.began()
      await Promise.race([new Promise<void>((r) => (this.released = r)), tick(this.holdMs)])
    }
    return wrote
  }
}

const sessions = (n: number): HostSession[] =>
  Array.from({ length: n }, (_, i) => ({ id: `ses${i}`, kind: 'terminal' as const, title: `s${i}`, accountId: null, cwd: 'D:/p', alive: true, state: 'idle' as const }))

const orchOver = (over: Partial<Parameters<typeof createHostOrch>[0]> = {}): ReturnType<typeof createHostOrch> => {
  const o = createHostOrch({
    profileDir: dir,
    version: '9.9.9',
    now: () => NOW,
    hostStartedAt: () => '2026-11-01T09:00:00.000Z',
    runningSessions: () => 0,
    aliveSessionIds: () => new Set<string>(),
    act: async (name) => (name === 'listAccounts' ? [{ id: 'acc1', name: 'a', provider: 'claude' }] : name === 'listRunConfigs' ? [] : {}),
    hasApp: () => true,
    onState: () => {},
    log: () => {},
    sessions: {
      listSessions: async () => sessions(20),
      readSession: async () => ({ cols: 80, rows: 24, screen: [], scrollback: [] }),
      sendSession: async () => {},
      readChat: async () => [],
      sendChat: async () => {},
      serial: (_id, run) => run()
    },
    readSummaries: async () => [],
    ...over
  })
  made.push(o)
  return o
}

const rename = (orch: ReturnType<typeof createHostOrch>, id: string, title: string) =>
  orch.call({ cmd: 'jobs-rename', args: { id, title }, sessionId: '' })

describe('read commands answer outside the command chain', () => {
  it('answers every read in under 500 ms while a write holds the chain for 10 s, with 20 sessions and 4 plans', async () => {
    const { projectId, jobIds, runIds, taskIds } = await seed(4)
    const store = new SlowStore(path.join(dir, 'orchestration.json'))
    let slowAccounts = false
    const orch = orchOver({
      store,
      act: async (name) => {
        if (name === 'listAccounts') {
          if (slowAccounts) await tick(10_000)
          return [{ id: 'acc1', name: 'a', provider: 'claude' }]
        }
        return name === 'listRunConfigs' ? [] : {}
      }
    })
    await orch.ready()
    // The accounts list seen once; afterwards an app round trip would take 10 s.
    expect((await orch.call({ cmd: 'accounts-list', args: {}, sessionId: '' })).status).toBe(200)
    slowAccounts = true

    store.holdMs = 10_000
    const held = rename(orch, jobIds[0], 'renamed while saving')
    await store.saving
    // Queued behind the held one: proves the chain is held while the reads below answer.
    let queuedAnswered = false
    const queued = rename(orch, jobIds[1], 'second').then((r) => ((queuedAnswered = true), r))

    const reads: Array<[string, Record<string, unknown>]> = [
      ['runs-get', { id: runIds[0] }],
      ['runs-list', {}],
      ['jobs-get', { id: jobIds[0] }],
      ['jobs-list', {}],
      ['tasks-get', { id: taskIds[0] }],
      ['tasks-list', {}],
      ['sessions-list', {}],
      ['summaries', {}],
      ['main-plan', { project: projectId }],
      ['jobs-overlaps', { id: jobIds[0] }],
      ['dispatch-show', { task: taskIds[0] }],
      ['run-configs-list', { job: jobIds[0] }],
      ['accounts-list', {}]
    ]
    const answers = await Promise.all(
      reads.map(async ([cmd, args]) => {
        const t0 = Date.now()
        const r = await orch.call({ cmd, args, sessionId: '' })
        return { cmd, status: r.status, body: r.body, ms: Date.now() - t0 }
      })
    )
    for (const x of answers) {
      expect(x.status, x.cmd).toBe(200)
      expect(x.ms, x.cmd).toBeLessThan(500)
    }
    expect(queuedAnswered, 'the second write ran while the first held the chain').toBe(false)
    const body = (cmd: string): unknown => answers.find((x) => x.cmd === cmd)!.body
    expect((body('tasks-list') as unknown[]).length).toBe(12)
    expect((body('jobs-list') as unknown[]).length).toBe(4)
    expect((body('runs-list') as unknown[]).length).toBe(4)
    expect((body('sessions-list') as unknown[]).length).toBe(20)
    expect((body('runs-get') as { id: string }).id).toBe(runIds[0])
    expect((body('tasks-get') as { id: string }).id).toBe(taskIds[0])
    expect(body('accounts-list')).toEqual([{ id: 'acc1', name: 'a', provider: 'claude' }])
    // The write committed before the reads is what they read, its save still on its way to the disk.
    expect((body('jobs-get') as { title?: string }).title).toBe('renamed while saving')

    store.holdMs = 0
    store.release()
    expect((await held).status).toBe(200)
    expect((await queued).status).toBe(200)
  }, 20_000)

  it('names every read in READS_OUTSIDE_CHAIN that the spec asks for', () => {
    for (const c of ['runs-get', 'runs-list', 'jobs-list', 'jobs-get', 'tasks-get', 'tasks-list', 'sessions-list', 'summaries', 'sessions-summary', 'main-plan', 'jobs-overlaps', 'dispatch-show', 'run-configs-list', 'accounts-list'])
      expect(READS_OUTSIDE_CHAIN.has(c), c).toBe(true)
  })

  it('a read made right after a write was answered sees that write', async () => {
    const { jobIds } = await seed(1)
    const orch = orchOver()
    expect((await rename(orch, jobIds[0], 'fresh')).status).toBe(200)
    const r = await orch.call({ cmd: 'jobs-get', args: { id: jobIds[0] }, sessionId: '' })
    expect((r.body as { title?: string }).title).toBe('fresh')
  })
})

describe('the slow-command log', () => {
  it('names a slow command, its wait, its run time and the command it waited behind', async () => {
    const { jobIds } = await seed(2)
    const lines: string[] = []
    // A commit no longer waits for the disk, so the first command holds the chain here, in the breadcrumb that wraps it.
    const orch = orchOver({
      slowCommandMs: 100,
      log: (l) => lines.push(l),
      track: async (cmd, run) => {
        if (cmd === 'jobs-rename') await tick(300)
        return run()
      }
    })
    await orch.ready()
    const first = rename(orch, jobIds[0], 'one')
    await tick(20)
    const second = orch.call({ cmd: 'jobs-archive', args: { id: jobIds[1] }, sessionId: '' })
    await Promise.all([first, second])
    const slow = lines.filter((l) => l.startsWith('host: slow command'))
    expect(slow.filter((l) => l.startsWith('host: slow command jobs-archive '))).toHaveLength(1)
    expect(slow.find((l) => l.startsWith('host: slow command jobs-archive '))).toMatch(
      /^host: slow command jobs-archive took \d+ ms \(waited \d+ ms behind jobs-rename, ran \d+ ms, held the chain \d+ ms\)$/
    )
    expect(slow.find((l) => l.startsWith('host: slow command jobs-rename '))).toMatch(/\(waited \d+ ms behind nothing, ran \d+ ms, held the chain \d+ ms\)$/)
  })

  it('says how long a command held the chain, its time outside it (outsideChain) left out', async () => {
    const { jobIds } = await seed(1)
    const lines: string[] = []
    // The fake resolver takes 300 ms with the chain handed on (run-create's resolveProjectRoot runs off the chain)
    const orch = orchOver({
      slowCommandMs: 100,
      log: (l) => lines.push(l),
      hasApp: () => false,
      resolveProjectRoot: async (cwd) => (await tick(300), cwd)
    })
    await orch.ready()
    expect(jobIds).toHaveLength(1)
    expect((await orch.call({ cmd: 'run-create', args: { objective: 'o', cwd: 'D:/p' }, sessionId: '' })).status).toBe(200)
    const line = lines.find((l) => l.startsWith('host: slow command run-create '))
    const m = /ran (\d+) ms, held the chain (\d+) ms\)$/.exec(line ?? '')
    expect(m, line).not.toBeNull()
    expect(Number(m![1])).toBeGreaterThanOrEqual(290)
    expect(Number(m![2])).toBeLessThan(200)
  })

  it('logs a slow read answered outside the chain, and nothing for a fast one', async () => {
    await seed(1)
    const lines: string[] = []
    let slow = true
    const orch = orchOver({
      slowCommandMs: 100,
      log: (l) => lines.push(l),
      sessions: {
        listSessions: async () => (slow ? (await tick(200), sessions(1)) : sessions(1)),
        readSession: async () => ({ cols: 80, rows: 24, screen: [], scrollback: [] }),
        sendSession: async () => {},
        readChat: async () => [],
        sendChat: async () => {},
        serial: (_id, run) => run()
      }
    })
    await orch.call({ cmd: 'sessions-list', args: {}, sessionId: '' })
    slow = false
    await orch.call({ cmd: 'sessions-list', args: {}, sessionId: '' })
    expect(lines.filter((l) => l.startsWith('host: slow command'))).toEqual([expect.stringMatching(/^host: slow command sessions-list took \d+ ms \(a read, outside the chain\)$/)])
  })
})

// 2026-11-03: `jobs archive` held the chain 20 s to 4 min while its worktree clean-up read `git status` of every
// worktree, and 75 of them in a row froze the Host.
describe('jobs-archive hands the chain on while it cleans up', () => {
  /** `plans` finished plans: every Task completed, so archiving one cleans its worktrees. */
  const seedFinished = async (plans: number): Promise<string[]> => {
    const { jobIds } = await seed(plans)
    const file = path.join(dir, 'orchestration.json')
    const state = JSON.parse(await fs.readFile(file, 'utf8')) as OrchState
    await fs.writeFile(file, JSON.stringify({ ...state, tasks: state.tasks.map((t) => ({ ...t, status: 'completed' })) }, null, 2), 'utf8')
    return jobIds
  }

  it('answers another write while an archive waits on its worktree clean-up, the archive already committed', async () => {
    const jobIds = await seedFinished(2)
    let releaseClean: () => void = () => {}
    let cleaning: () => void = () => {}
    const cleanStarted = new Promise<void>((r) => (cleaning = r))
    const cleaned: string[] = []
    const orch = orchOver({
      cleanWorktrees: async (runId) => {
        cleaned.push(runId)
        cleaning()
        await new Promise<void>((r) => (releaseClean = r))
      }
    })
    await orch.ready()
    const archive = orch.call({ cmd: 'jobs-archive', args: { id: jobIds[0] }, sessionId: '' })
    await cleanStarted
    // The archived flag is committed before the slow step
    expect(orch.state().jobs.find((j) => j.id === jobIds[0])?.archivedAt).toBe(NOW)
    const t0 = Date.now()
    const other = await rename(orch, jobIds[1], 'renamed while the archive cleans')
    expect(other.status).toBe(200)
    expect(Date.now() - t0).toBeLessThan(1000)
    releaseClean()
    const r = await archive
    expect(r.status).toBe(200)
    expect(cleaned).toHaveLength(1)
    expect(orch.state().jobs.find((j) => j.id === jobIds[1])?.title).toBe('renamed while the archive cleans')
  })

  it('archives many Jobs with --ids in one commit', async () => {
    const jobIds = await seedFinished(3)
    const cleaned: string[] = []
    let commits = 0
    const orch = orchOver({ cleanWorktrees: async (runId) => void cleaned.push(runId), onState: () => void (commits += 1) })
    await orch.ready()
    const before = commits
    const r = await orch.call({ cmd: 'jobs-archive', args: { ids: `${jobIds[0]}, ${jobIds[2]}` }, sessionId: '' })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ archived: [jobIds[0], jobIds[2]], refused: [] })
    expect(commits - before).toBe(1)
    expect(orch.state().jobs.filter((j) => j.archivedAt !== undefined).map((j) => j.id)).toEqual([jobIds[0], jobIds[2]])
    expect(cleaned).toHaveLength(2)
    expect((await orch.call({ cmd: 'jobs-archive', args: { ids: 'nope' }, sessionId: '' })).status).toBe(404)
    expect((await orch.call({ cmd: 'jobs-archive', args: { ids: '' }, sessionId: '' })).status).toBe(400)
  })
})
