import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startWorkerWithChain, startCoordinatorSession, preTrustWorkspace, type WorkerStartContext } from './workerStart'
import { WorkerTails, TAIL_EMPTY } from './tail'
import { createJob, createTask, emptyState, startJobRun, type OrchState } from '../state'
import { makeDescriptors } from '../../providers/descriptor'
import type { Account } from '../../types'
import type { Dispatch } from '../types'

const NOW = '2026-09-24T00:00:00.000Z'
const acct = (id: string, provider: 'claude' | 'codex' = 'claude'): Account =>
  ({ id, label: id, configDir: `D:/cfg/${id}`, color: '#888', createdAt: NOW, provider })
const stateWithTask = (accountIds?: string[]): { s: OrchState; taskId: string } => {
  const job = createJob(emptyState(), { objective: 'o', cwd: 'D:/p' }, NOW); if (!job.ok) throw new Error(job.error)
  const run = startJobRun(job.state, job.value.id, NOW); if (!run.ok) throw new Error(run.error)
  const t = createTask(run.state, { runId: run.value.id, title: 't', spec: 's', deps: [], ...(accountIds ? { accountIds } : {}) }, NOW)
  if (!t.ok) throw new Error(t.error)
  return { s: t.state, taskId: t.value.id }
}
const args = (taskId: string, accountId = 'a1') => ({
  dispatchId: 'dsp_1', taskId, title: 't', spec: 's', provider: 'claude' as const, accountId, runCwd: 'D:/p', worktree: 'current'
})

describe('startWorkerWithChain', () => {
  // Property 4 of the convergence design, formerly a source-text guard over ipc.ts (R11).
  it('hands the coordinator the chain rollChainFor built from the Task\'s own accounts', async () => {
    const { s, taskId } = stateWithTask(['a1', 'a2'])
    const startWorker = vi.fn().mockResolvedValue({ sessionId: 'ses_1', cwd: 'D:/p', specPath: 'D:/s.md' })
    await startWorkerWithChain({
      getState: () => s, accounts: async () => [acct('a1'), acct('a2')], loginStatus: async () => true,
      coordinator: { startWorker }, tails: new WorkerTails(), log: () => {}, roleModels: async () => ({})
    }, args(taskId))
    expect(startWorker.mock.calls[0][0].rollAccountIds).toEqual(['a1', 'a2'])
    expect(startWorker.mock.calls[0][0].dispatchId).toBe('dsp_1')
  })

  it('asks no login status when the Task names no accounts, and the chain is the one account', async () => {
    const { s, taskId } = stateWithTask()
    const loginStatus = vi.fn()
    const startWorker = vi.fn().mockResolvedValue({ sessionId: 'ses_1', cwd: 'D:/p', specPath: 'D:/s.md' })
    await startWorkerWithChain({ getState: () => s, accounts: async () => [acct('a1')], loginStatus, coordinator: { startWorker }, tails: new WorkerTails(), log: () => {}, roleModels: async () => ({}) }, args(taskId))
    expect(loginStatus).not.toHaveBeenCalled()
    expect(startWorker.mock.calls[0][0].rollAccountIds).toEqual(['a1'])
  })

  it('falls back to the one account and says so when the login lookup throws', async () => {
    const { s, taskId } = stateWithTask(['a1', 'a2'])
    const logs: string[] = []
    const startWorker = vi.fn().mockResolvedValue({ sessionId: 'ses_1', cwd: 'D:/p', specPath: 'D:/s.md' })
    await startWorkerWithChain({ getState: () => s, accounts: async () => [acct('a1'), acct('a2')], loginStatus: async () => { throw new Error('keychain') }, coordinator: { startWorker }, tails: new WorkerTails(), log: (m) => logs.push(m), roleModels: async () => ({}) }, args(taskId))
    expect(startWorker.mock.calls[0][0].rollAccountIds).toEqual(['a1'])
    expect(logs.join('\n')).toMatch(/could not read login status/)
  })

  it('starts the tail for the dispatch on the session the coordinator returned', async () => {
    const { s, taskId } = stateWithTask()
    const tails = new WorkerTails()
    await startWorkerWithChain({ getState: () => s, accounts: async () => [acct('a1')], loginStatus: async () => true,
      coordinator: { startWorker: vi.fn().mockResolvedValue({ sessionId: 'ses_9', cwd: 'D:/p', specPath: 'D:/s.md' }) }, tails, log: () => {}, roleModels: async () => ({}) }, args(taskId))
    expect(tails.read('dsp_1')).toBe(TAIL_EMPTY)
    tails.push('ses_9', 'hello\n')
    expect(tails.read('dsp_1')).toBe('hello')
  })
})

