// T3: a field profile held a 5.6 MB orchestration.json (416 tasks, 544 dispatches, 798 messages), and every commit made
// all other commands wait for a whole-file stringify and fsync; planner commands took 59-120 s. This seeds a state of
// that size and asks the real Host orchestration for the commands planners and coordinators send most.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHostOrch } from '../../host/orch'
import { createJob, createTask, emptyState, startJobRun, type OrchState } from './state'
import type { Dispatch, Message } from './types'

const DAY = 24 * 60 * 60 * 1000
const OLD = new Date(Date.now() - 3 * DAY).toISOString()
const NOW = new Date().toISOString()
const LIVE_SESSIONS = Array.from({ length: 20 }, (_, i) => `ses_live_${i}`)

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-orch-bench-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

const ok = <T>(r: { ok: true; state: OrchState; value: T } | { ok: false; error: string }): { state: OrchState; value: T } => {
  if (!r.ok) throw new Error(r.error)
  return r
}

/** About 6 MB: 60 plans finished three days ago (7 Tasks, 9 Dispatches and 13 Messages each) and one live plan whose 20
 *  Tasks each have a worker in one of the 20 live sessions. */
function seedState(): { state: OrchState; liveRunId: string; pendingTaskId: string; oldRunId: string; oldTaskId: string } {
  let s = emptyState()
  const dispatches: Dispatch[] = []
  const messages: Message[] = []
  const dispatch = (taskId: string, i: number, at: string, open: boolean): Dispatch => ({
    id: `dsp_${taskId}_${i}`,
    taskId,
    provider: 'claude',
    accountId: 'acc1',
    sessionId: open ? LIVE_SESSIONS[i] : `ses_${taskId}_${i}`,
    cwd: 'D:/p',
    specPath: `D:/p/orch/specs/${taskId}.md`,
    startedAt: at,
    workerState: 'ready',
    retained: false,
    ...(open ? {} : { outcome: 'succeeded' as const, endedAt: at })
  })
  const message = (runId: string, taskId: string, i: number, at: string): Message => ({
    id: `msg_${taskId}_${i}`,
    runId,
    type: 'worker_done',
    taskId,
    subject: `report ${i}`,
    body: 'b'.repeat(1400),
    answered: false,
    createdAt: at
  })
  for (let j = 0; j < 60; j++) {
    const job = ok(createJob(s, { objective: `plan ${j}`, cwd: 'D:/p', concurrency: 4 }, OLD))
    const run = ok(startJobRun(job.state, job.value.id, OLD))
    s = run.state
    for (let t = 0; t < 7; t++) {
      const task = ok(createTask(s, { runId: run.value.id, title: `t${j}.${t}`, spec: 's'.repeat(9000), deps: [] }, OLD))
      s = task.state
      dispatches.push(dispatch(task.value.id, 0, OLD, false))
      if (t < 2) dispatches.push(dispatch(task.value.id, 1, OLD, false))
      messages.push(message(run.value.id, task.value.id, 0, OLD), message(run.value.id, task.value.id, 1, OLD))
    }
    messages.push(message(run.value.id, 'none', j, OLD))
  }
  s = { ...s, tasks: s.tasks.map((t) => ({ ...t, status: 'completed' as const, updatedAt: OLD })) }
  const live = ok(createJob(s, { objective: 'the live plan', cwd: 'D:/p', concurrency: 20 }, NOW))
  const liveRun = ok(startJobRun(live.state, live.value.id, NOW))
  s = liveRun.state
  const liveIds: string[] = []
  for (let t = 0; t < 25; t++) {
    const task = ok(createTask(s, { runId: liveRun.value.id, title: `live ${t}`, spec: 's'.repeat(9000), deps: [] }, NOW))
    s = task.state
    liveIds.push(task.value.id)
  }
  s = { ...s, tasks: s.tasks.map((t) => (liveIds.slice(0, 20).includes(t.id) ? { ...t, status: 'dispatched' as const } : t)) }
  liveIds.slice(0, 20).forEach((id, i) => dispatches.push(dispatch(id, i, NOW, true)))
  const old = s.tasks[0]
  return { state: { ...s, dispatches, messages }, liveRunId: liveRun.value.id, pendingTaskId: liveIds[24], oldRunId: old.runId!, oldTaskId: old.id }
}

