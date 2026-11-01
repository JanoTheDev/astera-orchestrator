// Answering a check that could not be made (plugin Phase 5 C9): `retry` runs the Task's checks again, `skip-check` lets
// this round go on without the check (the Task's record keeps that it was skipped), `mark-failed` fails the Task. No
// other answer is taken: a plain resolve would send the Task back to a worker.
import { describe, it, expect } from 'vitest'
import { handleCommand, type OrchServerDeps } from './command'
import { applyValidationResult, blockForValidation, emptyState, liveCheckResume, type OrchState } from './state'
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
      dispatchId: deps.getState().dispatches[0].id,
      done: [
        { configId: 'npm-test', name: 'Tests', status: 'passed', exitCode: 0 },
        { configId: 'plugin:d', name: 'D', status: 'not-run', skipped: true, summary: 'Skipped by a person: service down' }
      ],
      rest: ['lint']
    })
    expect(deps.validations).toEqual([{ taskId, cwd: 'D:/w' }])
  })

  describe('T9: a hands-off plan retries once, then skips the check and records why', () => {
    /** The Task's check already retried once: an earlier check-unavailable Gate answered `retry`. */
    const retriedOnce = async (deps: Deps, taskId: string, handsOff: boolean): Promise<void> => {
      const s = deps.getState()
      const earlier = { id: 'gat_earlier', runId: s.tasks[0].runId!, taskId, question: 'q', kind: 'check-unavailable' as const, status: 'resolved' as const, resolution: 'retry', createdAt: NOW }
      await deps.setState({ ...s, gates: [...s.gates, earlier], jobs: s.jobs.map((j) => ({ ...j, handsOff })) })
    }

    it('keeps who skipped the check and why on the Task’s check record', async () => {
      const deps = makeDeps()
      const { taskId, gateId } = await blocked(deps)
      await retriedOnce(deps, taskId, true)
      expect((await call(deps, 'questions-answer', { id: gateId, answer: 'skip-check' })).status).toBe(200)
      const skipped = taskOf(deps, taskId).checkResume!.done[1]
      expect(skipped).toEqual({
        configId: 'plugin:d',
        name: 'D',
        status: 'not-run',
        skipped: true,
        summary: 'Skipped by the hands-off plan after one retry: service down'
      })
      expect(taskOf(deps, taskId).checkResume!.rest).toEqual(['lint'])
    })

    it('a person’s skip, or a skip with no earlier retry, is still recorded as a person’s', async () => {
      const handsOff = makeDeps()
      const a = await blocked(handsOff)
      await handsOff.setState({ ...handsOff.getState(), jobs: handsOff.getState().jobs.map((j) => ({ ...j, handsOff: true })) })
      await call(handsOff, 'gate-resolve', { id: a.gateId, resolution: 'skip-check' })
      expect(taskOf(handsOff, a.taskId).checkResume!.done[1]).toMatchObject({ summary: 'Skipped by a person: service down' })

      const manual = makeDeps()
      const b = await blocked(manual)
      await retriedOnce(manual, b.taskId, false)
      await call(manual, 'gate-resolve', { id: b.gateId, resolution: 'skip-check' })
      expect(taskOf(manual, b.taskId).checkResume!.done[1]).toMatchObject({ summary: 'Skipped by a person: service down' })
    })
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
    // W8-E (#99): out of tries, so its Run can end
    expect(taskOf(deps, taskId).consecutiveFailures).toBe(3)
    expect(deps.validations).toEqual([])
  })

  // 5a final review C1: the skip is for that round of that attempt's work, never for new work
  it('lets a skip go with its round: new work after a block runs every check', async () => {
    const deps = makeDeps()
    const { taskId, gateId } = await blocked(deps)
    await call(deps, 'gate-resolve', { id: gateId, resolution: 'skip-check' })
    // The resumed round cannot run (a person stopped it, say): a plain question, answered, and the work redone
    const b = blockForValidation(deps.getState(), { taskId, reason: 'stopped' }, NOW)
    if (!b.ok) throw new Error(b.error)
    await deps.setState(b.state)
    expect(taskOf(deps, taskId)).not.toHaveProperty('checkResume')
    expect((await call(deps, 'gate-resolve', { id: b.value.id, resolution: 'go on' })).status).toBe(200)
    const ws = await call(deps, 'worker-start', { task: taskId, agent: 'claude', account: 'accA', worktree: 'current' })
    const dispatchId = (ws.body as { dispatchId: string }).dispatchId
    await call(deps, 'send', { type: 'worker_done', taskId, dispatchId, outcome: 'succeeded', subject: 's', body: 'b' }, 'sess1')
    expect(taskOf(deps, taskId).status).toBe('validating')
    expect(taskOf(deps, taskId)).not.toHaveProperty('checkResume')
  })

  it('ignores a skip left from another attempt, however it was left', async () => {
    const deps = makeDeps()
    const { taskId, gateId } = await blocked(deps)
    await call(deps, 'gate-resolve', { id: gateId, resolution: 'skip-check' })
    const task = taskOf(deps, taskId)
    expect(liveCheckResume(deps.getState(), task)).toEqual(task.checkResume)
    // A later attempt, as task-update's moves past the table could leave one
    const s = deps.getState()
    const later = { ...s.dispatches[0], id: 'dsp_later', startedAt: '2026-10-14T01:00:00.000Z' }
    expect(liveCheckResume({ ...s, dispatches: [...s.dispatches, later] }, task)).toBeNull()
  })

  // 5a final review I1: a question left open over a Task a person already moved changes nothing of the Task
  it('resolves a question left over a Task no longer waiting on it, moving nothing', async () => {
    const deps = makeDeps()
    const { taskId, gateId } = await blocked(deps)
    expect((await call(deps, 'task-update', { id: taskId, status: 'completed' })).status).toBe(200)
    expect(taskOf(deps, taskId).status).toBe('completed')
    for (const resolution of ['retry', 'mark-failed']) {
      const r = await call(deps, 'gate-resolve', { id: gateId, resolution })
      expect(r.status).toBe(200)
      expect(taskOf(deps, taskId).status).toBe('completed')
    }
    expect(deps.getState().gates.find((g) => g.id === gateId)?.status).toBe('resolved')
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
