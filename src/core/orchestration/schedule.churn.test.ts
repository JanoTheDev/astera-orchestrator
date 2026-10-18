// W3-D: the scheduler under churn (SPEC §3, §10, §12). schedule.global.test.ts checks one state at a time; this drives
// many ticks through the real transitions (`slotsToFill` → `openDispatch` → `applyWorkerDone`, and the `runs-stop` /
// `jobs-archive` commands in between) and checks the caps, pause and archive isolation, and that failed, cancelled
// and awaiting-review work never releases a dependent.
import { describe, it, expect } from 'vitest'
import { slotsToFill, workersAgainstCap } from './schedule'
import { applyWorkerDone, emptyState, openDispatch, type OrchState } from './state'
import { handleCommand, type OrchServerDeps } from './command'
import { taskBoardsOf } from './blocked'
import { FAILURE_LIMIT, recomputeReady, type Job, type JobRun, type Task } from './types'

const T0 = '2026-10-17T00:00:00.000Z'
const at = (tick: number): string => new Date(Date.parse(T0) + tick * 60_000).toISOString()

const job = (id: string, over: Partial<Job> = {}): Job => ({ id, objective: id, cwd: '/p', createdAt: T0, autoDispatch: true, ...over })
const run = (id: string, jobId: string): JobRun => ({ id, jobId, ordinal: 1, createdAt: T0 })
const task = (id: string, runId: string, over: Partial<Task> = {}): Task => ({
  id, runId, title: id, spec: 's', deps: [], status: 'ready', accountIds: ['acc_1'], consecutiveFailures: 0, createdAt: T0, updatedAt: T0, ...over
})

const isOpen = (d: OrchState['dispatches'][number]): boolean => !d.outcome && !d.endedAt

/** A seeded generator, so a failing run can be replayed. */
const lcg = (seed: number) => () => {
  seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31
  return seed / 2 ** 31
}

/** The command layer over a box, for the stop and archive a person sends mid-churn. */
const commands = (box: { state: OrchState }, tick: () => number) => {
  const deps = {
    getState: () => box.state,
    setState: async (next: OrchState) => {
      box.state = next
    },
    startWorker: async () => {
      throw new Error('the churn places workers itself')
    },
    releaseWorker: async () => {},
    listAccounts: () => [{ id: 'acc_1', label: 'one', provider: 'claude' as const }],
    readWorker: async () => '',
    now: () => at(tick())
  } as unknown as OrchServerDeps
  return (cmd: string, args: Record<string, unknown>) => handleCommand(deps, { sessionId: '' }, cmd, args)
}

/** Places every slot the scheduler hands out, as the dispatch loop does, and returns the Tasks placed. */
const place = (box: { state: OrchState }, cap: number, tick: number): string[] => {
  const slots = slotsToFill(box.state, { maxConcurrentWorkers: cap })
  for (const [i, slot] of slots.entries()) {
    const r = openDispatch(
      box.state,
      { taskId: slot.taskId, provider: 'claude', accountId: slot.accountIds[0], sessionId: `ses_${tick}_${i}`, cwd: '/p', specPath: '/s' },
      at(tick)
    )
    if (!r.ok) throw new Error(`the scheduler offered a Task openDispatch refuses: ${slot.taskId}: ${r.error}`)
    box.state = r.state
  }
  return slots.map((x) => x.taskId)
}

const report = (box: { state: OrchState }, dispatchId: string, outcome: 'succeeded' | 'failed', tick: number): void => {
  const d = box.state.dispatches.find((x) => x.id === dispatchId)!
  const r = applyWorkerDone(box.state, { taskId: d.taskId, dispatchId, outcome, subject: '', body: '' }, at(tick))
  if (!r.ok) throw new Error(r.error)
  box.state = r.state
}

const runOfTask = (s: OrchState, taskId: string): string => s.tasks.find((t) => t.id === taskId)!.runId!

