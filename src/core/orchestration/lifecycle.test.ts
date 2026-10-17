// W1-C plan lifecycle: a Job's title, and archiving it (lifecycle.ts). Archiving starts nothing new for the plan and
// ends nothing unless asked; the title names the plan wherever jobNameOf does.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { handleCommand, type OrchServerDeps } from './command'
import { emptyState, runGatedForTask, type OrchState } from './state'
import { archiveJob, archivedTargetOf, isJobActive, JOB_TITLE_MAX, renameJob, unarchiveJob } from './lifecycle'
import { jobNameOf } from './jobName'
import { slotsToFill } from './schedule'
import { firesDue } from './fire'
import { OrchestrationStore, RUN_TTL_MS } from './store'
import { snapshotFor } from './view'
import { TOOLS } from '../../cli/mcp/tools'

const NOW = '2026-10-17T00:00:00.000Z'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-lifecycle-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const makeDeps = (): OrchServerDeps & { releaseWorker: ReturnType<typeof vi.fn> } => {
  const box = { state: emptyState() }
  return {
    getState: () => box.state,
    setState: async (next: OrchState) => {
      box.state = next
    },
    startWorker: async () => ({ sessionId: 'sess1', cwd: dir, specPath: path.join(dir, 'spec.md') }),
    releaseWorker: vi.fn(async () => {}),
    listAccounts: () => [{ id: 'acc1', label: 'acc', provider: 'codex' }],
    readWorker: async () => 'output',
    now: () => NOW
  } as unknown as OrchServerDeps & { releaseWorker: ReturnType<typeof vi.fn> }
}

const call = (deps: OrchServerDeps, cmd: string, args: Record<string, unknown> = {}): Promise<{ status: number; body: unknown }> =>
  handleCommand(deps, { sessionId: 'coordinator' }, cmd, args)

/** A Job with one Run, two ready Tasks, and a worker open on the first. */
const withWorker = async (): Promise<{ deps: ReturnType<typeof makeDeps>; jobId: string; runId: string; dispatchId: string; second: string }> => {
  const deps = makeDeps()
  await call(deps, 'run-create', { objective: 'Ship the login page\n\nDetails follow.', cwd: dir })
  const s = deps.getState()
  const jobId = s.jobs[0].id
  const runId = s.runs[0].id
  const first = await call(deps, 'task-create', { run: runId, title: 't1', spec: 's', account: 'acc1' })
  const second = await call(deps, 'task-create', { run: runId, title: 't2', spec: 's', account: 'acc1' })
  const w = await call(deps, 'worker-start', { task: (first.body as { id: string }).id, agent: 'codex', account: 'acc1' })
  expect(w.status).toBe(200)
  return { deps, jobId, runId, dispatchId: (w.body as { dispatchId: string }).dispatchId, second: (second.body as { id: string }).id }
}

const openDispatches = (s: OrchState): number => s.dispatches.filter((d) => !d.outcome && !d.endedAt).length

describe('a Job’s title', () => {
  it('names the Job ahead of its source and objective, and an empty one gives the name back', () => {
    const source = { id: 'src', itemId: 'ENG-1', label: 'Linear ENG-1', title: 'Fix login' }
    expect(jobNameOf({ objective: 'o', source, title: 'Login' })).toBe('Login')
    let s: OrchState = { ...emptyState(), jobs: [{ id: 'job_1', objective: 'o', cwd: dir, createdAt: NOW, source }] }
    const named = renameJob(s, 'job_1', '  Login\n page  ')
    expect(named.ok && named.value.title).toBe('Login page')
    s = named.ok ? named.state : s
    const cleared = renameJob(s, 'job_1', '   ')
    expect(cleared.ok && 'title' in cleared.value).toBe(false)
    expect(cleared.ok && jobNameOf(cleared.value)).toBe('Fix login')
    const long = renameJob(s, 'job_1', 'x'.repeat(JOB_TITLE_MAX + 50))
    expect(long.ok && long.value.title?.length).toBe(JOB_TITLE_MAX)
    expect(renameJob(s, 'job_nope', 't')).toMatchObject({ ok: false, missing: true })
  })

  it('jobs rename sets it, answers the Job, and the sidebar row carries it', async () => {
    const { deps, jobId } = await withWorker()
    const r = await call(deps, 'jobs-rename', { id: jobId, title: 'Login' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ id: jobId, title: 'Login' })
    expect(deps.getState().jobs[0].objective).toBe('Ship the login page\n\nDetails follow.')
    expect(snapshotFor(deps.getState(), dir, () => true, [], () => null, () => true).runs[0]).toMatchObject({ title: 'Login' })
    expect((await call(deps, 'jobs-rename', { id: jobId })).status).toBe(400)
    expect((await call(deps, 'jobs-rename', { id: 'job_nope', title: 't' })).status).toBe(404)
  })
})

