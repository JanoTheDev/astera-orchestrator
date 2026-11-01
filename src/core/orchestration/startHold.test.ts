// T13: the hold on new starts for the whole profile (startHold.ts) and the commands that keep it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  holdToWrite,
  liftStartHold,
  mayLift,
  parseStartHold,
  readStartHold,
  RESTART_HOLD_REASON,
  startHoldFileIn,
  startHoldMessage,
  writeStartHold,
  type StartHold
} from './startHold'
import { handleCommand, type HostSession, type OrchServerDeps } from './command'
import { emptyState, type OrchState } from './state'
import { slotsToFill } from './schedule'

const NOW = '2026-10-31T10:00:00.000Z'
const RESTART: StartHold = { by: 'restart', reason: RESTART_HOLD_REASON, at: NOW }
const OWNER: StartHold = { by: 'owner', reason: 'moving to a new laptop', at: NOW }

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-start-hold-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('startHoldFileIn', () => {
  it('sits in the profile’s host folder, on a Windows profile with a drive letter and backslashes too', () => {
    expect(startHoldFileIn('C:\\Users\\Jo Doe\\AppData\\Roaming\\astera', path.win32)).toBe(
      'C:\\Users\\Jo Doe\\AppData\\Roaming\\astera\\host\\start-hold.json'
    )
    expect(startHoldFileIn('D:/profiles/astera-dev', path.win32)).toBe('D:\\profiles\\astera-dev\\host\\start-hold.json')
    expect(startHoldFileIn('/home/me/.config/astera', path.posix)).toBe('/home/me/.config/astera/host/start-hold.json')
  })
})

describe('parseStartHold', () => {
  it('reads both holders', () => {
    expect(parseStartHold(JSON.stringify(RESTART))).toEqual(RESTART)
    expect(parseStartHold(JSON.stringify(OWNER))).toEqual(OWNER)
  })

  it('reads a file that is there but not a hold as the owner’s: being there is the signal', () => {
    expect(parseStartHold('{ torn').by).toBe('owner')
    expect(parseStartHold('null')).toEqual({ by: 'owner', reason: '', at: '' })
    expect(parseStartHold(JSON.stringify({ by: 'someone', reason: 7 }))).toEqual({ by: 'owner', reason: '', at: '' })
  })
})

describe('startHoldMessage', () => {
  it('says why and what to do, for a restart and for the owner', () => {
    expect(startHoldMessage(RESTART)).toBe(
      `new starts are on hold while the Astera Host restarts (since ${NOW}); the next Host lifts the hold once it has resumed the sessions, so wait and start it again then`
    )
    expect(startHoldMessage(OWNER)).toBe(`new starts are on hold: moving to a new laptop (since ${NOW}); nothing new starts until the owner lifts the hold`)
    expect(startHoldMessage({ by: 'owner', reason: '', at: '' })).toBe('new starts are on hold; nothing new starts until the owner lifts the hold')
  })
})

describe('holdToWrite / mayLift', () => {
  it('lets a restart never write over the owner’s hold', () => {
    expect(holdToWrite(null, RESTART)).toEqual(RESTART)
    expect(holdToWrite(OWNER, RESTART)).toBeNull()
    expect(holdToWrite(RESTART, OWNER)).toEqual(OWNER)
    expect(holdToWrite(RESTART, RESTART)).toEqual(RESTART)
  })

  it('lifts only the named holder’s hold, or any when none is named', () => {
    expect(mayLift(null, 'restart')).toBe(false)
    expect(mayLift(RESTART, 'restart')).toBe(true)
    expect(mayLift(OWNER, 'restart')).toBe(false)
    expect(mayLift(OWNER)).toBe(true)
  })
})

describe('the file', () => {
  it('is absent at first, written whole, kept under an owner’s hold, and lifted only by its holder', async () => {
    expect(await readStartHold(dir)).toBeNull()
    expect(await writeStartHold(dir, RESTART)).toEqual(RESTART)
    expect(await readStartHold(dir)).toEqual(RESTART)
    expect((await fs.readdir(path.join(dir, 'host'))).filter((f) => f.endsWith('.tmp'))).toEqual([]) // no temp file left

    expect(await liftStartHold(dir, 'restart')).toBe(true)
    expect(await readStartHold(dir)).toBeNull()
    expect(await liftStartHold(dir, 'restart')).toBe(false)

    await writeStartHold(dir, OWNER)
    // A restart asked under the owner's hold leaves it, and the next Host's lift leaves it too
    expect(await writeStartHold(dir, RESTART)).toEqual(OWNER)
    expect(await liftStartHold(dir, 'restart')).toBe(false)
    expect(await readStartHold(dir)).toEqual(OWNER)
    expect(await liftStartHold(dir)).toBe(true)
    expect(await readStartHold(dir)).toBeNull()
  })

  it('reads a hand-broken file as the owner’s hold', async () => {
    await fs.mkdir(path.join(dir, 'host'), { recursive: true })
    await fs.writeFile(startHoldFileIn(dir), 'not json', 'utf8')
    expect((await readStartHold(dir))?.by).toBe('owner')
  })
})