describe('startWorkerWithChain — #117 hands-off', () => {
  const start = async (s: OrchState, taskId: string) => {
    const startWorker = vi.fn().mockResolvedValue({ sessionId: 'ses_1', cwd: 'D:/p', specPath: 'D:/s.md' })
    await startWorkerWithChain({ getState: () => s, accounts: async () => [acct('a1')], loginStatus: async () => true, coordinator: { startWorker }, tails: new WorkerTails(), log: () => {}, roleModels: async () => ({}) }, args(taskId))
    return startWorker.mock.calls[0][0]
  }
  it("a hands-off Job's worker starts with the bypass; another Job's leaves it to the app-wide setting", async () => {
    const { s, taskId } = stateWithTask()
    expect((await start(s, taskId)).bypassPermissions).toBeUndefined()
    const handsOff = { ...s, jobs: s.jobs.map((j) => ({ ...j, handsOff: true })) }
    expect((await start(handsOff, taskId)).bypassPermissions).toBe(true)
  })
})

describe('startWorkerWithChain — role models (W1-A)', () => {
  const started = { sessionId: 'ses_1', cwd: 'D:/p', specPath: 'D:/s.md' }
  const withTask = (s: OrchState, taskId: string, patch: object): OrchState =>
    ({ ...s, tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) })
  const dispatch = (taskId: string, over: Partial<Dispatch>): Dispatch => ({ ...({
    id: 'dsp_impl', taskId, provider: 'claude', accountId: 'a1', sessionId: 'ses_impl', cwd: 'D:/p', specPath: '',
    startedAt: NOW, workerState: 'ready' } as Dispatch), ...over
  })
  const ctxFor = (s: OrchState, startWorker: ReturnType<typeof vi.fn>, accounts = [acct('a1')], logs: string[] = []): WorkerStartContext => ({
    getState: () => s, accounts: async () => accounts, loginStatus: async () => true,
    coordinator: { startWorker } as unknown as WorkerStartContext['coordinator'], tails: new WorkerTails(),
    log: (m: string) => void logs.push(m), roleModels: async () => ({})
  })

  it('starts a worker on its difficulty\'s model and hands the model back for the Dispatch', async () => {
    const { s, taskId } = stateWithTask()
    const startWorker = vi.fn().mockResolvedValue(started)
    const r = await startWorkerWithChain(ctxFor(withTask(s, taskId, { difficulty: 'hard' }), startWorker), args(taskId))
    expect(startWorker.mock.calls[0][0].model).toBe('opus')
    expect(r).toMatchObject({ ...started, model: 'opus' })
  })

  it('passes no model when nothing is configured for a worker (the CLI default, as before)', async () => {
    const { s, taskId } = stateWithTask()
    const startWorker = vi.fn().mockResolvedValue(started)
    const r = await startWorkerWithChain(ctxFor(s, startWorker), args(taskId))
    expect(startWorker.mock.calls[0][0]).not.toHaveProperty('model')
    expect(r).not.toHaveProperty('model')
  })

  it('a Job override reaches the worker when the Task has no difficulty', async () => {
    const { s, taskId } = stateWithTask()
    const s2 = { ...s, jobs: s.jobs.map((j) => ({ ...j, models: { worker: 'sonnet' } })) }
    const startWorker = vi.fn().mockResolvedValue(started)
    await startWorkerWithChain(ctxFor(s2, startWorker), args(taskId))
    expect(startWorker.mock.calls[0][0].model).toBe('sonnet')
  })

  it('records why a Task that asked for codex ran on claude', async () => {
    const { s, taskId } = stateWithTask()
    const logs: string[] = []
    const startWorker = vi.fn().mockResolvedValue(started)
    const r = await startWorkerWithChain(ctxFor(withTask(s, taskId, { provider: 'codex', model: 'gpt-5.5' }), startWorker, [acct('a1')], logs), args(taskId))
    expect(startWorker.mock.calls[0][0]).not.toHaveProperty('model')
    expect(r.modelNote).toMatch(/codex, which has no account/)
    expect(logs.join('\n')).toMatch(/dsp_1: task asked for codex/)
  })

  it('a same-provider reviewer never runs on the implementer\'s model', async () => {
    const { s, taskId } = stateWithTask()
    const s2 = { ...s, dispatches: [dispatch(taskId, { model: 'opus' }), dispatch(taskId, { id: 'dsp_1', review: true, sessionId: 'pending:x' })] }
    const startWorker = vi.fn().mockResolvedValue(started)
    const r = await startWorkerWithChain(ctxFor(s2, startWorker), args(taskId))
    expect(startWorker.mock.calls[0][0].model).toBe('sonnet')
    expect(r.modelNote).toMatch(/same-provider review/)
  })

  it('a cross-provider reviewer runs on the reviewer model', async () => {
    const { s, taskId } = stateWithTask()
    const s2 = { ...s, dispatches: [dispatch(taskId, { provider: 'codex', accountId: 'x1', model: 'gpt-5.5' }), dispatch(taskId, { id: 'dsp_1', review: true, sessionId: 'pending:x' })] }
    const startWorker = vi.fn().mockResolvedValue(started)
    const r = await startWorkerWithChain(ctxFor(s2, startWorker, [acct('a1'), acct('x1', 'codex')]), args(taskId))
    expect(startWorker.mock.calls[0][0].model).toBe('opus')
    expect(r).not.toHaveProperty('modelNote')
  })

  it('a --terminal reuse reports the model the reused session runs on', async () => {
    const { s, taskId } = stateWithTask()
    const s2 = { ...s, dispatches: [dispatch(taskId, { sessionId: 'ses_old', model: 'haiku', endedAt: NOW }), dispatch(taskId, { id: 'dsp_1', sessionId: 'ses_old' })] }
    const startWorker = vi.fn().mockResolvedValue(started)
    const r = await startWorkerWithChain(ctxFor(withTask(s2, taskId, { difficulty: 'hard' }), startWorker), { ...args(taskId), terminal: 'ses_old' })
    expect(r.model).toBe('haiku')
  })

  it('a settings read that throws falls back to the built-in defaults', async () => {
    const { s, taskId } = stateWithTask()
    const startWorker = vi.fn().mockResolvedValue(started)
    const logs: string[] = []
    const ctx = { ...ctxFor(withTask(s, taskId, { difficulty: 'light' }), startWorker, [acct('a1')], logs), roleModels: async () => { throw new Error('broken') } }
    await startWorkerWithChain(ctx, args(taskId))
    expect(startWorker.mock.calls[0][0].model).toBe('haiku')
    expect(logs.join('\n')).toMatch(/settings unreadable/)
  })
})