describe('the caps under churn', () => {
  it('never exceed the app-wide or a plan’s own cap, nor place a Task or a session twice; pausing B and archiving C stop only them', async () => {
    const CAP = 4
    const concurrency: Record<string, number> = { A: 2, B: 3, C: 2 }
    const box = { state: emptyState() }
    for (const k of ['A', 'B', 'C']) {
      box.state.jobs.push(job(k, { concurrency: concurrency[k], priority: k === 'A' ? 1 : 0 }))
      box.state.runs.push(run(`r_${k}`, k))
      for (let i = 1; i <= 8; i++) box.state.tasks.push(task(`${k}${i}`, `r_${k}`))
    }
    let tick = 0
    const cli = commands(box, () => tick)
    const random = lcg(7)
    const placedAfter: Record<'B' | 'C', string[]> = { B: [], C: [] }
    let openAtStop: string[] = []
    let openAtArchive: string[] = []

    for (tick = 1; tick <= 40; tick++) {
      if (tick === 4) {
        openAtStop = box.state.dispatches.filter((d) => isOpen(d) && runOfTask(box.state, d.taskId) === 'r_B').map((d) => d.id)
        expect(openAtStop.length).toBeGreaterThan(0)
        expect((await cli('runs-stop', { id: 'r_B' })).status).toBe(200)
      }
      if (tick === 8) {
        openAtArchive = box.state.dispatches.filter((d) => isOpen(d) && runOfTask(box.state, d.taskId) === 'r_C').map((d) => d.id)
        expect(openAtArchive.length).toBeGreaterThan(0)
        expect((await cli('jobs-archive', { id: 'C' })).status).toBe(200)
      }
      const placed = place(box, CAP, tick)
      if (tick >= 4) placedAfter.B.push(...placed.filter((t) => t.startsWith('B')))
      if (tick >= 8) placedAfter.C.push(...placed.filter((t) => t.startsWith('C')))

      const s = box.state
      const open = s.dispatches.filter(isOpen)
      expect(workersAgainstCap(s), `tick ${tick}`).toBeLessThanOrEqual(CAP)
      for (const k of ['A', 'B', 'C'])
        expect(open.filter((d) => runOfTask(s, d.taskId) === `r_${k}`).length, `tick ${tick} ${k}`).toBeLessThanOrEqual(concurrency[k])
      expect(new Set(open.map((d) => d.taskId)).size, `tick ${tick}`).toBe(open.length)
      expect(new Set(open.map((d) => d.sessionId)).size, `tick ${tick}`).toBe(open.length)

      // About half of the live, still-running workers finish this tick; one in five of those fails. B's stopped
      // workers are closed already; C's keep running after the archive (it kills nothing) and may finish too.
      for (const d of open) if (random() < 0.5) report(box, d.id, random() < 0.2 ? 'failed' : 'succeeded', tick)
    }

    // B, stopped at tick 4: nothing placed after, its open workers closed as stopped by a person.
    expect(placedAfter.B).toEqual([])
    for (const id of openAtStop) expect(box.state.dispatches.find((d) => d.id === id)).toMatchObject({ closedBy: 'stop' })
    // C, archived at tick 8: nothing placed after, and the archive closed none of its workers.
    expect(placedAfter.C).toEqual([])
    for (const id of openAtArchive) expect(box.state.dispatches.find((d) => d.id === id)?.closedBy).toBeUndefined()
    // A kept going through both, and every Task of A that did not fail finished.
    const a = box.state.tasks.filter((t) => t.runId === 'r_A')
    expect(a.every((t) => t.status === 'completed' || t.status === 'failed')).toBe(true)
    expect(a.some((t) => t.status === 'completed')).toBe(true)
  })

  it('with a cap of one, two equal plans take turns as slots free up', () => {
    const box = { state: emptyState() }
    for (const k of ['A', 'B']) {
      box.state.jobs.push(job(k, { concurrency: 3 }))
      box.state.runs.push(run(`r_${k}`, k))
      for (let i = 1; i <= 3; i++) box.state.tasks.push(task(`${k}${i}`, `r_${k}`))
    }
    const order: string[] = []
    for (let tick = 1; tick <= 6; tick++) {
      const placed = place(box, 1, tick)
      expect(placed).toHaveLength(1)
      order.push(placed[0])
      const d = box.state.dispatches.find((x) => x.taskId === placed[0] && isOpen(x))!
      report(box, d.id, 'succeeded', tick)
    }
    expect(order.map((t) => t[0])).toEqual(['A', 'B', 'A', 'B', 'A', 'B'])
  })
})