// The commands, over a profile the Host names (`profileDir`): worker-start, tasks-dispatch and jobs-plan.
const makeDeps = (over: Partial<OrchServerDeps> = {}) => {
  const box = { state: emptyState() }
  const startWorker = vi.fn(async () => ({ sessionId: 'sess-w1', cwd: dir, specPath: path.join(dir, 'spec.md') }))
  const startCoordinator = vi.fn(async () => ({ sessionId: 'planner-1' }))
  const deps = {
    getState: () => box.state,
    setState: async (next: OrchState) => {
      box.state = next
    },
    startWorker,
    startCoordinator,
    listAccounts: () => [{ id: 'acc1', label: 'acc', provider: 'codex', default: true }],
    readWorker: async () => 'output',
    listSessions: async (): Promise<HostSession[]> => [],
    now: () => NOW,
    profileDir: dir,
    ...over
  } as unknown as OrchServerDeps
  return { deps, startWorker, startCoordinator }
}

const PERSON = { sessionId: '' }
const AGENT = { sessionId: 'coordinator' }

/** A Run with one ready Task, placed by Astera (autoDispatch). */
const withReadyTask = async (over: Partial<OrchServerDeps> = {}) => {
  const h = makeDeps(over)
  await handleCommand(h.deps, AGENT, 'run-create', { objective: 'Ship it', cwd: dir, concurrency: 2 })
  const runId = h.deps.getState().runs[0].id
  const made = await handleCommand(h.deps, AGENT, 'task-create', { run: runId, title: 't1', spec: 's', account: 'acc1' })
  const st = h.deps.getState()
  await h.deps.setState({ ...st, jobs: st.jobs.map((j) => ({ ...j, autoDispatch: true })) })
  return { ...h, taskId: (made.body as { id: string }).id }
}

describe('worker-start while new starts are held', () => {
  it('refuses a new worker from a coordinator and from a person, as a wait, and starts nothing', async () => {
    const h = await withReadyTask()
    await writeStartHold(dir, RESTART)
    for (const caller of [AGENT, PERSON]) {
      const w = await handleCommand(h.deps, caller, 'worker-start', { task: h.taskId, agent: 'codex', account: 'acc1', worktree: 'current' })
      expect(w.status).toBe(409)
      expect(w.body).toMatchObject({ held: true, error: startHoldMessage(RESTART), startHold: RESTART })
    }
    const d = await handleCommand(h.deps, PERSON, 'tasks-dispatch', { id: h.taskId })
    expect(d).toEqual({ status: 409, body: { error: startHoldMessage(RESTART), held: true, startHold: RESTART } })
    expect(h.startWorker).not.toHaveBeenCalled()
    expect(h.deps.getState().dispatches).toEqual([])
  })

  it('starts again once the hold is lifted, and is not held where no profile is named (the app’s own layer)', async () => {
    const h = await withReadyTask()
    await writeStartHold(dir, OWNER)
    expect((await handleCommand(h.deps, AGENT, 'worker-start', { task: h.taskId, agent: 'codex', account: 'acc1', worktree: 'current' })).status).toBe(409)
    await liftStartHold(dir)
    const w = await handleCommand(h.deps, AGENT, 'worker-start', { task: h.taskId, agent: 'codex', account: 'acc1', worktree: 'current' })
    expect(w.status).toBe(200)
    expect(h.startWorker).toHaveBeenCalledTimes(1)

    const app = await withReadyTask({ profileDir: undefined })
    await writeStartHold(dir, OWNER)
    expect((await handleCommand(app.deps, AGENT, 'worker-start', { task: app.taskId, agent: 'codex', account: 'acc1', worktree: 'current' })).status).toBe(200)
  })

  it('leaves nothing for the scheduler to place (schedule.ts slotsToFill)', async () => {
    const h = await withReadyTask()
    expect(slotsToFill(h.deps.getState()).map((s) => s.taskId)).toEqual([h.taskId])
    expect(slotsToFill(h.deps.getState(), { startHeld: true })).toEqual([])
  })
})

describe('jobs-plan while new starts are held', () => {
  const pendingPlan = (h: ReturnType<typeof makeDeps>) =>
    h.deps.setState({ ...emptyState(), jobs: [{ id: 'job_1', objective: 'o', cwd: dir, createdAt: NOW, pendingStart: true }] })

  it('starts no fresh planner, and leaves the plan as it was', async () => {
    const h = makeDeps()
    await pendingPlan(h)
    await writeStartHold(dir, RESTART)
    const r = await handleCommand(h.deps, PERSON, 'jobs-plan', { id: 'job_1' })
    expect(r).toMatchObject({ status: 409, body: { held: true, error: startHoldMessage(RESTART) } })
    expect(h.startCoordinator).not.toHaveBeenCalled()
    expect(h.deps.getState().jobs[0].plannerSessionIds).toBeUndefined()
  })

  it('still resumes a planner’s own conversation after a restart (--resume is no new start)', async () => {
    const h = makeDeps()
    await pendingPlan(h)
    await writeStartHold(dir, RESTART)
    const r = await handleCommand(h.deps, PERSON, 'jobs-plan', { id: 'job_1', resume: 'native-planner' })
    expect((r.body as { held?: boolean }).held).toBeUndefined()
    expect(h.startCoordinator).toHaveBeenCalledTimes(1)
    expect(h.startCoordinator.mock.calls[0]).toEqual([expect.objectContaining({ role: 'planner', resume: 'native-planner' })])
  })
})
