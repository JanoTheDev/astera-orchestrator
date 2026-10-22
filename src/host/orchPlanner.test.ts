// W2-A: the planner's gate holds on the Host's command path, which drives Jobs even while the app is open
// (CONTEXT.md rule 7). The fixture is orch.test.ts's: a profile written through the pure layer.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHostOrch } from './orch'
import { createJob, createTask, emptyState } from '../core/orchestration/state'

const NOW = '2026-10-17T00:00:00.000Z'
const PLANNER = 'ses-plan'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-hostplanner-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

/** A planned Job waiting for approval, with one Task that holds, written as the store writes it. */
const seed = async (): Promise<string> => {
  const job = createJob(emptyState(), { objective: 'plan me', cwd: path.join(dir, 'repo'), pendingStart: true }, NOW)
  if (!job.ok) throw new Error(job.error)
  const planned = { ...job.state, jobs: job.state.jobs.map((j) => ({ ...j, plannerSessionIds: [PLANNER] })) }
  const task = createTask(planned, { jobId: job.value.id, title: 't', spec: 's', deps: [], prompt: 'do it', acceptanceCriteria: ['done'], affectedPaths: ['a.txt'], /* W6-A */ basis: { state: 'missing', evidence: 'none yet' } }, NOW)
  if (!task.ok) throw new Error(task.error)
  await fs.writeFile(path.join(dir, 'orchestration.json'), JSON.stringify(task.state), 'utf8')
  return job.value.id
}

const hostOrch = (): ReturnType<typeof createHostOrch> =>
  createHostOrch({
    profileDir: dir,
    version: '9.9.9',
    now: () => NOW,
    hostStartedAt: () => '2026-10-16T23:00:00.000Z',
    runningSessions: () => 0,
    aliveSessionIds: () => new Set<string>(),
    act: async () => ({}),
    hasApp: () => false,
    onState: () => {},
    log: () => {},
    sessions: {
      listSessions: async () => [],
      readSession: async () => ({ cols: 80, rows: 24, screen: [], scrollback: [] }),
      sendSession: async () => {},
      readChat: async () => [],
      sendChat: async () => {},
      serial: (_id, run) => run()
    }
  })

describe('the Host refuses a planner session every command that starts work', () => {
  it.each([
    ['worker-start', { taskId: 'tsk_x', agent: 'claude', account: 'acc1' }],
    ['run-merge', { run: 'run_x' }],
    ['tasks-dispatch', { id: 'tsk_x' }],
    ['sessions-send', { id: 'ses_x', text: 'go' }]
  ])('%s', async (cmd, args) => {
    await seed()
    const r = await hostOrch().call({ cmd, args, sessionId: PLANNER })
    expect(r.status).toBe(403)
  })

  it('jobs run of its own valid plan: refused, and the Job stays a draft', async () => {
    const jobId = await seed()
    const orch = hostOrch()
    expect((await orch.call({ cmd: 'jobs-run', args: { id: jobId }, sessionId: PLANNER })).status).toBe(403)
    expect((await orch.call({ cmd: 'run-start', args: { run: jobId }, sessionId: PLANNER })).status).toBe(403)
    const file = JSON.parse(await fs.readFile(path.join(dir, 'orchestration.json'), 'utf8')) as { jobs: Array<{ pendingStart?: boolean }>; runs: unknown[] }
    expect(file.jobs[0].pendingStart).toBe(true)
    expect(file.runs).toHaveLength(0)
  })

  // W3-D: MCP lists `jobs-run` (run_job) as a control command; approving a plan is still the person's act.
  it('an MCP client with control access cannot approve it through run_job', async () => {
    const jobId = await seed()
    await fs.writeFile(path.join(dir, 'app-settings.json'), JSON.stringify({ mcpAccess: 'control' }), 'utf8')
    const r = await hostOrch().call({ cmd: 'jobs-run', args: { id: jobId }, sessionId: '', from: { role: 'mcp', toOthers: () => {} } })
    expect(r.status).toBe(403)
    expect(JSON.stringify(r.body)).toContain('approving a plan is for the person')
    const file = JSON.parse(await fs.readFile(path.join(dir, 'orchestration.json'), 'utf8')) as { jobs: Array<{ pendingStart?: boolean }> }
    expect(file.jobs[0].pendingStart).toBe(true)
  })

  it('a person approves the same plan through the Host', async () => {
    const jobId = await seed()
    const r = await hostOrch().call({ cmd: 'run-start', args: { run: jobId }, sessionId: '' })
    expect(r.status).toBe(200)
  })
})

// T25: a planner start with no account that has room is answered at once with the plain reason on the Job; it never holds
// the Host's command chain (`serially`), so every other command goes on while it waits for the loop's next try.
describe('a held planner start does not hold the Host', () => {
  it('jobs-plan answers at once with startWait on the Job, and the next command is not queued behind it', async () => {
    const job = createJob(emptyState(), { objective: 'plan me', cwd: path.join(dir, 'repo'), pendingStart: true }, NOW)
    if (!job.ok) throw new Error(job.error)
    const named = { ...job.state, jobs: job.state.jobs.map((j) => ({ ...j, coordinatorAccountId: 'acc1' })) }
    await fs.writeFile(path.join(dir, 'orchestration.json'), JSON.stringify(named), 'utf8')
    const why = 'no claude account has room to start the planner on: acc1 (its weekly limit is at the usage threshold)'
    const stub = async () => ({}) as never
    const orch = createHostOrch({
      profileDir: dir,
      version: '9.9.9',
      now: () => NOW,
      hostStartedAt: () => '2026-10-16T23:00:00.000Z',
      runningSessions: () => 0,
      aliveSessionIds: () => new Set<string>(),
      act: async () => ({}),
      hasApp: () => false,
      onState: () => {},
      log: () => {},
      local: {
        startWorker: stub,
        startCoordinator: async (a: { onWait?: (w: string | null) => void | Promise<void> }) => {
          await a.onWait?.(why)
          throw new Error(why)
        },
        releaseWorker: stub,
        readWorker: stub,
        probeLimit: stub,
        readReviewFile: stub,
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
      }
    })
    const planned = await orch.call({ cmd: 'jobs-plan', args: { id: job.value.id }, sessionId: '' })
    expect(planned.status).toBe(200)
    expect(planned.body).toMatchObject({ jobId: job.value.id, waiting: why })
    expect(orch.state().jobs[0]).toMatchObject({ startWait: why })
    expect((await orch.call({ cmd: 'jobs-list', args: {}, sessionId: '' })).status).toBe(200)
  })
})
