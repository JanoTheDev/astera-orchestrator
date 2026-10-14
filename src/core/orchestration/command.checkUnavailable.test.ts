// Answering a check that could not be made (plugin Phase 5 C9): `retry` runs the Task's checks again, `skip-check` lets
// this round go on without the check (the Task's record keeps that it was skipped), `mark-failed` fails the Task. No
// other answer is taken: a plain resolve would send the Task back to a worker.
import { describe, it, expect } from 'vitest'
import { handleCommand, type OrchServerDeps } from './command'
import { applyValidationResult, emptyState, type OrchState } from './state'
import type { CheckResult, Task } from './types'

const NOW = '2026-10-14T00:00:00.000Z'

type Deps = OrchServerDeps & { validations: Array<{ taskId: string; cwd: string }> }

const makeDeps = (): Deps => {
  const box = { state: emptyState() as OrchState }
  const validations: Array<{ taskId: string; cwd: string }> = []
  return {
    validations,
    getState: () => box.state,
    setState: async (next: OrchState) => {
      box.state = next
    },
    startWorker: async () => ({ sessionId: 'sess1', cwd: 'D:/w', specPath: 'D:/specs/a.md' }),
    releaseWorker: async () => {},
    listAccounts: () => [{ id: 'accA', label: 'A', provider: 'claude' }],
    readWorker: async () => 'output',
    now: () => NOW,
    lang: () => 'en' as const,
    startValidation: (a: { taskId: string; cwd: string }) => void validations.push(a)
  } as unknown as Deps
}

const call = (deps: OrchServerDeps, cmd: string, args: Record<string, unknown> = {}, sessionId = 'coordinator') =>
  handleCommand(deps, { sessionId }, cmd, args)

/** A Task whose round [npm-test passed, plugin:d error, ...rest not run] put it to a person. */
async function blocked(deps: Deps, rest: string[] = ['lint']): Promise<{ taskId: string; gateId: string }> {
  await call(deps, 'run-create', { objective: 'o', cwd: 'D:/p' })
  await call(deps, 'task-create', { spec: 's', account: 'accA', validate: ['npm-test', 'plugin:d', ...rest].join(',') })
  const taskId = deps.getState().tasks[0].id
  const ws = await call(deps, 'worker-start', { task: taskId, agent: 'claude', account: 'accA', worktree: 'current' })
  const dispatchId = (ws.body as { dispatchId: string }).dispatchId
  await call(deps, 'send', { type: 'worker_done', taskId, dispatchId, outcome: 'succeeded', subject: 's', body: 'b' }, 'sess1')
  expect(deps.getState().tasks[0].status).toBe('validating')
  deps.validations.length = 0
  const results: CheckResult[] = [
    { configId: 'npm-test', name: 'Tests', status: 'passed', exitCode: 0 },
    { configId: 'plugin:d', name: 'D', status: 'error', summary: 'service down' },
    ...rest.map((id): CheckResult => ({ configId: id, name: id, status: 'not-run' }))
  ]
  const r = applyValidationResult(deps.getState(), { taskId, results }, NOW)
  if (!r.ok) throw new Error(r.error)
  await deps.setState(r.state)
  const gate = deps.getState().gates.find((g) => g.taskId === taskId && g.status === 'open')!
  expect(gate.kind).toBe('check-unavailable')
  return { taskId, gateId: gate.id }
}

const taskOf = (deps: Deps, id: string): Task => deps.getState().tasks.find((t) => t.id === id)!

describe('answering a check that could not be made', () => {
  it('retry: runs the Task’s checks again in its worker’s folder', async () => {
    const deps = makeDeps()
    const { taskId, gateId } = await blocked(deps)
    const r = await call(deps, 'gate-resolve', { id: gateId, resolution: 'retry' })
    expect(r.status).toBe(200)
    expect(deps.getState().gates.find((g) => g.id === gateId)).toMatchObject({ status: 'resolved', resolution: 'retry' })
    expect(taskOf(deps, taskId).status).toBe('validating')
    expect(taskOf(deps, taskId)).not.toHaveProperty('checkResume')
    expect(deps.validations).toEqual([{ taskId, cwd: 'D:/w' }])
  })

  it('skip-check: goes on from the check after it, the skip recorded', async () => {
    const deps = makeDeps()
    const { taskId, gateId } = await blocked(deps)
    const r = await call(deps, 'questions-answer', { id: gateId, answer: 'skip-check' })
    expect(r.status).toBe(200)
    const task = taskOf(deps, taskId)
    expect(task.status).toBe('validating')
    expect(task.checkResume).toEqual({
      done: [
        { configId: 'npm-test', name: 'Tests', status: 'passed', exitCode: 0 },
        { configId: 'plugin:d', name: 'D', status: 'not-run', skipped: true, summary: 'Skipped by a person: service down' }
      ],
      rest: ['lint']
    })
    expect(deps.validations).toEqual([{ taskId, cwd: 'D:/w' }])
  })

  it('skip-check of the last check leaves nothing to run', async () => {
    const deps = makeDeps()
    const { taskId, gateId } = await blocked(deps, [])
    await call(deps, 'gate-resolve', { id: gateId, resolution: 'skip-check' })
    expect(taskOf(deps, taskId).checkResume?.rest).toEqual([])
    expect(deps.validations).toHaveLength(1)
  })

  it('mark-failed: the Task fails and nothing runs', async () => {
    const deps = makeDeps()
    const { taskId, gateId } = await blocked(deps)
    const r = await call(deps, 'gate-resolve', { id: gateId, resolution: 'mark-failed' })
    expect(r.status).toBe(200)
    expect(taskOf(deps, taskId).status).toBe('failed')
    expect(deps.validations).toEqual([])
  })

  it('takes no other answer: the question stays open and the Task waits', async () => {
    const deps = makeDeps()
    const { taskId, gateId } = await blocked(deps)
    const r = await call(deps, 'questions-answer', { id: gateId, answer: 'ok' })
    expect(r.status).toBe(400)
    expect((r.body as { error: string }).error).toBe('answer one of retry, skip-check, mark-failed')
    expect(deps.getState().gates.find((g) => g.id === gateId)?.status).toBe('open')
    expect(taskOf(deps, taskId).status).toBe('blocked')
    expect(deps.validations).toEqual([])
  })

  it('answered again, does nothing more', async () => {
    const deps = makeDeps()
    const { gateId } = await blocked(deps)
    await call(deps, 'gate-resolve', { id: gateId, resolution: 'retry' })
    const again = await call(deps, 'gate-resolve', { id: gateId, resolution: 'retry' })
    expect(again.status).toBe(200)
    expect(deps.validations).toHaveLength(1)
  })

  it('refuses retry and skip-check where no checks can run, the question left open', async () => {
    const deps = makeDeps()
    const { taskId, gateId } = await blocked(deps)
    delete (deps as { startValidation?: unknown }).startValidation
    for (const resolution of ['retry', 'skip-check']) {
      const r = await call(deps, 'gate-resolve', { id: gateId, resolution })
      expect(r.status).toBe(409)
    }
    expect(deps.getState().gates.find((g) => g.id === gateId)?.status).toBe('open')
    expect(taskOf(deps, taskId).status).toBe('blocked')
  })
})
