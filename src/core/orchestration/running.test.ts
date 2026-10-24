import { describe, it, expect } from 'vitest'
import { runningCount, isStoppedWorker, runningRunCount, outcomeOf, outcomeOfTasks, outcomeOfRun, deliveryErrorOf, stuckOf } from './running'
import { snapshotFor } from './view'
import { emptyState } from './state'
import type { OrchState } from './state'
import { FAILURE_LIMIT, type Dispatch, type Job, type JobRun, type Task } from './types'
import { stateFromLegacy } from './legacyState'
import type { LegacyRun } from './legacy'
import { absPath } from '../testPaths'

// 이 테스트는 JobTask 를 손으로 짓지 않고 **실제 투영(snapshotFor)을 거쳐** 만든다. 세는 규칙이
// 틀렸던 원인이 바로 "상태와 열린 Dispatch 가 어긋난다"는 것이었으므로, 그 어긋남을 만드는 유일한
// 자리(OrchState)에서 출발해야 재현이 된다. JobTask 를 직접 지으면 그 어긋남 자체를 테스트가
// 가정해 버려서, 투영이 바뀌는 날 조용히 통과한다.
const PROJ = absPath('proj')
const run = (id: string): LegacyRun => ({
  id,
  objective: `objective ${id}`,
  cwd: PROJ,
  createdAt: '2026-08-20T00:00:00.000Z'
})
const task = (id: string, status: Task['status']): Task => ({
  id,
  runId: 'r1',
  title: `task ${id}`,
  spec: '',
  deps: [],
  status,
  consecutiveFailures: 0,
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z'
})
/** 열린 Dispatch — outcome 도 endedAt 도 없다. 이것만이 "지금 워커가 붙어 있다"를 말한다 */
const open = (id: string, taskId: string): Dispatch => ({
  id,
  taskId,
  sessionId: `sess-${id}`,
  startedAt: '2026-08-20T01:00:00.000Z',
  provider: 'claude',
  accountId: 'acc',
  cwd: PROJ,
  specPath: '',
  workerState: 'ready',
  retained: false
})
/** worker-stop 이 남기는 모양 — 세션을 닫고 workerState·endedAt 만 적는다. **outcome 은 없다**:
 *  Task 를 일부러 건드리지 않으므로(server.ts 의 worker-stop) 결과도 정해지지 않았다 */
const stopped = (d: Dispatch): Dispatch => ({
  ...d,
  workerState: 'stopped',
  endedAt: '2026-08-20T02:00:00.000Z'
})

/** 상태를 투영까지 돌려 그 Run 의 JobTask 들을 얻는다 */
const countOf = (tasks: Task[], dispatches: Dispatch[]): number => {
  const s: OrchState = stateFromLegacy({ runs: [run('r1')], tasks, dispatches })
  return runningCount(snapshotFor(s, PROJ, () => true, [], () => null, () => true).runs[0].tasks)
}

/** 상태를 투영까지 돌려 그 Run 의 JobTask 하나를 얻는다 */
const taskOf = (tasks: Task[], dispatches: Dispatch[], id: string) => {
  const s: OrchState = stateFromLegacy({ runs: [run('r1')], tasks, dispatches })
  const t = snapshotFor(s, PROJ, () => true, [], () => null, () => true).runs[0].tasks.find((x) => x.id === id)
  if (!t) throw new Error(`no such task in snapshot: ${id}`)
  return t
}