describe('archiving a Job', () => {
  it('keeps its running sessions alive and stamps it once', async () => {
    const { deps, jobId, dispatchId } = await withWorker()
    const r = await call(deps, 'jobs-archive', { id: jobId })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ id: jobId, archivedAt: NOW })
    expect(deps.releaseWorker).not.toHaveBeenCalled()
    const s = deps.getState()
    expect(s.dispatches.find((d) => d.id === dispatchId)?.endedAt).toBeUndefined()
    expect(s.runs[0].paused).toBeUndefined()
    // Again: the first time is kept
    const again = archiveJob(s, jobId, '2026-10-18T00:00:00.000Z')
    expect(again.ok && again.value.archivedAt).toBe(NOW)
  })

  it('blocks new dispatch: the commands that start work, the app’s placement, recovery and fires', async () => {
    const { deps, jobId, runId, second } = await withWorker()
    await call(deps, 'jobs-archive', { id: jobId })
    const s = deps.getState()
    const refused = [
      await call(deps, 'worker-start', { task: second, agent: 'codex', account: 'acc1' }),
      await call(deps, 'tasks-dispatch', { id: second }),
      await call(deps, 'jobs-run', { id: jobId }),
      await call(deps, 'run-start', { run: runId }),
      await call(deps, 'run-spawn', { run: jobId })
    ]
    for (const r of refused) {
      expect(r.status).toBe(409)
      expect((r.body as { error: string }).error).toContain('archived')
    }
    expect(openDispatches(deps.getState())).toBe(1)
    // The app's placement: the same Run placed by the app has a slot until the plan is archived
    const appDriven: OrchState = { ...s, jobs: s.jobs.map((j) => ({ ...j, autoDispatch: true })) }
    const live = unarchiveJob(appDriven, jobId)
    expect(live.ok && slotsToFill(live.state).length).toBeGreaterThan(0)
    expect(slotsToFill(appDriven)).toEqual([])
    expect(runGatedForTask(appDriven, { runId })).toBe(true)
    // A schedule neither fires nor arms
    const scheduled: OrchState = { ...s, jobs: s.jobs.map((j) => ({ ...j, schedule: { kind: 'daily', time: '09:00' } })) }
    expect(firesDue(scheduled, new Map([[jobId, 0]]), Date.parse(NOW)).fire).toEqual([])
    const liveSchedule = unarchiveJob(scheduled, jobId)
    expect(liveSchedule.ok && firesDue(liveSchedule.state, new Map([[jobId, 0]]), Date.parse(NOW)).fire).toEqual([jobId])
    expect(archivedTargetOf(s, 'worker-start', { taskId: second })?.id).toBe(jobId)
  })

  it('with --kill-sessions closes its sessions, pauses the Run, and archives', async () => {
    const { deps, jobId, runId, dispatchId } = await withWorker()
    const r = await call(deps, 'jobs-archive', { id: jobId, killSessions: true })
    expect(r.status).toBe(200)
    expect(deps.releaseWorker).toHaveBeenCalledWith({ dispatchId })
    const s = deps.getState()
    expect(s.dispatches.find((d) => d.id === dispatchId)).toMatchObject({ workerState: 'stopped', closedBy: 'stop' })
    expect(s.runs.find((x) => x.id === runId)?.paused).toBe(true)
    expect(isJobActive(s.jobs[0])).toBe(false)
  })

  it('with --kill-sessions refuses, archiving nothing, while a worker is held by worker-retain', async () => {
    const { deps, jobId, dispatchId } = await withWorker()
    await deps.setState({ ...deps.getState(), dispatches: deps.getState().dispatches.map((d) => (d.id === dispatchId ? { ...d, retained: true } : d)) })
    const r = await call(deps, 'jobs-archive', { id: jobId, killSessions: true })
    expect(r.status).toBe(409)
    expect(isJobActive(deps.getState().jobs[0])).toBe(true)
  })

  it('is refused to a worker of the plan, as the other plan commands are', async () => {
    const { deps, jobId } = await withWorker()
    // sess1 is the session the worker was started in
    for (const cmd of ['jobs-archive', 'jobs-unarchive', 'jobs-rename'])
      expect((await handleCommand(deps, { sessionId: 'sess1' }, cmd, { id: jobId, title: 'x' })).status).toBe(403)
    expect(isJobActive(deps.getState().jobs[0])).toBe(true)
  })

  it('MCP list_jobs asks for archived Jobs only with includeArchived', () => {
    const tool = TOOLS.find((t) => t.name === 'list_jobs')!
    expect(tool.args({ includeArchived: true })).toEqual({ archived: true })
    expect(tool.args({})).toEqual({})
  })

  it('hides it from jobs list unless --archived, and unarchive brings it back', async () => {
    const { deps, jobId, second } = await withWorker()
    await call(deps, 'jobs-archive', { id: jobId })
    expect((await call(deps, 'jobs-list')).body).toEqual([])
    expect((await call(deps, 'jobs-list', { archived: true })).body).toMatchObject([{ id: jobId }])
    expect(snapshotFor(deps.getState(), dir, () => true, [], () => null, () => true).runs[0]).toMatchObject({ archivedAt: NOW })
    // A coordinator Job that lost its coordinator offers ▶ only while it is not archived (run-start refuses it)
    const withAccount = (st: OrchState): OrchState => ({ ...st, jobs: st.jobs.map((j) => ({ ...j, coordinatorAccountId: 'acc1' })) })
    const rowOf = (st: OrchState) => snapshotFor(withAccount(st), dir, () => true, [], () => null, () => true).runs[0]
    expect(rowOf(deps.getState())).not.toHaveProperty('coordinatorMissing')
    const live = unarchiveJob(deps.getState(), jobId)
    expect(live.ok && rowOf(live.state).coordinatorMissing).toBe(true)
    const back = await call(deps, 'jobs-unarchive', { id: jobId })
    expect(back.status).toBe(200)
    expect('archivedAt' in (back.body as object)).toBe(false)
    expect((await call(deps, 'jobs-list')).body).toMatchObject([{ id: jobId }])
    // It takes work again: the second Task's worker is no longer refused for the archive
    const w = await call(deps, 'worker-start', { task: second, agent: 'codex', account: 'acc1' })
    expect((w.body as { error?: string }).error ?? '').not.toContain('archived')
  })
})