const orchOver = (): ReturnType<typeof createHostOrch> =>
  createHostOrch({
    profileDir: dir,
    version: '9.9.9',
    now: () => new Date().toISOString(),
    hostStartedAt: () => NOW,
    runningSessions: () => LIVE_SESSIONS.length,
    aliveSessionIds: () => new Set(LIVE_SESSIONS),
    act: async () => ({}),
    hasApp: () => true,
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

const timed = async (run: () => Promise<{ status: number }>): Promise<number> => {
  const at = performance.now()
  const reply = await run()
  expect(reply.status).toBe(200)
  return performance.now() - at
}

/** The field's disk: on Windows a rename over a file hooks and scanners hold open is retried, and a whole-state fsync
 *  takes its time. Every write of the state file costs this much here, so a command that waits for the disk shows it. */
const SLOW_WRITE_MS = 250
const slowDisk = (): void => {
  const realRename = fs.rename
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    await new Promise((r) => setTimeout(r, SLOW_WRITE_MS))
    await realRename(from, to)
  })
}

describe('orchestration commands over a 6 MB state with 20 live sessions', () => {
  it('answers tasks list, task-create and task-update in under a second each', async () => {
    const { state, liveRunId, pendingTaskId } = seedState()
    const text = JSON.stringify(state)
    expect(text.length).toBeGreaterThan(5.5e6)
    await fs.writeFile(path.join(dir, 'orchestration.json'), text, 'utf8')
    const orch = orchOver()
    await orch.ready()
    await orch.flush()
    slowDisk()
    const call = (cmd: string, args: Record<string, unknown>) => () => orch.call({ cmd, args, sessionId: '' })

    // Every live session commits at once, as coordinators and planners do in a busy plan
    const burst = LIVE_SESSIONS.map((_, i) => call('task-create', { run: liveRunId, title: `burst ${i}`, spec: 's' })())
    expect(await timed(call('tasks-list', { run: liveRunId }))).toBeLessThan(1000)
    expect(await timed(call('task-create', { run: liveRunId, title: 'new', spec: 's' }))).toBeLessThan(1000)
    expect(await timed(call('task-update', { id: pendingTaskId, title: 'renamed' }))).toBeLessThan(1000)

    const at = performance.now()
    for (let i = 0; i < 10; i++) expect((await call('task-update', { id: pendingTaskId, title: `renamed ${i}` })()).status).toBe(200)
    expect(performance.now() - at).toBeLessThan(2000)
    expect((await Promise.all(burst)).map((r) => r.status)).toEqual(LIVE_SESSIONS.map(() => 200))
    await orch.flush()
  }, 60_000)
})

describe('the Host over the store (T3)', () => {
  it('answers a commit before its write lands, and flush writes it', async () => {
    const { state, liveRunId } = seedState()
    const file = path.join(dir, 'orchestration.json')
    await fs.writeFile(file, JSON.stringify(state), 'utf8')
    const orch = orchOver()
    await orch.ready()
    await orch.flush()
    const realRename = fs.rename
    let open!: () => void
    const gate = new Promise<void>((r) => (open = r))
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      await gate
      await realRename(from, to)
    })
    const reply = await orch.call({ cmd: 'task-create', args: { run: liveRunId, title: 'held', spec: 's' }, sessionId: '' })
    expect(reply.status).toBe(200)
    expect(orch.state().tasks.some((t) => t.title === 'held')).toBe(true)
    expect(await fs.readFile(file, 'utf8')).not.toContain('"title":"held"')
    let flushed = false
    const f = orch.flush().then(() => (flushed = true))
    await new Promise((r) => setTimeout(r, 20))
    expect(flushed).toBe(false)
    open()
    await f
    expect(await fs.readFile(file, 'utf8')).toContain('"title":"held"')
  }, 60_000)

  it('archives the finished Runs and still answers runs-get, tasks-get and dispatch-show for one after a restart', async () => {
    const { state, oldRunId, oldTaskId } = seedState()
    const file = path.join(dir, 'orchestration.json')
    await fs.writeFile(file, JSON.stringify(state), 'utf8')
    const first = orchOver()
    await first.ready()
    await first.flush()
    expect(await fs.stat(path.join(dir, 'orch', 'archive', `${oldRunId}.json`))).toBeTruthy()
    const hot = await fs.readFile(file, 'utf8')
    expect(hot.length).toBeLessThan(text(state).length / 10)

    const orch = orchOver()
    const call = (cmd: string, args: Record<string, unknown>) => orch.call({ cmd, args, sessionId: '' })
    expect((await call('runs-get', { id: oldRunId })).status).toBe(200)
    const task = await call('tasks-get', { id: oldTaskId })
    expect(task.status).toBe(200)
    const shown = await call('dispatch-show', { task: oldTaskId })
    expect(shown.status).toBe(200)
    expect(shown.body).toHaveLength(2)
  }, 60_000)
})

const text = (s: OrchState): string => JSON.stringify(s)