describe('runningCount', () => {
  it('열린 Dispatch 가 붙은 dispatched Task 를 센다', () => {
    const ts = [task('t1', 'dispatched'), task('t2', 'dispatched')]
    expect(countOf(ts, [open('d1', 't1'), open('d2', 't2')])).toBe(2)
  })

  // 재현: F11 시나리오 A-1. 워커 넷을 띄우고 하나를 worker-stop 하면 셋이어야 한다.
  // worker-stop 은 Dispatch 만 닫고 Task 는 dispatched 로 남기므로, 상태로 세면 넷이 그대로 나온다
  it('worker-stop 으로 Dispatch 가 닫힌 Task 는 세지 않는다', () => {
    const ts = ['t1', 't2', 't3', 't4'].map((id) => task(id, 'dispatched'))
    const ds = ['t1', 't2', 't3', 't4'].map((id, i) => open(`d${i + 1}`, id))
    expect(countOf(ts, [...ds.slice(0, 3), stopped(ds[3])])).toBe(3)
  })

  // 재현: A-3. 넷을 다 끄면 0 이어야 한다 — 상태로 세면 줄 하나 없이 `+4` 가 선다
  it('워커를 다 끄면 0 이다 — 상태가 dispatched 로 남아 있어도', () => {
    const ts = ['t1', 't2', 't3', 't4'].map((id) => task(id, 'dispatched'))
    const ds = ['t1', 't2', 't3', 't4'].map((id, i) => stopped(open(`d${i + 1}`, id)))
    expect(countOf(ts, ds)).toBe(0)
  })

  // 검증은 앱이 돌린다(ipc.ts 의 validator) — 세션이 아예 없으므로 열린 Dispatch 로만 세면
  // 검증만 남은 Run 이 화면에서 사라진다. 이것이 이 규칙을 상태로 쓸 수밖에 없던 이유였다
  it('validating 은 열린 Dispatch 가 없어도 센다', () => {
    const ts = [task('t1', 'validating')]
    expect(countOf(ts, [{ ...open('d1', 't1'), outcome: 'succeeded', endedAt: '2026-08-20T02:00:00.000Z' }])).toBe(1)
  })

  // reviewing 은 상태가 먼저 바뀌고 검토 세션이 async 로 뒤따라 뜬다(ipc.ts 의 void startReview).
  // 그 틈에 0 으로 떨어지면 검토가 시작될 때마다 숫자가 깜빡인다
  // T8: a reviewer that started and ended leaves its Task reviewing with nothing to finish it
  it('does not count a reviewing Task whose reviewer ended', () => {
    const ts = [task('t1', 'reviewing')]
    const worker = { ...open('d1', 't1'), outcome: 'succeeded' as const, endedAt: '2026-08-20T02:00:00.000Z' }
    const reviewer = { ...open('d2', 't1'), startedAt: '2026-08-20T03:00:00.000Z', review: true, endedAt: '2026-08-20T04:00:00.000Z' }
    expect(countOf(ts, [worker, reviewer])).toBe(0)
    expect(runningRunCount(stateFromLegacy({ runs: [run('r1')], tasks: ts, dispatches: [worker, reviewer] }))).toBe(0)
    expect(countOf(ts, [worker, { ...reviewer, endedAt: undefined }])).toBe(1)
  })

  it('reviewing 은 검토 세션이 아직 안 떴어도 센다', () => {
    const ts = [task('t1', 'reviewing')]
    expect(countOf(ts, [{ ...open('d1', 't1'), outcome: 'succeeded', endedAt: '2026-08-20T02:00:00.000Z' }])).toBe(1)
  })

  it('끝난 것·막힌 것·시작 전인 것은 세지 않는다', () => {
    const ts = [
      task('t1', 'completed'),
      task('t2', 'failed'),
      task('t3', 'blocked'),
      task('t4', 'ready'),
      task('t5', 'pending')
    ]
    expect(countOf(ts, [])).toBe(0)
  })
})


describe('isStoppedWorker', () => {
  // 글리프의 문구와 회전이 이것을 묻는다 — worker-stop 은 killSession 으로 세션을 정말 죽이므로
  // (coordinator.ts 의 releaseWorker) "워커가 일하는 중"도, 도는 모양도 그 뒤로는 거짓이다
  it('worker-stop 으로 Dispatch 가 닫힌 dispatched Task 가 그것이다', () => {
    const ts = [task('t1', 'dispatched')]
    expect(isStoppedWorker(taskOf(ts, [stopped(open('d1', 't1'))], 't1'))).toBe(true)
  })

  it('워커가 살아 있으면 아니다', () => {
    const ts = [task('t1', 'dispatched')]
    expect(isStoppedWorker(taskOf(ts, [open('d1', 't1')], 't1'))).toBe(false)
  })

  // 한 번도 뜬 적 없는 Task 도 dispatched 가 아니므로 여기 걸리지 않는다 — 걸리면 시작 전인 노드가
  // "워커가 멈췄다"를 달게 된다
  it('아직 뜬 적 없는 Task 는 아니다', () => {
    expect(isStoppedWorker(taskOf([task('t1', 'ready')], [], 't1'))).toBe(false)
  })

  // 끝난 Task 의 Dispatch 도 닫혀 있다. 상태로 먼저 걸러야 completed 노드가 멈춘 워커로 읽히지 않는다
  it('끝난 Task 는 Dispatch 가 닫혀 있어도 아니다', () => {
    const ts = [task('t1', 'completed')]
    const d = { ...open('d1', 't1'), outcome: 'succeeded' as const, endedAt: '2026-08-20T02:00:00.000Z' }
    expect(isStoppedWorker(taskOf(ts, [d], 't1'))).toBe(false)
  })
})


