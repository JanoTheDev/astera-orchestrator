// W5-C holds (issues #38, #39): a paused worker (`worker-hold`, Dispatch.held) keeps its session and its slot and is
// sent nothing by an agent; a plan held from launching (`jobs-hold`, Job.dispatchHold) gets no new worker from any
// placer and closes nothing. Both are the person's: refused from agent sessions and MCP clients, like run-start.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { handleCommand, type HostSession, type OrchServerDeps } from './command'
import { emptyState, type OrchState } from './state'
import { slotsToFill, workersAgainstCap } from './schedule'
import { holdOf } from './holds'
import type { Job } from './types'
import { mcpRefusal } from '../host/mcpGate'
import { controllerRefusal } from '../host/controllerGate'
import { APP_CALLER } from '../host/driver'

const NOW = '2026-10-18T00:00:00.000Z'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-holds-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const makeDeps = () => {
  const box = { state: emptyState() }
  const sendSession = vi.fn(async () => {})
  const releaseWorker = vi.fn(async () => {})
  const deps = {
    getState: () => box.state,
    setState: async (next: OrchState) => {
      box.state = next
    },
    startWorker: async () => ({ sessionId: 'sess-w1', cwd: dir, specPath: path.join(dir, 'spec.md') }),
    releaseWorker,
    listAccounts: () => [{ id: 'acc1', label: 'acc', provider: 'codex' }],
    readWorker: async () => 'output',
    listSessions: async (): Promise<HostSession[]> => [
      { id: 'sess-w1', kind: 'terminal', title: 'w', accountId: 'acc1', cwd: dir, alive: true, state: 'unknown' }
    ],
    sendSession,
    chatSend: async () => ({ sent: true }),
    now: () => NOW
  } as unknown as OrchServerDeps
  return { deps, sendSession, releaseWorker }
}

const PERSON = { sessionId: '' }
const AGENT = { sessionId: 'coordinator' }
const call = (deps: OrchServerDeps, cmd: string, args: Record<string, unknown> = {}, caller: { sessionId: string; role?: 'mcp' } = PERSON) =>
  handleCommand(deps, caller, cmd, args)

/** An app-driven plan (concurrency 1) with one Run, two ready Tasks and a worker open on the first. */
const withWorker = async () => {
  const h = makeDeps()
  await call(h.deps, 'run-create', { objective: 'Ship it', cwd: dir, concurrency: 1 }, AGENT)
  const s = h.deps.getState()
  const jobId = s.jobs[0].id
  const runId = s.runs[0].id
  const first = await call(h.deps, 'task-create', { run: runId, title: 't1', spec: 's', account: 'acc1' }, AGENT)
  const second = await call(h.deps, 'task-create', { run: runId, title: 't2', spec: 's', account: 'acc1' }, AGENT)
  const w = await call(h.deps, 'worker-start', { task: (first.body as { id: string }).id, agent: 'codex', account: 'acc1' }, AGENT)
  expect(w.status).toBe(200)
  // The Run is the app's to place from here on (autoDispatch), as a plan the Jobs view runs without a coordinator.
  const st = h.deps.getState()
  await h.deps.setState({ ...st, jobs: st.jobs.map((j) => ({ ...j, autoDispatch: true, concurrency: 2 })) })
  return { ...h, jobId, runId, dispatchId: (w.body as { dispatchId: string }).dispatchId, second: (second.body as { id: string }).id }
}

const open = (s: OrchState) => s.dispatches.filter((d) => !d.outcome && !d.endedAt)

describe('worker-hold (#38)', () => {
  it('keeps the worker open and in its slot, and agents cannot type into it; unhold lets them again', async () => {
    const h = await withWorker()
    // Concurrency 1: the open worker fills the plan, so the second Task waits either way
    const st = h.deps.getState()
    await h.deps.setState({ ...st, jobs: st.jobs.map((j) => ({ ...j, concurrency: 1 })) })
    const r = await call(h.deps, 'worker-hold', { dispatch: h.dispatchId })
    expect(r.status).toBe(200)
    const s = h.deps.getState()
    expect(open(s).map((d) => [d.id, d.held])).toEqual([[h.dispatchId, true]])
    expect(h.releaseWorker).not.toHaveBeenCalled()
    expect(slotsToFill(s)).toEqual([])
    expect(workersAgainstCap(s)).toBe(1)

    const fromAgent = await call(h.deps, 'sessions-send', { id: 'sess-w1', text: 'go on' }, AGENT)
    expect(fromAgent.status).toBe(409)
    const fromMcp = await call(h.deps, 'sessions-send', { id: 'sess-w1', text: 'go on' }, { sessionId: '', role: 'mcp' })
    expect(fromMcp.status).toBe(409)
    expect(h.sendSession).not.toHaveBeenCalled()
    // The person still types into a paused worker
    expect((await call(h.deps, 'sessions-send', { id: 'sess-w1', text: 'hi' }, { sessionId: APP_CALLER })).status).toBe(200)
    expect(h.sendSession).toHaveBeenCalledTimes(1)

    expect((await call(h.deps, 'worker-unhold', { dispatch: h.dispatchId })).status).toBe(200)
    expect('held' in h.deps.getState().dispatches[0]).toBe(false)
    expect((await call(h.deps, 'sessions-send', { id: 'sess-w1', text: 'go on' }, AGENT)).status).toBe(200)
  })

  it('is refused for an ended worker, an unknown one, and from an agent session or an MCP client', async () => {
    const h = await withWorker()
    expect((await call(h.deps, 'worker-hold', { dispatch: 'nope' })).status).toBe(404)
    expect((await call(h.deps, 'worker-hold', { dispatch: h.dispatchId }, AGENT)).status).toBe(403)
    expect((await call(h.deps, 'worker-hold', { dispatch: h.dispatchId }, { sessionId: '', role: 'mcp' })).status).toBe(403)
    expect((await call(h.deps, 'worker-unhold', { dispatch: h.dispatchId }, AGENT)).status).toBe(403)
    expect(h.deps.getState().dispatches[0].held).toBeUndefined()
    expect((await call(h.deps, 'worker-stop', { dispatch: h.dispatchId })).status).toBe(200)
    expect((await call(h.deps, 'worker-hold', { dispatch: h.dispatchId })).status).toBe(409)
  })
})

