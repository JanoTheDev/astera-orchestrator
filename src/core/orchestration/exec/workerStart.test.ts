import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startWorkerWithChain, startCoordinatorSession, preTrustWorkspace, chooseStartAccount, chooseSessionStart, chooseResumeStart, autoStartChain, START_READ_WAIT_MS, type AutoStartGuard, type WorkerStartContext } from './workerStart'
import { createUsageGuard, type UsageChange } from '../usageGuard'
import { WorkerTails, TAIL_EMPTY } from './tail'
import { editPlanTask } from '../planner'
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

describe('startWorkerWithChain — effort', () => {
  const started = { sessionId: 'ses_1', cwd: 'D:/p', specPath: 'D:/s.md' }
  const ALL = ['low', 'medium', 'high', 'xhigh', 'max']
  const withTask = (s: OrchState, taskId: string, patch: object): OrchState =>
    ({ ...s, tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) })
  const dispatch = (taskId: string, over: Partial<Dispatch>): Dispatch => ({ ...({
    id: 'dsp_prev', taskId, provider: 'claude', accountId: 'a1', sessionId: 'ses_prev', cwd: 'D:/p', specPath: '',
    startedAt: '2026-09-23T00:00:00.000Z', workerState: 'ready' } as Dispatch), ...over
  })
  const ctxFor = (s: OrchState, startWorker: ReturnType<typeof vi.fn>, levels?: (model: string | undefined) => string[] | undefined, accounts = [acct('a1')]): WorkerStartContext => ({
    getState: () => s, accounts: async () => accounts, loginStatus: async () => true,
    coordinator: { startWorker } as unknown as WorkerStartContext['coordinator'], tails: new WorkerTails(),
    log: () => {}, roleModels: async () => ({}),
    ...(levels ? { effortLevels: async (_a: string, m: string | undefined) => levels(m) } : {})
  })
  const start = async (s: OrchState, taskId: string, levels?: (m: string | undefined) => string[] | undefined, over: object = {}, accounts?: Account[]) => {
    const startWorker = vi.fn().mockResolvedValue(started)
    const r = await startWorkerWithChain(ctxFor(s, startWorker, levels, accounts), { ...args(taskId), ...over })
    return { passed: startWorker.mock.calls[0][0] as { effort?: string }, r }
  }

  it("a claude worker's difficulty effort reaches the spawn and the Dispatch", async () => {
    const { s, taskId } = stateWithTask()
    const { passed, r } = await start(withTask(s, taskId, { difficulty: 'hard' }), taskId, () => ALL)
    expect(passed.effort).toBe('high')
    expect(r).toMatchObject({ effort: 'high' })
    expect(r).not.toHaveProperty('effortNote')
  })

  it("a codex worker's Task effort reaches the spawn", async () => {
    const { s, taskId } = stateWithTask()
    const { passed } = await start(withTask(s, taskId, { effort: 'medium' }), taskId, () => ['low', 'medium', 'high', 'xhigh'], { provider: 'codex', accountId: 'x1' }, [acct('x1', 'codex')])
    expect(passed.effort).toBe('medium')
  })

  it("a Task effort above the model's max is clamped and noted", async () => {
    const { s, taskId } = stateWithTask()
    const { passed, r } = await start(withTask(s, taskId, { effort: 'max' }), taskId, () => ['low', 'medium', 'high'])
    expect(passed.effort).toBe('high')
    expect(r.effortNote).toMatch(/not listed/)
  })

  it('a model with no levels gets no flag; unknown levels get no flag and a note', async () => {
    const { s, taskId } = stateWithTask()
    const s2 = withTask(s, taskId, { effort: 'high' })
    const none = await start(s2, taskId, () => [])
    expect(none.passed).not.toHaveProperty('effort')
    expect(none.r).not.toHaveProperty('effortNote')
    const unknown = await start(s2, taskId)
    expect(unknown.passed).not.toHaveProperty('effort')
    expect(unknown.r.effortNote).toMatch(/unknown/)
  })

  it('a retry after a failed attempt does not raise on its own: it runs the effort its Task carries', async () => {
    const { s, taskId } = stateWithTask()
    const failedBefore = [dispatch(taskId, { effort: 'high', outcome: 'failed', endedAt: NOW }), dispatch(taskId, { id: 'dsp_1', startedAt: NOW, sessionId: 'pending:x' })]
    const plain = await start({ ...withTask(s, taskId, { difficulty: 'standard' }), dispatches: failedBefore }, taskId, () => ALL)
    expect(plain.passed.effort).toBe('medium')
    expect(plain.r).not.toHaveProperty('effortNote')
    const raised = await start({ ...withTask(s, taskId, { difficulty: 'standard', effort: 'xhigh' }), dispatches: failedBefore }, taskId, () => ALL)
    expect(raised.passed.effort).toBe('xhigh')
  })

  it('a retry after a succeeded attempt keeps the resolved effort', async () => {
    const { s, taskId } = stateWithTask()
    const s2 = { ...withTask(s, taskId, { difficulty: 'standard' }), dispatches: [dispatch(taskId, { effort: 'high', outcome: 'succeeded', endedAt: NOW }), dispatch(taskId, { id: 'dsp_1', startedAt: NOW, sessionId: 'pending:x' })] }
    expect((await start(s2, taskId, () => ALL)).passed.effort).toBe('medium')
  })

  it("a fresh repair runs its Task's effort, clamped to the model's max", async () => {
    const { s, taskId } = stateWithTask()
    const s2 = { ...withTask(s, taskId, { difficulty: 'light' }), dispatches: [dispatch(taskId, { outcome: 'succeeded', endedAt: NOW }), dispatch(taskId, { id: 'dsp_1', startedAt: NOW, sessionId: 'pending:x', repair: 'check-failure' })] }
    expect((await start(s2, taskId, () => ALL)).passed.effort).toBe('low')
    const r = await start(withTask(s2, taskId, { effort: 'max' }), taskId, () => ['low', 'medium', 'high'])
    expect(r.passed.effort).toBe('high')
    expect(r.r.effortNote).toMatch(/not listed/)
  })

  it('a repair typed into the live session keeps its effort and notes a raise it cannot take', async () => {
    const { s, taskId } = stateWithTask()
    const s2 = { ...withTask(s, taskId, { effort: 'high' }), dispatches: [dispatch(taskId, { sessionId: 'ses_old', effort: 'medium', endedAt: NOW }), dispatch(taskId, { id: 'dsp_1', startedAt: NOW, sessionId: 'ses_old', repair: 'review-failure' })] }
    const { r } = await start(s2, taskId, () => ALL, { terminal: 'ses_old' })
    expect(r).toMatchObject({ effort: 'medium', effortNote: expect.stringMatching(/next fresh start/) })
    const same = await start(withTask(s2, taskId, { effort: 'medium' }), taskId, () => ALL, { terminal: 'ses_old' })
    expect(same.r).not.toHaveProperty('effortNote')
  })

  it('a Task updated after its first attempt starts its next fresh dispatch on the new model and effort', async () => {
    const { s, taskId } = stateWithTask()
    const first = dispatch(taskId, { outcome: 'succeeded', endedAt: NOW, effort: 'low', model: 'sonnet' })
    const started1 = { ...withTask(s, taskId, { status: 'dispatched', model: 'sonnet', effort: 'low' }), dispatches: [first] }
    const edited = editPlanTask(started1, taskId, { model: 'opus', effort: 'high' }, NOW, true)
    if (!edited.ok) throw new Error(edited.error)
    const s2 = { ...edited.state, dispatches: [first, dispatch(taskId, { id: 'dsp_1', startedAt: NOW, sessionId: 'pending:x' })] }
    const { passed, r } = await start(s2, taskId, () => ALL)
    expect(passed).toMatchObject({ model: 'opus', effort: 'high' })
    expect(r).toMatchObject({ model: 'opus', effort: 'high' })
  })

  it('a reviewer gets the reviewer role effort, never raised', async () => {
    const { s, taskId } = stateWithTask()
    const s2 = { ...s, dispatches: [dispatch(taskId, { provider: 'codex', accountId: 'x1', outcome: 'failed', effort: 'low' }), dispatch(taskId, { id: 'dsp_1', startedAt: NOW, review: true, sessionId: 'pending:x' })] }
    expect((await start(s2, taskId, () => ALL, {}, [acct('a1'), acct('x1', 'codex')])).passed.effort).toBe('high')
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
    expect(r).toEqual({ sessionId: 'ses_c', accountId: 'a1', model: 'haiku' })
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
  it('starts the coordinator on its role effort, clamped to the model levels', async () => {
    const spawn = vi.fn().mockResolvedValue({ id: 'ses_c' })
    const ctx = { specsDir: dir, preTrust: vi.fn().mockResolvedValue(undefined), bypassPermissions: async () => false, spawn, log: () => {}, accounts: async () => [acct('a1')], roleModels: async () => ({}), getState: emptyState }
    await startCoordinatorSession({ ...ctx, effortLevels: async () => ['low', 'medium', 'high'] }, { runId: 'run_x', cwd: 'D:/p', accountId: 'a1', brief: 'B' })
    expect(spawn.mock.calls[0][0].effort).toBe('low')
    await startCoordinatorSession({ ...ctx, effortLevels: async () => [] }, { runId: 'run_x', cwd: 'D:/p', accountId: 'a1', brief: 'B' })
    expect(spawn.mock.calls[1][0]).not.toHaveProperty('effort')
  })
  it('T5: a plan of more than 5 Tasks or a hard one gets the strong model, the project override first, and returns it', async () => {
    const spawn = vi.fn().mockResolvedValue({ id: 'ses_c' })
    const ctx = { specsDir: dir, preTrust: vi.fn().mockResolvedValue(undefined), bypassPermissions: async () => false, spawn, log: () => {}, accounts: async () => [acct('a1')], roleModels: async () => ({}) }
    const { s, taskId } = stateWithTask()
    const runId = s.runs[0].id
    const start = (st: typeof s) => startCoordinatorSession({ ...ctx, getState: () => st }, { runId, cwd: 'D:/p', accountId: 'a1', brief: 'B' })
    const hard = { ...s, tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, difficulty: 'hard' as const } : t)) }
    expect(await start(hard)).toEqual({ sessionId: 'ses_c', accountId: 'a1', model: 'opus' })
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

// T5b (decision 6, 21): every start takes an account with room; the named one is only a preference.
describe('chooseStartAccount (T5b)', () => {
  const LATER = '2099-01-01T00:00:00.000Z'
  const win = (usedPercent: number) => ({ usedPercent, resetsAt: LATER })
  const four = [acct('a1'), acct('a2'), acct('a3'), acct('a4')]
  /** The real guard, as the Host and the app build it: readings per account, live sessions, caps. */
  const realGuard = (o: {
    readings: Record<string, [weekly: number, session: number]>
    sessions?: string[]
    caps?: Record<string, number>
    onChange?: (e: UsageChange) => void
  }) =>
    createUsageGuard({
      readings: async () => new Map(Object.entries(o.readings).map(([id, [w, s]]) => [id, { weekly: win(w), session: win(s) }])),
      pauseAt: async () => 90,
      autoAccounts: async () => true,
      sessions: () => (o.sessions ?? []).map((accountId) => ({ accountId })),
      maxSessions: async () => o.caps ?? {},
      nowMs: () => Date.parse(NOW),
      ...(o.onChange ? { onChange: o.onChange } : {})
    })
  const ctxOf = (usageGuard: AutoStartGuard, accounts = four, logs: string[] = []) => ({
    usageGuard,
    loginStatus: async () => true,
    accounts: async () => accounts,
    log: (m: string) => logs.push(m)
  })
  const allEmpty = { a1: [10, 10], a2: [10, 10], a3: [10, 10], a4: [10, 10] } as Record<string, [number, number]>

  it('a burst of 10 worker starts over 4 usable accounts lands 2-3 per account, counted before the sessions exist', async () => {
    const g = realGuard({ readings: allEmpty })
    const picks = await Promise.all(Array.from({ length: 10 }, () => chooseStartAccount(ctxOf(g), { provider: 'claude', purpose: 'worker' })))
    const per = new Map<string, number>()
    for (const p of picks) if (p.ok) per.set(p.accountId, (per.get(p.accountId) ?? 0) + 1)
    expect([...per.values()].reduce((a, b) => a + b, 0)).toBe(10)
    expect(per.size).toBe(4)
    for (const n of per.values()) expect(n === 2 || n === 3).toBe(true)
    // the count lets go once the session runs (or failed)
    for (const p of picks) if (p.ok) p.release()
    expect([...g.liveSessions!().values()].reduce((a, b) => a + b, 0)).toBe(0)
  })

  it('honours the per-account maxSessions cap from settings', async () => {
    const g = realGuard({ readings: allEmpty, sessions: ['a1'], caps: { a1: 1 } })
    const p = await chooseStartAccount(ctxOf(g), { preferred: 'a1', purpose: 'worker' })
    expect(p).toMatchObject({ ok: true })
    expect(p.ok && p.accountId).not.toBe('a1')
  })

  it('a preferred account at weekly 100% starts a planner elsewhere and tells account.switched', async () => {
    const changes: UsageChange[] = []
    const g = realGuard({ readings: { ...allEmpty, a1: [100, 5] }, onChange: (e) => changes.push(e) })
    const spawn = vi.fn().mockResolvedValue({ id: 'ses_p' })
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-t5b-'))
    try {
      const r = await startCoordinatorSession(
        { ...ctxOf(g), specsDir: dir, preTrust: async () => {}, bypassPermissions: async () => false, spawn, getState: emptyState, roleModels: async () => ({}) },
        { runId: 'job_x', cwd: 'D:/p', accountId: 'a1', brief: 'B', role: 'planner' }
      )
      expect(r.accountId).not.toBe('a1')
      expect(spawn.mock.calls[0][0].accountId).toBe(r.accountId)
      expect(changes).toContainEqual(expect.objectContaining({ type: 'account.switched', from: 'a1', to: r.accountId }))
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('all accounts full: the start waits with a reason and never spawns', async () => {
    const g = realGuard({ readings: { a1: [100, 0], a2: [95, 0], a3: [0, 99], a4: [100, 100] } })
    expect(await chooseStartAccount(ctxOf(g), { preferred: 'a1', purpose: 'worker' })).toMatchObject({ ok: false, why: expect.stringMatching(/no claude account has room.*a1 \(its weekly limit/) })
    const spawn = vi.fn()
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-t5b-'))
    try {
      // T25: the start fails at once with the plain reason (the command records it and the loop asks again)
      await expect(
        startCoordinatorSession(
          { ...ctxOf(g), specsDir: dir, preTrust: async () => {}, bypassPermissions: async () => false, spawn, getState: emptyState, roleModels: async () => ({}) },
          { runId: 'run_x', cwd: 'D:/p', accountId: 'a1', brief: 'B' }
        )
      ).rejects.toThrow(/no claude account has room/)
      expect(spawn).not.toHaveBeenCalled()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('the app path (startCoordinatorSession with the app context) and the Host path (autoStartChain) choose the same on one fixture', async () => {
    const readings = { ...allEmpty, a1: [100, 5], a2: [50, 50], a3: [20, 30] } as Record<string, [number, number]>
    const host = await autoStartChain(ctxOf(realGuard({ readings })), 'a1')
    const spawn = vi.fn().mockResolvedValue({ id: 'ses_c' })
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-t5b-'))
    try {
      await startCoordinatorSession(
        { ...ctxOf(realGuard({ readings })), specsDir: dir, preTrust: async () => {}, bypassPermissions: async () => false, spawn, getState: emptyState, roleModels: async () => ({}) },
        { runId: 'run_x', cwd: 'D:/p', accountId: 'a1', brief: 'B' }
      )
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
    expect(host.accountId).toBe('a4')
    expect(spawn.mock.calls[0][0]).toMatchObject({ accountId: host.accountId, rollAccountIds: host.chain })
  })

  it('a start before the first usage read finishes waits for it (bounded), then ranks: never the named full account', async () => {
    vi.useFakeTimers()
    try {
      let readings = new Map<string, { weekly: ReturnType<typeof win>; session: ReturnType<typeof win> }>()
      let release!: () => void
      const g = createUsageGuard({
        readings: () => new Promise((r) => (release = () => r(readings))),
        pauseAt: async () => 90,
        autoAccounts: async () => true,
        nowMs: () => Date.parse(NOW)
      })
      // the first read lands within the wait: ranked on it
      readings = new Map([['a1', { weekly: win(100), session: win(0) }], ['a2', { weekly: win(5), session: win(5) }]])
      const pending = chooseStartAccount(ctxOf(g, [acct('a1'), acct('a2')]), { preferred: 'a1', purpose: 'planner' })
      await vi.advanceTimersByTimeAsync(1_000)
      release()
      expect(await pending).toMatchObject({ ok: true, accountId: 'a2' })
      // a read that never comes back: after START_READ_WAIT_MS it ranks on what the guard holds, and says so
      const stuck = createUsageGuard({ readings: () => new Promise(() => {}), pauseAt: async () => 90, autoAccounts: async () => true, nowMs: () => Date.parse(NOW) })
      const logs: string[] = []
      const late = chooseStartAccount(ctxOf(stuck as AutoStartGuard, [acct('a1')], logs), { preferred: 'a1', purpose: 'planner' })
      await vi.advanceTimersByTimeAsync(START_READ_WAIT_MS + 1)
      expect(await late).toMatchObject({ ok: true, accountId: 'a1' })
      expect(logs.join('\n')).toMatch(/no usage reading yet \(the read is still running\); ranking without one/)
    } finally {
      vi.useRealTimers()
    }
  })
  // T25: a planner or coordinator start with every account full is held with a plain reason, and starts once one has room
  describe('a start with every account full (T25)', () => {
    const FULL = { a1: [100, 0], a2: [95, 0], a3: [0, 99], a4: [100, 100] } as Record<string, [number, number]>
    let readings = FULL
    const guard = () =>
      createUsageGuard({
        readings: async () => new Map(Object.entries(readings).map(([id, [w, s]]) => [id, { weekly: win(w), session: win(s) }])),
        pauseAt: async () => 90,
        autoAccounts: async () => true,
        nowMs: () => Date.parse(NOW)
      })
    const start = async (o: { role?: 'planner'; state: OrchState; runId: string; waits: Array<string | null> }) => {
      const spawn = vi.fn().mockResolvedValue({ id: 'ses_h' })
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-t25-'))
      const run = () =>
        startCoordinatorSession(
          { ...ctxOf(guard()), specsDir: dir, preTrust: async () => {}, bypassPermissions: async () => false, spawn, getState: () => o.state, roleModels: async () => ({}) },
          { runId: o.runId, cwd: 'D:/p', accountId: 'a1', brief: 'B', onWait: (w) => void o.waits.push(w), ...(o.role ? { role: o.role } : {}) }
        )
      return { run, spawn, done: () => fs.rm(dir, { recursive: true, force: true }) }
    }
    beforeEach(() => { readings = FULL })

    it('a planner is held with the reason (accounts, which limit, earliest reset), then starts once an account frees up', async () => {
      const job = createJob(emptyState(), { objective: 'o', cwd: 'D:/p', pendingStart: true }, NOW); if (!job.ok) throw new Error(job.error)
      const waits: Array<string | null> = []
      const t = await start({ role: 'planner', state: job.state, runId: job.value.id, waits })
      try {
        await expect(t.run()).rejects.toThrow(/no claude account has room to start the planner/)
        expect(t.spawn).not.toHaveBeenCalled()
        expect(waits).toHaveLength(1)
        expect(waits[0]).toMatch(/start the planner on: .*a1 \(its weekly limit/)
        expect(waits[0]).toMatch(/a3 \(its 5-hour limit.*the earliest limit resets 2099-01-01T00:00:00.000Z/)
        readings = { ...FULL, a2: [10, 10] } // the next try (the loop's tick) reads a freed account
        expect(await t.run()).toMatchObject({ accountId: 'a2' })
        expect(waits.at(-1)).toBeNull()
        expect(t.spawn).toHaveBeenCalledTimes(1)
      } finally {
        await t.done()
      }
    })

    it('a coordinator is held the same way and starts once a reading frees an account', async () => {
      const { s } = stateWithTask()
      const waits: Array<string | null> = []
      const t = await start({ state: s, runId: s.runs[0].id, waits })
      try {
        await expect(t.run()).rejects.toThrow(/no claude account has room to start the coordinator/)
        expect(waits[0]).toMatch(/start the coordinator on/)
        readings = { ...FULL, a2: [10, 10] }
        expect(await t.run()).toMatchObject({ sessionId: 'ses_h' })
        expect(t.spawn.mock.calls[0][0].accountId).toBe('a2')
        expect(waits.at(-1)).toBeNull()
      } finally {
        await t.done()
      }
    })

    it('autoStartChain (Host sessions) still fails at once', async () => {
      await expect(autoStartChain(ctxOf(guard()), 'a1')).rejects.toThrow(/no claude account has room/)
    })
  })

  it('weekly is checked first: an account with 5h room but a full weekly window is never picked', async () => {
    const g = realGuard({ readings: { a1: [100, 0], a2: [100, 0] } })
    expect(await chooseStartAccount(ctxOf(g, [acct('a1'), acct('a2')]), { preferred: 'a1', purpose: 'planner' })).toMatchObject({ ok: false })
    const h = realGuard({ readings: { a1: [100, 0], a2: [60, 85] } })
    expect(await chooseStartAccount(ctxOf(h, [acct('a1'), acct('a2')]), { preferred: 'a1', purpose: 'planner' })).toMatchObject({ ok: true, accountId: 'a2' })
  })

  it('an empty usage window: an account last known not full goes before the named one nothing is known of', async () => {
    const OLD = Date.parse(NOW) - 60 * 60_000
    const g = createUsageGuard({
      readings: async () => new Map([['a2', { weekly: win(20), session: win(10), at: OLD }], ['a3', { weekly: win(5), session: win(5), at: OLD }]]),
      pauseAt: async () => 90,
      autoAccounts: async () => true,
      nowMs: () => Date.parse(NOW)
    })
    const accounts = [acct('a1'), acct('a2'), acct('a3')]
    expect(await chooseStartAccount(ctxOf(g, accounts), { preferred: 'a1', purpose: 'planner' })).toMatchObject({ ok: true, accountId: 'a3' })
    // nothing known at all: the named account starts
    const none = createUsageGuard({ readings: async () => new Map(), pauseAt: async () => 90, autoAccounts: async () => true, nowMs: () => Date.parse(NOW) })
    expect(await chooseStartAccount(ctxOf(none, accounts), { preferred: 'a1', purpose: 'planner' })).toMatchObject({ ok: true, accountId: 'a1' })
  })

  // T1: a plain session (New Session, Resume, Restart, Reopen, `sessions create`) takes the same choice
  describe('chooseSessionStart (T1)', () => {
    const off = () =>
      createUsageGuard({
        readings: async () => new Map(Object.entries({ a1: [100, 100], a2: [10, 10] } as Record<string, [number, number]>).map(([id, [w, s]]) => [id, { weekly: win(w), session: win(s) }])),
        pauseAt: async () => 90,
        autoAccounts: async () => false,
        nowMs: () => Date.parse(NOW)
      })

    it('no account named: the usable account rankAccounts puts first, rolling over the whole ranking', async () => {
      const g = realGuard({ readings: { a1: [50, 50], a2: [20, 5], a3: [30, 10], a4: [100, 0] } })
      const r = await chooseSessionStart(ctxOf(g), {})
      expect(r.accountId).toBe('a2')
      expect(r.rollAccountIds).toEqual(['a2', 'a3', 'a1', 'a4'])
    })

    it('no account named and the first account full: another one', async () => {
      const g = realGuard({ readings: { ...allEmpty, a1: [95, 0] } })
      const r = await chooseSessionStart(ctxOf(g), {})
      expect(r.accountId).not.toBe('a1')
      expect(r.rollAccountIds.at(-1)).toBe('a1')
    })

    it('no account named: only the asked provider', async () => {
      const g = realGuard({ readings: { a1: [5, 5], x1: [50, 50], x2: [10, 10] } })
      const r = await chooseSessionStart(ctxOf(g, [acct('a1'), acct('x1', 'codex'), acct('x2', 'codex')]), { provider: 'codex' })
      expect(r).toMatchObject({ accountId: 'x2', rollAccountIds: ['x2', 'x1'] })
    })

    it('a picked account with room keeps its own chain (none: no rolling), as before', async () => {
      const g = realGuard({ readings: { ...allEmpty, a1: [80, 80] } })
      expect(await chooseSessionStart(ctxOf(g), { accountId: 'a1', rollAccountIds: ['a1', 'a3'] })).toMatchObject({ accountId: 'a1', rollAccountIds: ['a1', 'a3'] })
      expect(await chooseSessionStart(ctxOf(g), { accountId: 'a1' })).toMatchObject({ accountId: 'a1', rollAccountIds: [] })
    })

    it('a picked full account is not started on: its own chain first, else the best ranked; the chain follows the start', async () => {
      const g = realGuard({ readings: { a1: [100, 0], a2: [10, 10], a3: [50, 50], a4: [5, 5] } })
      expect(await chooseSessionStart(ctxOf(g), { accountId: 'a1', rollAccountIds: ['a1', 'a3'] })).toMatchObject({ accountId: 'a3', rollAccountIds: ['a3', 'a1'] })
      expect(await chooseSessionStart(ctxOf(g), { accountId: 'a1' })).toMatchObject({ accountId: 'a4', rollAccountIds: [] })
    })

    it('nothing has room: refused with the plain reason', async () => {
      const g = realGuard({ readings: { a1: [100, 0], a2: [100, 0], a3: [100, 0], a4: [100, 0] } })
      await expect(chooseSessionStart(ctxOf(g), {})).rejects.toThrow(/no claude account has room to start the session on/)
      await expect(chooseSessionStart(ctxOf(g), { accountId: 'a1' })).rejects.toThrow(/no claude account has room/)
    })

    // Restart/Reopen of a chat names only its thread: a move to another account must still carry the conversation
    it('a resume moved off a full claude account finds the transcript on the original account', async () => {
      const g = realGuard({ readings: { ...allEmpty, a1: [100, 0] } })
      const find = vi.fn(async (dir: string, id: string) => (dir === 'D:/cfg/a1' && id === 'n-1' ? 'D:/cfg/a1/projects/p/n-1.jsonl' : null))
      const r = await chooseResumeStart(ctxOf(g), { accountId: 'a1', resumeId: 'n-1' }, find)
      expect(r.accountId).not.toBe('a1')
      expect(r.transcriptPath).toBe('D:/cfg/a1/projects/p/n-1.jsonl')
      // a path the caller already has is kept, and a resume that stays needs none
      expect((await chooseResumeStart(ctxOf(g), { accountId: 'a1', resumeId: 'n-1', transcriptPath: 'X' }, find)).transcriptPath).toBeUndefined()
      const stays = await chooseResumeStart(ctxOf(g), { accountId: 'a2', resumeId: 'n-1' }, find)
      expect([stays.accountId, stays.transcriptPath]).toEqual(['a2', undefined])
    })

    it('a codex resume with no rollout path stays on its account, full or not', async () => {
      const g = realGuard({ readings: { x1: [100, 0], x2: [5, 5] } })
      const r = await chooseResumeStart(ctxOf(g, [acct('x1', 'codex'), acct('x2', 'codex')]), { accountId: 'x1', resumeId: 't-1' }, vi.fn())
      expect(r).toMatchObject({ accountId: 'x1', rollAccountIds: [] })
    })

    it('setting off: the named account and chain as given, and no account named is the first one, not rolling', async () => {
      expect(await chooseSessionStart(ctxOf(off()), { accountId: 'a1', rollAccountIds: ['a1', 'a2'] })).toMatchObject({ accountId: 'a1', rollAccountIds: ['a1', 'a2'] })
      expect(await chooseSessionStart(ctxOf(off()), { accountId: 'a1' })).toMatchObject({ accountId: 'a1', rollAccountIds: [] })
      expect(await chooseSessionStart(ctxOf(off()), {})).toMatchObject({ accountId: 'a1', rollAccountIds: [] })
    })
  })
})