describe('failure, retry, circuit break, cancel and review never release a dependent', () => {
  /** One plan: `up` fails, `ok` succeeds, `join` needs both, `last` needs `join`. `stop` is cancelled and `after`
   *  needs it. `rev` asks for a review and `next` needs it. */
  const plan = (): { state: OrchState } => {
    const s = emptyState()
    s.jobs.push(job('J', { concurrency: 10 }))
    s.runs.push(run('r', 'J'))
    s.tasks.push(
      task('up', 'r'),
      task('ok', 'r'),
      task('join', 'r', { status: 'pending', deps: ['up', 'ok'] }),
      task('last', 'r', { status: 'pending', deps: ['join'] }),
      task('stop', 'r'),
      task('after', 'r', { status: 'pending', deps: ['stop'] }),
      task('rev', 'r', { reviewRequested: true }),
      task('next', 'r', { status: 'pending', deps: ['rev'] })
    )
    return { state: s }
  }
  const openOf = (s: OrchState, taskId: string) => s.dispatches.find((d) => d.taskId === taskId && isOpen(d))!
  const dependents = ['join', 'last', 'after', 'next']

  it('keeps every dependent pending, unplaced and unstartable, and tells failed, cancelled and awaiting-review apart', async () => {
    const box = plan()
    let tick = 1
    const cli = commands(box, () => tick)
    expect(place(box, 10, tick).sort()).toEqual(['ok', 'rev', 'stop', 'up'])

    // `up` fails and is retried until the circuit breaks; `ok` succeeds; `rev` reports and waits for its reviewer
    report(box, openOf(box.state, 'ok').id, 'succeeded', tick)
    const r = applyWorkerDone(
      box.state,
      { taskId: 'rev', dispatchId: openOf(box.state, 'rev').id, outcome: 'succeeded', subject: '', body: '', canReview: true },
      at(tick)
    )
    if (!r.ok) throw new Error(r.error)
    box.state = r.state
    expect((await cli('worker-stop', { dispatch: openOf(box.state, 'stop').id })).status).toBe(200)
    let last = openOf(box.state, 'up').id
    for (let i = 1; i <= FAILURE_LIMIT; i++) {
      report(box, last, 'failed', tick++)
      const retry = openDispatch(
        box.state,
        { taskId: 'up', provider: 'claude', accountId: 'acc_1', sessionId: `ses_up_${i}`, cwd: '/p', specPath: '/s', retryOf: last },
        at(tick)
      )
      if (i < FAILURE_LIMIT) {
        if (!retry.ok) throw new Error(retry.error)
        box.state = retry.state
        last = openOf(box.state, 'up').id
      } else {
        expect(retry.ok).toBe(false)
        if (!retry.ok) expect(retry.error).toContain('circuit break')
      }
    }

    const s = box.state
    // nothing more to place: not the broken Task, not a dependent
    expect(slotsToFill(s, { maxConcurrentWorkers: 10 })).toEqual([])
    for (const id of dependents) {
      expect(s.tasks.find((t) => t.id === id)?.status, id).toBe('pending')
      const started = openDispatch(s, { taskId: id, provider: 'claude', accountId: 'acc_1', sessionId: `ses_${id}`, cwd: '/p', specPath: '/s' }, at(tick))
      expect(started.ok, id).toBe(false)
    }
    // recomputing never promotes them either
    expect(recomputeReady(s.tasks).filter((t) => dependents.includes(t.id)).map((t) => t.status)).toEqual(['pending', 'pending', 'pending', 'pending'])

    const board = taskBoardsOf(s, { maxConcurrentWorkers: 10 })
    expect(board.get('up')).toEqual({ category: 'failed', reason: { kind: 'failure-limit', failures: FAILURE_LIMIT, limit: FAILURE_LIMIT } })
    expect(board.get('stop')).toEqual({ category: 'cancelled', reason: { kind: 'stopped' } })
    expect(board.get('rev')).toEqual({ category: 'awaiting-review', reason: { kind: 'awaiting-review' } })
    expect(board.get('ok')?.category).toBe('done')
    expect(board.get('join')).toMatchObject({ category: 'queued', reason: { kind: 'deps', waitingOn: [{ id: 'up', status: 'failed' }] } })
    expect(board.get('after')).toMatchObject({ category: 'queued', reason: { kind: 'deps', waitingOn: [{ id: 'stop', status: 'dispatched' }] } })
    expect(board.get('next')).toMatchObject({ category: 'queued', reason: { kind: 'deps', waitingOn: [{ id: 'rev', status: 'reviewing' }] } })
  })

  it('a failure with retries left is failed-retry, and a successful retry releases the dependent once', () => {
    const box = plan()
    place(box, 10, 1)
    report(box, openOf(box.state, 'ok').id, 'succeeded', 1)
    const first = openOf(box.state, 'up').id
    report(box, first, 'failed', 2)
    expect(taskBoardsOf(box.state).get('up')).toEqual({ category: 'failed', reason: { kind: 'failed-retry', failures: 1, limit: FAILURE_LIMIT, noCoordinator: true } })
    expect(box.state.tasks.find((t) => t.id === 'join')?.status).toBe('pending')
    const retry = openDispatch(
      box.state,
      { taskId: 'up', provider: 'claude', accountId: 'acc_1', sessionId: 'ses_retry', cwd: '/p', specPath: '/s', retryOf: first },
      at(3)
    )
    if (!retry.ok) throw new Error(retry.error)
    box.state = retry.state
    report(box, openOf(box.state, 'up').id, 'succeeded', 4)
    expect(box.state.tasks.find((t) => t.id === 'join')?.status).toBe('ready')
    expect(slotsToFill(box.state, { maxConcurrentWorkers: 10 }).map((x) => x.taskId)).toEqual(['join'])
    expect(box.state.tasks.find((t) => t.id === 'last')?.status).toBe('pending')
  })
})