describe('the store', () => {
  const file = (): string => path.join(dir, 'orchestration.json')

  it('round-trips a title and an archive mark', async () => {
    const { deps, jobId } = await withWorker()
    await call(deps, 'jobs-rename', { id: jobId, title: 'Login' })
    await call(deps, 'jobs-archive', { id: jobId })
    const a = new OrchestrationStore(file())
    await a.load()
    await a.save(deps.getState())
    const b = new OrchestrationStore(file())
    await b.load()
    expect(b.get().jobs[0]).toMatchObject({ id: jobId, title: 'Login', archivedAt: NOW })
  })

  it('loads a file written before these fields: every Job is active and named by its objective', async () => {
    const { deps } = await withWorker()
    const old = deps.getState()
    expect(Object.keys(old.jobs[0])).not.toEqual(expect.arrayContaining(['title']))
    expect(Object.keys(old.jobs[0])).not.toEqual(expect.arrayContaining(['archivedAt']))
    await fs.writeFile(file(), JSON.stringify(old), 'utf8')
    const store = new OrchestrationStore(file())
    await store.load()
    const job = store.get().jobs[0]
    expect(isJobActive(job)).toBe(true)
    expect(jobNameOf(job)).toBe(job.objective)
  })

  it('the 30-day TTL drops an archived Job’s finished Run and never the Job', async () => {
    const { deps, jobId } = await withWorker()
    const long = new Date(Date.now() - RUN_TTL_MS - 1000).toISOString()
    const s = deps.getState()
    const archived = archiveJob(s, jobId, long)
    if (!archived.ok) throw new Error(archived.error)
    const finished: OrchState = {
      ...archived.state,
      runs: archived.state.runs.map((r) => ({ ...r, createdAt: long })),
      tasks: archived.state.tasks.map((t) => ({ ...t, status: 'completed' as const, updatedAt: long })),
      dispatches: archived.state.dispatches.map((d) => ({ ...d, endedAt: long, outcome: 'succeeded' as const })),
      messages: []
    }
    await fs.writeFile(file(), JSON.stringify(finished), 'utf8')
    const store = new OrchestrationStore(file())
    const r = await store.load()
    expect(r.pruned).toBe(1)
    expect(store.get().runs).toHaveLength(0)
    expect(store.get().jobs).toMatchObject([{ id: jobId, archivedAt: long }])
  })
})