// === ruling F57 — `astera host stop` 이 거절할 때 세는 값 ===
//
// 같은 규칙을 상태 원본에서 답한다. 화면이 "도는 중" 이라고 적은 회차를 Host 가 멈춰도 되는 것으로
// 읽으면 안 되므로, 아래 셋은 위 runningCount 의 갈래를 그대로 따라간다.
describe('runningRunCount', () => {
  const stateOf = (tasks: Task[], dispatches: Dispatch[]): OrchState =>
    stateFromLegacy({ runs: [run('r1')], tasks, dispatches })

  it('워커가 붙어 있는 회차를 센다', () => {
    const d = open('d1', 't1')
    expect(runningRunCount(stateOf([task('t1', 'dispatched')], [d]))).toBe(1)
  })

  // worker-stop 은 세션을 죽이고 Task 는 그대로 둔다 — 상태만 보면 영원히 "도는 중" 이고, 그러면
  // 다 꺼 놓은 회차 하나가 host stop 을 영영 거절한다.
  it('워커를 멈춘 회차는 세지 않는다', () => {
    const d = stopped(open('d1', 't1'))
    expect(runningRunCount(stateOf([task('t1', 'dispatched')], [d]))).toBe(0)
  })

  // 검증·검토는 앱이 세션 없이 도는 일이다 — Dispatch 로만 세면 이 둘이 사라진다.
  it('검증·검토는 세션이 없어도 센다', () => {
    expect(runningRunCount(stateOf([task('t1', 'validating')], []))).toBe(1)
    expect(runningRunCount(stateOf([task('t1', 'reviewing')], []))).toBe(1)
  })

  it('아직 시작하지 않은 계획은 세지 않는다', () => {
    expect(runningRunCount(stateOf([task('t1', 'pending'), task('t2', 'ready')], []))).toBe(0)
  })

  it('끝난 회차는 세지 않는다', () => {
    expect(runningRunCount(stateOf([task('t1', 'completed'), task('t2', 'failed')], []))).toBe(0)
  })

  // 한 회차에 도는 Task 가 둘이어도 회차는 하나다 — 문장이 세는 것은 Job 이다.
  it('한 회차는 한 번만 센다', () => {
    const ds = [open('d1', 't1'), open('d2', 't2')]
    expect(runningRunCount(stateOf([task('t1', 'dispatched'), task('t2', 'dispatched')], ds))).toBe(1)
  })
})

// e2e 2026-10-01 second run: `astera status` said runsRunning: 0 while the Run's coordinator was at
// work and no worker had started yet. A Run whose coordinator is attached and has work left counts.
describe('runningRunCount with a coordinator', () => {
  const withCoordinator = (tasks: Task[], patch: Partial<OrchState['runs'][number]> = {}): OrchState => {
    const s = stateFromLegacy({ runs: [run('r1')], tasks, dispatches: [] })
    return { ...s, runs: s.runs.map((r) => ({ ...r, coordinatorSessionId: 'coord-1', ...patch })) }
  }

  it('counts a Run whose coordinator is attached, with no Task yet', () => {
    expect(runningRunCount(withCoordinator([]))).toBe(1)
  })

  it('counts a Run whose coordinator is attached and has Tasks still to start', () => {
    expect(runningRunCount(withCoordinator([task('t1', 'pending'), task('t2', 'ready')]))).toBe(1)
  })

  it('does not count a paused Run, nor a finished one, whose coordinator is still attached', () => {
    expect(runningRunCount(withCoordinator([], { paused: true }))).toBe(0)
    expect(runningRunCount(withCoordinator([task('t1', 'completed')]))).toBe(0)
  })
})

describe('merging', () => {
  it('is not terminal: a Run whose last Task is merging still runs', () => {
    expect(outcomeOfTasks([task('a', 'completed'), task('b', 'merging')])).toBe('running')
    expect(outcomeOfTasks([task('a', 'completed'), task('b', 'completed')])).toBe('completed')
  })
})