describe('jobs-hold (#39)', () => {
  it('places nothing new and closes nothing; unhold places again', async () => {
    const h = await withWorker()
    expect(slotsToFill(h.deps.getState()).map((x) => x.taskId)).toEqual([h.second])
    const r = await call(h.deps, 'jobs-hold', { id: h.jobId })
    expect(r.status).toBe(200)
    const s = h.deps.getState()
    expect(s.jobs[0].dispatchHold).toBe(true)
    expect(slotsToFill(s)).toEqual([])
    // Nothing closed, and the running worker still counts against the app-wide cap
    expect(open(s).map((d) => d.id)).toEqual([h.dispatchId])
    expect(h.releaseWorker).not.toHaveBeenCalled()
    expect(workersAgainstCap(s)).toBe(1)

    expect((await call(h.deps, 'jobs-unhold', { id: h.jobId })).status).toBe(200)
    expect('dispatchHold' in h.deps.getState().jobs[0]).toBe(false)
    expect(slotsToFill(h.deps.getState()).map((x) => x.taskId)).toEqual([h.second])
  })

  it('worker-start refuses for a held plan, from a coordinator and from a person, as a wait', async () => {
    const h = await withWorker()
    await call(h.deps, 'jobs-hold', { id: h.jobId })
    for (const caller of [AGENT, PERSON]) {
      const w = await call(h.deps, 'worker-start', { task: h.second, agent: 'codex', account: 'acc1', worktree: 'current' }, caller)
      expect(w.status).toBe(409)
      expect(w.body).toMatchObject({ held: true })
    }
    const d = await call(h.deps, 'tasks-dispatch', { id: h.second })
    expect(d.status).toBe(409)
    expect(open(h.deps.getState())).toHaveLength(1)
  })

  it('is refused from an agent session and an MCP client', async () => {
    const h = await withWorker()
    expect((await call(h.deps, 'jobs-hold', { id: h.jobId }, AGENT)).status).toBe(403)
    expect((await call(h.deps, 'jobs-hold', { id: h.jobId }, { sessionId: '', role: 'mcp' })).status).toBe(403)
    expect((await call(h.deps, 'jobs-hold', { id: 'nope' })).status).toBe(404)
    expect(h.deps.getState().jobs[0].dispatchHold).toBeUndefined()
  })
})

describe('the Host gates', () => {
  it.each(['worker-hold', 'worker-unhold', 'jobs-hold', 'jobs-unhold'])('%s is closed to MCP clients and remote controllers', (cmd) => {
    expect(mcpRefusal(cmd, 'control', true, true)?.status).toBe(403)
    expect(controllerRefusal(cmd, { name: 'c', permission: 'full-control' } as never)?.status).toBe(403)
  })
})

describe('holdOf: who holds a plan from launching', () => {
  const job: Job = { id: 'j', objective: 'o', cwd: '/p', createdAt: NOW }
  const mark = { runId: 'r1', wave: 1, done: 0, startedAt: NOW }
  const lastReplan = { ...mark, mode: 'completion' as const, at: NOW, summary: 's' }

  it('none', () => {
    expect(holdOf(job)).toBeUndefined()
    // a scoped replan holds only the Tasks it can affect, not the plan
    expect(holdOf({ ...job, replanning: { ...mark, mode: 'wave', scoped: true } as Job['replanning'] })).toBeUndefined()
    expect(holdOf({ ...job, lastReplan: { ...lastReplan, escalated: 'x' } })).toBeUndefined()
  })

  it('the owner', () => {
    expect(holdOf({ ...job, dispatchHold: true })).toBe('owner')
    expect(holdOf({ ...job, dispatchHold: true, lastReplan })).toBe('owner')
    expect(holdOf({ ...job, dispatchHold: true, replanning: { ...mark, mode: 'wave', scoped: true } as Job['replanning'] })).toBe('owner')
  })

  it('a replan, the final check, and a replan question', () => {
    expect(holdOf({ ...job, dispatchHold: true, replanning: { ...mark, mode: 'wave' } })).toBe('replanning')
    expect(holdOf({ ...job, dispatchHold: true, replanning: { ...mark, mode: 'completion' } })).toBe('final-check')
    // the owner's feedback or chat on a finished plan is a replan, not the final check
    expect(holdOf({ ...job, dispatchHold: true, replanning: { ...mark, mode: 'completion', feedbackAt: NOW } })).toBe('replanning')
    expect(holdOf({ ...job, dispatchHold: true, replanning: { ...mark, mode: 'completion', chat: true } })).toBe('replanning')
    expect(holdOf({ ...job, dispatchHold: true, lastReplan: { ...lastReplan, escalated: 'x' } })).toBe('replan-question')
  })
})