describe('startCoordinatorSession', () => {
  let dir: string
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-coord-')) })
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })
  it('writes the brief, pre-trusts, and spawns with a one-account chain and the Run title', async () => {
    const spawn = vi.fn().mockResolvedValue({ id: 'ses_c' })
    const preTrust = vi.fn().mockResolvedValue(undefined)
    const r = await startCoordinatorSession({ specsDir: dir, preTrust, bypassPermissions: async () => true, spawn, log: () => {}, getState: emptyState, accounts: async () => [acct('a1')], roleModels: async () => ({}) },
      { runId: 'run_abcdefghijklmnop', cwd: 'D:/p', accountId: 'a1', brief: 'BRIEF' })
    expect(r).toEqual({ sessionId: 'ses_c', model: 'haiku' })
    expect(await fs.readFile(path.join(dir, 'coordinator-run_abcdefghijklmnop.md'), 'utf8')).toBe('BRIEF')
    expect(preTrust).toHaveBeenCalledWith('a1', 'D:/p')
    expect(spawn.mock.calls[0][0]).toMatchObject({ accountId: 'a1', cwd: 'D:/p', bypassPermissions: true, rollAccountIds: ['a1'], title: 'Coordinator · run_abcdefgh' })
  })
  it('starts the coordinator on the coordinator role model, the Job override first (W1-A)', async () => {
    const spawn = vi.fn().mockResolvedValue({ id: 'ses_c' })
    const base = { specsDir: dir, preTrust: vi.fn().mockResolvedValue(undefined), bypassPermissions: async () => false, spawn, log: () => {}, accounts: async () => [acct('a1')], roleModels: async () => ({}) }
    const { s } = stateWithTask()
    const runId = s.runs[0].id
    await startCoordinatorSession({ ...base, getState: () => s }, { runId, cwd: 'D:/p', accountId: 'a1', brief: 'B' })
    expect(spawn.mock.calls[0][0].model).toBe('haiku')
    const s2 = { ...s, jobs: s.jobs.map((j) => ({ ...j, models: { coordinator: 'sonnet' } })) }
    await startCoordinatorSession({ ...base, getState: () => s2 }, { runId, cwd: 'D:/p', accountId: 'a1', brief: 'B' })
    expect(spawn.mock.calls[1][0].model).toBe('sonnet')
  })
  it('T5: a plan of more than 5 Tasks or a hard one gets the strong model, the project override first, and returns it', async () => {
    const spawn = vi.fn().mockResolvedValue({ id: 'ses_c' })
    const ctx = { specsDir: dir, preTrust: vi.fn().mockResolvedValue(undefined), bypassPermissions: async () => false, spawn, log: () => {}, accounts: async () => [acct('a1')], roleModels: async () => ({}) }
    const { s, taskId } = stateWithTask()
    const runId = s.runs[0].id
    const start = (st: typeof s) => startCoordinatorSession({ ...ctx, getState: () => st }, { runId, cwd: 'D:/p', accountId: 'a1', brief: 'B' })
    const hard = { ...s, tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, difficulty: 'hard' as const } : t)) }
    expect(await start(hard)).toEqual({ sessionId: 'ses_c', model: 'opus' })
    const many = { ...s, tasks: Array.from({ length: 6 }, (_, i) => ({ ...s.tasks[0], id: `t${i}` })) }
    expect((await start(many)).model).toBe('opus')
    const project = { id: 'prj_1', path: 'D:/p', name: 'p', addedAt: NOW, coordinatorModel: 'sonnet' }
    const owned = { ...hard, projects: [project], jobs: hard.jobs.map((j) => ({ ...j, projectId: 'prj_1' })) }
    expect((await start(owned)).model).toBe('sonnet')
    expect((await start(s)).model).toBe('haiku')
  })
  it("#117: a hands-off Job's coordinator starts with the bypass even when the app-wide setting is off", async () => {
    const spawn = vi.fn().mockResolvedValue({ id: 'ses_c' })
    const { s } = stateWithTask()
    const handsOff = { ...s, jobs: s.jobs.map((j) => ({ ...j, handsOff: true })) }
    const ctx = { specsDir: dir, preTrust: vi.fn().mockResolvedValue(undefined), bypassPermissions: async () => false, spawn, log: () => {}, accounts: async () => [acct('a1')], roleModels: async () => ({}) }
    await startCoordinatorSession({ ...ctx, getState: () => s }, { runId: s.runs[0].id, cwd: 'D:/p', accountId: 'a1', brief: 'B' })
    await startCoordinatorSession({ ...ctx, getState: () => handsOff }, { runId: s.runs[0].id, cwd: 'D:/p', accountId: 'a1', brief: 'B' })
    expect(spawn.mock.calls.map((c) => c[0].bypassPermissions)).toEqual([false, true])
  })
})