describe('a failed delivery', () => {
  const done = [task('a', 'completed'), task('b', 'completed')]
  const run = (over: Partial<JobRun>): JobRun => ({ id: 'r1', jobId: 'j1', ordinal: 1, createdAt: '2026-08-20T00:00:00.000Z', ...over }) as JobRun
  const state = emptyState()

  it('reads the pull request error, then the push error, and nothing for a clean record', () => {
    expect(deliveryErrorOf(run({ pr: { at: 'x', error: 'merge conflict' } }))).toBe('merge conflict')
    expect(deliveryErrorOf(run({ delivery: { at: 'x', error: 'push refused' } }))).toBe('push refused')
    expect(deliveryErrorOf(run({ pr: { at: 'x', url: 'u' } }))).toBeUndefined()
    expect(deliveryErrorOf(undefined)).toBeUndefined()
  })

  it('T1: a delivery the owner dismissed, pushed themselves, or that later went through never reads failed', () => {
    for (const state of ['dismissed', 'delivered-by-owner', 'delivered'] as const)
      expect(deliveryErrorOf(run({ delivery: { at: 'x', error: 'push refused' }, deliveryState: { state, attempts: 1 } }))).toBeUndefined()
    expect(deliveryErrorOf(run({ delivery: { at: 'x', error: 'push refused' }, deliveryState: { state: 'needs-owner', attempts: 5 } }))).toBe('push refused')
  })

  it('makes a Run whose Tasks all completed read failed, and leaves the Tasks-only answer alone', () => {
    expect(outcomeOfRun(done, run({ pr: { at: 'x', error: 'merge conflict' } }), state)).toBe('failed')
    expect(outcomeOfRun(done, run({ delivery: { at: 'x', error: 'push refused' } }), state)).toBe('failed')
    expect(outcomeOfTasks(done)).toBe('completed')
    expect(outcomeOfRun(done, run({}), state)).toBe('completed')
  })

  it('does not end a Run that still works', () => {
    expect(outcomeOfRun([task('a', 'completed'), task('b', 'merging')], run({ pr: { at: 'x', error: 'e' } }), state)).toBe('running')
  })
})

// T15: the 2026-10-22 `reset --tasks` wipe left delivered Runs with no Task; they read running for ever
describe('a Run whose Tasks are gone', () => {
  const NOW = '2026-10-19T00:00:00.000Z'
  const gone = (run: Partial<JobRun>, job: Partial<Job> = {}): OrchState => ({
    ...emptyState(),
    jobs: [{ id: 'job_1', objective: 'o', cwd: PROJ, createdAt: NOW, autoDispatch: true, plannerSessionIds: ['ses_p'], ...job }],
    runs: [{ id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: NOW, ...run }]
  })
  const pr = { at: NOW, url: 'https://github.com/o/r/pull/1', number: 1 }

  it('reads completed once delivered: a pushed sha or an opened pull request', () => {
    expect(outcomeOf(gone({ delivery: { at: NOW, branch: 'main', sha: 'abc' } }), 'run_1')).toBe('completed')
    expect(outcomeOf(gone({ pr }), 'run_1')).toBe('completed')
    expect(outcomeOf(gone({ pr, deliveryState: { state: 'pending', attempts: 0 } }), 'run_1')).toBe('completed')
  })

  it('reads failed when its delivery stopped or never finished: the owner has to look', () => {
    expect(outcomeOf(gone({ delivery: { at: NOW, branch: 'main', error: 'merge failed' } }), 'run_1')).toBe('failed')
    expect(outcomeOf(gone({ pr: { ...pr, draft: true, error: 'gh failed' }, deliveryState: { state: 'pending', attempts: 0 } }), 'run_1')).toBe('failed')
    expect(outcomeOf(gone({ pr: { ...pr, draft: true } }), 'run_1')).toBe('failed')
    expect(outcomeOf(gone({ branchPush: { state: 'delivered', attempts: 1 } }), 'run_1')).toBe('failed')
  })

  it('reads running while a replan can still add Tasks to a Run with a record', () => {
    expect(outcomeOf(gone({ pr }, { replanning: { runId: 'run_1', mode: 'completion', wave: 1, done: 0, startedAt: NOW } }), 'run_1')).toBe('running')
  })

  it('reads an empty Run with no record failed once nothing can add Tasks, running while something can', () => {
    const idle = gone({ deliveryState: { state: 'pending', attempts: 0 } })
    expect(outcomeOf(gone({}), 'run_1')).toBe('failed')
    expect(outcomeOf(idle, 'run_1')).toBe('failed')
    expect(snapshotFor(idle, PROJ, () => true, [], () => null, () => true).runs[0].outcome).toBe('failed')
    // something can still add Tasks: a coordinator, a coordinator start, a replan, a pending start (approval), a held
    // start; or the owner paused it
    for (const [r, j] of [
      [{ coordinatorSessionId: 'ses_c' }, {}],
      [{ externalCoordinatorSessionId: 'ses_x' }, {}],
      [{ coordinatorStartingAt: NOW }, {}],
      [{}, { replanning: { runId: 'run_1', mode: 'completion', wave: 1, done: 0, startedAt: NOW } }],
      [{}, { pendingStart: true }],
      [{}, { startWait: 'no account has room' }],
      [{ paused: true }, {}]
    ] as [Partial<JobRun>, Partial<Job>][])
      expect(outcomeOf(gone(r, j), 'run_1')).toBe('running')
  })

  it('stops counting as running in the Jobs list projection', () => {
    const s = gone({ pr })
    expect(snapshotFor(s, PROJ, () => true, [], () => null, () => true).runs[0].outcome).toBe('completed')
  })
})

describe('a Run that finished with blocked Tasks, and one in its final check', () => {
  const NOW = '2026-10-18T00:00:00.000Z'
  const at = (id: string, over: Partial<Task> = {}): Task => ({ ...task(id, 'completed'), runId: 'run_1', ...over })
  /** A planned Job that replans (replan.ts replanOn), with one Run */
  const planned = (tasks: Task[], job: Partial<Job> = {}, run: Partial<JobRun> = {}): OrchState => ({
    ...emptyState(),
    jobs: [{ id: 'job_1', objective: 'o', cwd: PROJ, createdAt: NOW, autoDispatch: true, coordinatorAccountId: 'acc', plannerSessionIds: ['ses_p'], ...job }],
    runs: [{ id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: NOW, ...run }],
    tasks
  })
  const settled = { lastReplan: { runId: 'run_1', mode: 'completion' as const, wave: 2, done: 2, at: NOW, summary: 'nothing to add' } }
  // h is held for the owner (blocked, no Gate); d waits on it; c completed
  const held = [at('c'), at('h', { status: 'blocked', result: "Waiting on the owner's decision: drop the table?" }), at('d', { status: 'pending', deps: ['h'] })]

  it('reads blocked once every other Task ended, never running or completed', () => {
    expect(outcomeOf(planned(held), 'run_1')).toBe('blocked')
    // a Task still at work keeps it running
    expect(outcomeOf(planned([...held, at('w', { status: 'ready' })]), 'run_1')).toBe('running')
    // a failure still wins: the person has a failed Task to look at
    expect(outcomeOf(planned([...held, { ...at('f', { status: 'failed' }), consecutiveFailures: FAILURE_LIMIT }]), 'run_1')).toBe('failed')
  })

  it('reads running again once the owner releases the Task (task-update --status ready)', () => {
    const released = held.map((t) => (t.id === 'h' ? { ...t, status: 'ready' as const } : t))
    expect(outcomeOf(planned(released), 'run_1')).toBe('running')
  })

  it('reads checking while every Task completed and the final check has not settled, then completed', () => {
    const done = [at('a'), at('b', { deps: ['a'] })]
    expect(outcomeOf(planned(done), 'run_1')).toBe('checking')
    expect(outcomeOf(planned(done, { replanning: { runId: 'run_1', mode: 'completion', wave: 2, done: 2, startedAt: NOW } }), 'run_1')).toBe('checking')
    expect(outcomeOf(planned(done, settled), 'run_1')).toBe('completed')
    // the check added a Task: running again
    expect(outcomeOf(planned([...done, at('f', { status: 'ready' })], settled), 'run_1')).toBe('running')
    // a plan that does not replan, or one already delivered, has no check to wait for
    expect(outcomeOf(planned(done, { replan: 'off' }), 'run_1')).toBe('completed')
    expect(outcomeOf(planned(done, {}, { pr: { at: NOW, url: 'https://github.com/o/r/pull/1' } }), 'run_1')).toBe('completed')
  })

  it('counts a Run in its final check as work in flight for host stop, and a finished-with-blocked one not', () => {
    const done = [at('a'), at('b', { deps: ['a'] })]
    expect(runningRunCount(planned(done, {}, { coordinatorSessionId: 'ses_c' }))).toBe(1)
    expect(runningRunCount(planned(held, {}, { coordinatorSessionId: 'ses_c' }))).toBe(0)
  })
})