describe('preTrustWorkspace', () => {
  let dir: string
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-trust-')) })
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })
  it('marks a claude project trusted in the account\'s own .claude.json when the account is not ambient', async () => {
    const account: Account = { id: 'a1', label: 'a', configDir: path.join(dir, 'cfg'), color: '#888', createdAt: NOW, provider: 'claude' }
    await fs.mkdir(account.configDir, { recursive: true })
    await preTrustWorkspace({ account, cwd: path.join(dir, 'work'), homeDir: path.join(dir, 'home'), descriptors: makeDescriptors(process.platform), log: () => {} })
    expect(await fs.readFile(path.join(account.configDir, '.claude.json'), 'utf8')).toMatch(/hasTrustDialogAccepted/)
  })
  it('does nothing for an unknown account', async () => {
    await expect(preTrustWorkspace({ account: undefined, cwd: dir, homeDir: dir, descriptors: makeDescriptors(process.platform), log: () => {} })).resolves.toBeUndefined()
  })
})

// T2: "Pick accounts automatically" on the start paths.
describe('automatic accounts (T2)', () => {
  const LATER = '2099-01-01T00:00:00.000Z'
  const pauseA = { accountId: 'a1', window: 'five_hour' as const, percent: 95, resetsAt: LATER }
  const guard = (on: boolean, overA1 = true) => ({
    refresh: vi.fn().mockResolvedValue(undefined),
    pauseOf: (id: string) => (overA1 && id === 'a1' ? pauseA : null),
    view: () => [
      { accountId: 'a1', session: { usedPercent: overA1 ? 95 : 5, resetsAt: LATER }, weekly: { usedPercent: 0, resetsAt: LATER }, paused: overA1 ? pauseA : null },
      { accountId: 'a2', session: { usedPercent: 60, resetsAt: LATER }, weekly: { usedPercent: 0, resetsAt: LATER }, paused: null },
      { accountId: 'a3', session: { usedPercent: 10, resetsAt: LATER }, weekly: { usedPercent: 0, resetsAt: LATER }, paused: null }
    ],
    pauseAt: () => 90,
    autoAccounts: () => on
  })
  const accounts = [acct('a1'), acct('a2'), acct('a3'), acct('x', 'codex')]
  let dir: string
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-auto-')) })
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })
  const coordCtx = (g: ReturnType<typeof guard>, spawn = vi.fn().mockResolvedValue({ id: 'ses_c' })) => ({
    specsDir: dir, preTrust: vi.fn().mockResolvedValue(undefined), bypassPermissions: async () => false, spawn, log: () => {},
    getState: emptyState, accounts: async () => accounts, roleModels: async () => ({}), usageGuard: g, loginStatus: async () => true
  })

  it('a coordinator named on an over-threshold account starts on the least used one and gets the whole chain', async () => {
    const ctx = coordCtx(guard(true))
    await startCoordinatorSession(ctx, { runId: 'run_x', cwd: 'D:/p', accountId: 'a1', brief: 'B' })
    expect(ctx.spawn.mock.calls[0][0]).toMatchObject({ accountId: 'a3', rollAccountIds: ['a3', 'a2', 'a1'] })
    expect(ctx.preTrust).toHaveBeenCalledWith('a3', 'D:/p')
  })

  it('a coordinator on an account with room keeps it, with the rest least used first behind it', async () => {
    const ctx = coordCtx(guard(true, false))
    await startCoordinatorSession(ctx, { runId: 'run_x', cwd: 'D:/p', accountId: 'a2', brief: 'B' })
    expect(ctx.spawn.mock.calls[0][0]).toMatchObject({ accountId: 'a2', rollAccountIds: ['a2', 'a1', 'a3'] })
  })

  it('a planner does the same', async () => {
    const ctx = coordCtx(guard(true))
    await startCoordinatorSession(ctx, { runId: 'job_x', cwd: 'D:/p', accountId: 'a1', brief: 'B', role: 'planner' })
    expect(ctx.spawn.mock.calls[0][0]).toMatchObject({ accountId: 'a3', rollAccountIds: ['a3', 'a2', 'a1'] })
  })

  it('setting off: the named account alone, as before', async () => {
    const ctx = coordCtx(guard(false))
    await startCoordinatorSession(ctx, { runId: 'run_x', cwd: 'D:/p', accountId: 'a1', brief: 'B' })
    expect(ctx.spawn.mock.calls[0][0]).toMatchObject({ accountId: 'a1', rollAccountIds: ['a1'] })
  })

  it("a worker's rolling chain gets the provider's other accounts, the Task's spent one last", async () => {
    const { s, taskId } = stateWithTask(['a1'])
    const startWorker = vi.fn().mockResolvedValue({ sessionId: 'ses_1', cwd: 'D:/p', specPath: 'D:/s.md' })
    await startWorkerWithChain({
      getState: () => s, accounts: async () => accounts, loginStatus: async () => true,
      coordinator: { startWorker }, tails: new WorkerTails(), log: () => {}, roleModels: async () => ({}), usageGuard: guard(true)
    }, args(taskId, 'a3'))
    expect(startWorker.mock.calls[0][0].rollAccountIds).toEqual(['a3', 'a2', 'a1'])
  })
})