// T8 (decision 7): a running Run with nothing that can move reads needs-you or stalled, never plain running
describe('stuckOf', () => {
  const NOW = '2026-10-22T00:00:00.000Z'
  const at = (id: string, over: Partial<Task> = {}): Task => ({ ...task(id, 'completed'), runId: 'run_1', ...over })
  const stateOf = (tasks: Task[], over: Partial<OrchState> = {}, runOver: Partial<JobRun> = {}): OrchState => ({
    ...emptyState(),
    jobs: [{ id: 'job_1', objective: 'o', cwd: PROJ, createdAt: NOW, autoDispatch: true }],
    runs: [{ id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: NOW, ...runOver }],
    tasks,
    ...over
  })
  const gate = { id: 'gat_1', runId: 'run_1', taskId: 'g', question: 'Drop the table?', status: 'open' as const, createdAt: NOW }
  const stuck = (s: OrchState): ReturnType<typeof stuckOf> => stuckOf(s, s.runs[0])

  it('a Run with one Task blocked on an unanswered Gate, and the rest behind it, needs you', () => {
    const s = stateOf([at('c'), at('g', { status: 'blocked' }), at('p', { status: 'pending', deps: ['g'] })], { gates: [gate] })
    expect(outcomeOf(s, 'run_1')).toBe('running')
    expect(stuck(s)).toBe('needs-you')
    // with a coordinator too: the Gate is still the owner's to answer
    expect(stuck({ ...s, runs: [{ ...s.runs[0], coordinatorSessionId: 'ses_c' }] })).toBe('needs-you')
  })

  it('a failed Task with retries left, no retry and no coordinator, is stalled', () => {
    const s = stateOf([at('c'), at('f', { status: 'failed', consecutiveFailures: 1 }), at('p', { status: 'pending', deps: ['f'] })])
    expect(outcomeOf(s, 'run_1')).toBe('running')
    expect(stuck(s)).toBe('stalled')
  })

  it('is running while something can move', () => {
    const failed = at('f', { status: 'failed', consecutiveFailures: 1 })
    // a coordinator retries failed Tasks (worker-start --retry-of)
    expect(stuck(stateOf([failed], {}, { coordinatorSessionId: 'ses_c' }))).toBeUndefined()
    // a ready Task the app places
    expect(stuck(stateOf([failed, at('r', { status: 'ready' })]))).toBeUndefined()
    // an open Dispatch
    const working = at('w', { status: 'dispatched' })
    const d: Dispatch = { ...open('d1', 'w') }
    expect(stuck(stateOf([failed, working], { dispatches: [d] }))).toBeUndefined()
    // a planner replanning it
    const s = stateOf([failed])
    expect(stuck({ ...s, jobs: [{ ...s.jobs[0], replanning: { runId: 'run_1', mode: 'completion', wave: 1, done: 0, startedAt: NOW } }] })).toBeUndefined()
    // a Run that ended reads its own outcome
    expect(stuck(stateOf([at('c')]))).toBeUndefined()
  })

  it('a Run with no Tasks and nobody to make any is stalled, never plain running', () => {
    const s = stateOf([])
    expect(outcomeOf(s, 'run_1')).toBe('running')
    expect(stuck(s)).toBe('stalled')
    // a coordinator, a replan, a coordinator start in flight or an archived plan is not a dead one
    expect(stuck({ ...s, runs: [{ ...s.runs[0], coordinatorSessionId: 'ses_c' }] })).toBeUndefined()
    expect(stuck({ ...s, runs: [{ ...s.runs[0], coordinatorStartingAt: new Date().toISOString() }] })).toBeUndefined()
    expect(stuck({ ...s, jobs: [{ ...s.jobs[0], replanning: { runId: 'run_1', mode: 'completion', wave: 1, done: 0, startedAt: NOW } }] })).toBeUndefined()
    expect(stuck({ ...s, jobs: [{ ...s.jobs[0], archivedAt: NOW }] })).toBeUndefined()
  })

  it('a worker waiting on its own unanswered question, with no coordinator to answer it, needs you', () => {
    const d: Dispatch = { ...open('d1', 'w') }
    const q = { id: 'msg_q', runId: 'run_1', type: 'question' as const, taskId: 'w', dispatchId: 'd1', subject: 'which?', body: 'which?', createdAt: NOW, answered: false }
    const s = stateOf([at('w', { status: 'dispatched' })], { dispatches: [d], messages: [q] as OrchState['messages'] })
    expect(stuck(s)).toBe('needs-you')
    expect(stuck({ ...s, runs: [{ ...s.runs[0], coordinatorSessionId: 'ses_c' }] })).toBeUndefined()
  })
})

