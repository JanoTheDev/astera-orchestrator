// W6-D wave replanning: waves, the per-Task gate, when a replan is due, and the edits a replan may make.
import { describe, it, expect } from 'vitest'
import { emptyState, type OrchState } from './state'
import type { Dispatch, Job, JobRun, Task } from './types'
import {
  cancelRemainingTask,
  cancelTaskByOwner,
  completionSettled,
  deviatingTasks,
  editRemainingTask,
  FAILED_WAIT_OPTIONS,
  failedWaitAsked,
  failedWaitChoice,
  failedWaitQuestion,
  notStarted,
  replanOn,
  replansDue,
  resolveFailedWait,
  stallOf,
  waveOf,
  waveOpen
} from './replan'
import { slotsToFill } from './schedule'

const NOW = '2026-10-18T00:00:00.000Z'

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  runId: 'run_1',
  title: id,
  spec: 's',
  deps: [],
  status: 'ready',
  accountIds: ['acc1'],
  consecutiveFailures: 0,
  createdAt: NOW,
  updatedAt: NOW,
  ...over
})

const open = (taskId: string): Dispatch => ({
  id: `dsp_${taskId}`,
  taskId,
  provider: 'claude',
  accountId: 'acc1',
  sessionId: `ses_${taskId}`,
  cwd: '/wt',
  specPath: '/s.md',
  startedAt: NOW,
  workerState: 'ready',
  retained: false
})

/** A planned, app-driven Job with one Run and `tasks`. */
const state = (tasks: Task[], job: Partial<Job> = {}, dispatches: Dispatch[] = []): OrchState => ({
  ...emptyState(),
  jobs: [{ id: 'job_1', objective: 'o', cwd: '/p', createdAt: NOW, autoDispatch: true, concurrency: 5, coordinatorAccountId: 'acc1', plannerSessionIds: ['ses_planner'], ...job }],
  runs: [{ id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: NOW, worktree: '/wt' }],
  tasks,
  dispatches
})

describe('waveOf', () => {
  it('is 0 with no deps and 1 + the highest dep wave otherwise', () => {
    const ts = [task('a'), task('b', { deps: ['a'] }), task('c'), task('d', { deps: ['b', 'c'] })]
    expect(ts.map((t) => waveOf(t, ts))).toEqual([0, 1, 0, 2])
  })

  it('ignores deps outside the list and does not loop on a cycle', () => {
    const ts = [task('a', { deps: ['b', 'gone'] }), task('b', { deps: ['a'] })]
    expect(waveOf(task('x', { deps: ['gone'] }), ts)).toBe(0)
    expect(() => waveOf(ts[0], ts)).not.toThrow()
  })
})

describe('replanOn', () => {
  it('needs a planned, unscheduled Job with an account, and not replan off', () => {
    const job = state([]).jobs[0]
    expect(replanOn(job)).toBe(true)
    expect(replanOn({ ...job, replan: 'off' })).toBe(false)
    expect(replanOn({ ...job, plannerSessionIds: undefined })).toBe(false)
    expect(replanOn({ ...job, coordinatorAccountId: undefined })).toBe(false)
    expect(replanOn({ ...job, schedule: { kind: 'interval', minutes: 1 } })).toBe(false)
  })
})

describe('waveOpen and slotsToFill', () => {
  // a (wave 0) is still in review (its reviewer runs); c (wave 0) completed as planned; b (wave 1) waits on c; w (wave 2) waits on b2,
  // which waits on c and is completed as planned too
  const tasks = [
    task('a', { status: 'dispatched' }),
    task('c', { status: 'completed' }),
    task('b', { deps: ['c'] }),
    task('b2', { deps: ['c'], status: 'completed' }),
    task('w', { deps: ['b2'] })
  ]
  const byId = (s: OrchState, id: string) => s.tasks.find((t) => t.id === id)!

  it('opens a Task once its own upstream completed as planned, while an unrelated wave-0 Task is in review', () => {
    const inReview = tasks.map((t) => (t.id === 'a' ? { ...t, status: 'reviewing' as const } : t))
    const s = state(inReview, {}, [{ ...open('a'), review: true }])
    expect(waveOf(byId(s, 'w'), s.tasks)).toBe(2)
    expect(waveOpen(byId(s, 'w'), s)).toBe(true)
    expect(waveOpen(byId(s, 'b'), s)).toBe(true)
    expect(slotsToFill(s).map((x) => x.taskId).sort()).toEqual(['b', 'w'])
    expect(replansDue(s, () => true)).toEqual([])
  })

  it('keeps a Task shut while something it waits on is unfinished', () => {
    const s = state([task('a', { status: 'dispatched' }), task('b', { deps: ['a'], status: 'ready' })], {}, [open('a')])
    expect(waveOpen(s.tasks[1], s)).toBe(false)
  })

  it('does not gate a Job with replanning off', () => {
    const s = state([task('c', { status: 'completed', affectedPaths: ['src/c'], filesModified: ['src/x'] }), task('b', { deps: ['c'] })], { replan: 'off' })
    expect(slotsToFill(s).map((x) => x.taskId)).toEqual(['b'])
  })

  it('shuts every Task while an unscoped replan runs (owner feedback, the final check, a person\'s ask)', () => {
    const s = state([task('a')], { replanning: { runId: 'run_1', mode: 'wave', wave: 1, done: 0, startedAt: NOW } })
    expect(waveOpen(s.tasks[0], s)).toBe(false)
  })
})

describe('a Task that deviated', () => {
  const seen = () => true
  const LATER = '2026-10-18T01:00:00.000Z'
  // d completed outside its paths; x builds on d; p shares d's path; u is unrelated; y builds on x
  const tasks = [
    task('d', { status: 'completed', affectedPaths: ['src/d'], filesModified: ['src/d', 'src/shared'] }),
    task('x', { deps: ['d'] }),
    task('p', { affectedPaths: ['src/shared'] }),
    task('u', { affectedPaths: ['src/u'] }),
    task('y', { deps: ['x'], status: 'pending' })
  ]
  const byId = (s: OrchState, id: string) => s.tasks.find((t) => t.id === id)!

  it('holds the not-started Tasks downstream of it or sharing its paths, and asks for a replan', () => {
    const s = state(tasks)
    expect(waveOpen(byId(s, 'x'), s)).toBe(false)
    expect(waveOpen(byId(s, 'p'), s)).toBe(false)
    expect(waveOpen(byId(s, 'u'), s)).toBe(true)
    expect(slotsToFill(s).map((x) => x.taskId)).toEqual(['u'])
    expect(replansDue(s, seen)).toEqual([{ runId: 'run_1', mode: 'wave', wave: 0, done: 1 }])
  })

  it('a scoped replan holds only those Tasks: the rest of the Job is still placed', () => {
    const s = state(tasks, { replanning: { runId: 'run_1', mode: 'wave', wave: 1, done: 1, startedAt: LATER, scoped: true } as Job['replanning'] })
    expect(slotsToFill(s).map((x) => x.taskId)).toEqual(['u'])
    expect(replansDue(s, seen)).toEqual([])
  })

  it('lets them go once a replan that began after it completed has ended', () => {
    const ended = { runId: 'run_1', mode: 'wave' as const, wave: 1, done: 1, at: LATER, summary: 'no change' }
    const s = state(tasks, { lastReplan: { ...ended, startedAt: LATER } as Job['lastReplan'] })
    expect(slotsToFill(s).map((x) => x.taskId).sort()).toEqual(['p', 'u', 'x'])
    expect(replansDue(s, seen)).toEqual([])
    // a record from before `startedAt` existed: its end stands in
    const old = state(tasks, { lastReplan: ended })
    expect(waveOpen(byId(old, 'x'), old)).toBe(true)
  })

  it('still holds them when it completed while that replan ran, and asks again', () => {
    const s = state(
      tasks.map((t) => (t.id === 'd' ? { ...t, updatedAt: '2026-10-18T00:30:00.000Z' } : t)),
      { lastReplan: { runId: 'run_1', mode: 'wave', wave: 1, done: 1, at: LATER, summary: 'no change', startedAt: NOW } as Job['lastReplan'] }
    )
    expect(waveOpen(byId(s, 'x'), s)).toBe(false)
    expect(replansDue(s, seen)).toHaveLength(1)
  })

  it('does not hold a Task that already ran once, and asks nothing when nothing left can be affected', () => {
    const ran = state([tasks[0], task('x', { deps: ['d'] })], {}, [{ ...open('x'), outcome: 'failed', endedAt: NOW }])
    expect(waveOpen(ran.tasks[1], ran)).toBe(true)
    expect(replansDue(ran, seen)).toEqual([])
  })
})

describe('replansDue', () => {
  const seen = () => true
  it('asks nothing while the plan goes as planned', () => {
    const s = state([task('a', { status: 'completed' }), task('b', { deps: ['a'] })])
    expect(replansDue(s, seen)).toEqual([])
  })

  it('T36: a completed Task with gaps did not go as planned, so it asks for a replan of what depends on it', () => {
    const s = state([task('a', { status: 'completed', gaps: 'could not run e2e' }), task('b', { deps: ['a'] })])
    expect(replansDue(s, seen)).toHaveLength(1)
  })

  it('asks for the final check once every Task completed, only for a Run it saw running, once per done count', () => {
    const s = state([task('a', { status: 'completed' }), task('b', { deps: ['a'], status: 'completed' })])
    expect(replansDue(s, () => false)).toEqual([])
    expect(replansDue(s, seen)).toEqual([{ runId: 'run_1', mode: 'completion', wave: 2, done: 2 }])
    const checked = state(s.tasks, { lastReplan: { runId: 'run_1', mode: 'completion', wave: 2, done: 2, at: NOW, summary: 'done' } })
    expect(replansDue(checked, seen)).toEqual([])
    // a follow-up Task it added has completed: checked again
    const followed = state([...s.tasks, task('f', { status: 'completed' })], checked.jobs[0])
    expect(replansDue(followed, seen)).toEqual([{ runId: 'run_1', mode: 'completion', wave: 2, done: 3 }])
  })

  it('does nothing while a replan runs, or with replanning off', () => {
    const tasks = [task('a', { status: 'completed', completionOverride: { at: NOW, reason: 'r' } }), task('b', { deps: ['a'] })]
    expect(replansDue(state(tasks), seen)).toHaveLength(1)
    expect(replansDue(state(tasks, { replan: 'off' }), seen)).toEqual([])
    expect(replansDue(state(tasks, { replanning: { runId: 'run_1', mode: 'wave', wave: 1, done: 1, startedAt: NOW } }), seen)).toEqual([])
  })
})

describe('a failed Task', () => {
  const seen = () => true
  // f failed in wave 0; c completed. b waits on c only, d waits on f, e waits on d (so on f too), g waits on b.
  const tasks = [
    task('f', { status: 'failed' }),
    task('c', { status: 'completed' }),
    task('b', { deps: ['c'] }),
    task('d', { deps: ['f'], status: 'pending' }),
    task('e', { deps: ['d'], status: 'pending' }),
    task('g', { deps: ['b'], status: 'pending' })
  ]
  const byId = (s: OrchState, id: string) => s.tasks.find((t) => t.id === id)!

  it('T36: holding back not-started Tasks with no coordinator to retry it, it asks for a scoped replan of those', () => {
    expect(replansDue(state(tasks), seen)).toEqual([{ runId: 'run_1', mode: 'wave', wave: 1, done: 1 }])
    expect(deviatingTasks(state(tasks), state(tasks).jobs[0], 'run_1').map((t) => t.id)).toEqual(['f'])
  })

  it('T36: with a coordinator it waits for that coordinator to retry, until its tries are used up', () => {
    const withCoordinator = (ts: Task[]): OrchState => {
      const s = state(ts)
      return { ...s, runs: s.runs.map((r) => ({ ...r, coordinatorSessionId: 'ses_coord' })) }
    }
    expect(replansDue(withCoordinator(tasks), seen)).toEqual([])
    const spent = tasks.map((t) => (t.id === 'f' ? { ...t, consecutiveFailures: 3 } : t))
    expect(replansDue(withCoordinator(spent), seen)).toEqual([{ runId: 'run_1', mode: 'wave', wave: 1, done: 1 }])
  })

  it('T36: once a replan that began after it failed has ended, it asks for none again', () => {
    const after = { lastReplan: { runId: 'run_1', mode: 'wave' as const, wave: 1, done: 1, at: '2026-10-18T00:10:00.000Z', summary: 'no change', startedAt: '2026-10-18T00:05:00.000Z' } }
    expect(replansDue(state(tasks, after), seen)).toEqual([])
  })

  it('lets a Task that does not depend on it start, and keeps one that does waiting', () => {
    const s = state(tasks)
    expect(waveOpen(byId(s, 'b'), s)).toBe(true)
    expect(waveOpen(byId(s, 'd'), s)).toBe(false)
    expect(slotsToFill(s).map((x) => x.taskId)).toEqual(['b'])
  })

  it('does not hold a later Task on another branch', () => {
    const next = tasks.map((t) => (t.id === 'b' ? { ...t, status: 'completed' as const } : t.id === 'g' ? { ...t, status: 'ready' as const } : t))
    const s = state(next)
    expect(waveOpen(byId(s, 'g'), s)).toBe(true)
    expect(waveOpen(byId(s, 'e'), s)).toBe(false)
  })

  it('asks for no final check while the plan has a failed Task', () => {
    const rest = [task('f', { status: 'failed' }), task('c', { status: 'completed' }), task('b', { deps: ['c'], status: 'completed' })]
    expect(replansDue(state(rest), seen)).toEqual([])
  })
})

describe('T36: a Run stalled on a failed Task', () => {
  const LATER = '2026-10-18T00:30:00.000Z'
  // f failed (its worker reported failed); d and e wait on it; c completed
  const tasks = [
    task('f', { status: 'failed', consecutiveFailures: 1, result: 'made 19 of the screens; gaps: settings, login' }),
    task('c', { status: 'completed' }),
    task('d', { deps: ['f'], status: 'pending' }),
    task('e', { deps: ['d'], status: 'pending' })
  ]
  const off = { replan: 'off' as const, title: 'Before shots' }
  const run = (s: OrchState) => s.runs[0]

  it('is stalled when nothing else can move: the reason names the failed Task and what waits on it', () => {
    const st = stallOf(state(tasks, off), run(state(tasks, off)))
    expect(st?.reason).toBe('waiting on f (f) (failed): 2 Task(s) wait on it')
    expect(st?.blocks.map((b) => [b.task.id, b.waiting.map((t) => t.id)])).toEqual([['f', ['d', 'e']]])
  })

  it('is not stalled while something else moves or someone holds it', () => {
    const s = state(tasks, off)
    const other = state([...tasks, task('x')], off)
    expect(stallOf(other, run(other))).toBeUndefined()
    expect(stallOf({ ...s, runs: [{ ...run(s), paused: true }] }, { ...run(s), paused: true })).toBeUndefined()
    expect(stallOf({ ...s, runs: [{ ...run(s), coordinatorSessionId: 'ses_c' }] }, { ...run(s), coordinatorSessionId: 'ses_c' })).toBeUndefined()
    expect(stallOf(state(tasks, { ...off, dispatchHold: true }), run(s))).toBeUndefined()
    expect(stallOf({ ...s, gates: [{ id: 'g', runId: 'run_1', taskId: 'd', question: 'q', status: 'open', createdAt: NOW }] }, run(s))).toBeUndefined()
    expect(stallOf(state(tasks, off, [{ ...open('f') }]), run(s))).toBeUndefined()
    // nothing waits on the failure: the Run ended, it did not stall
    const alone = state([task('f', { status: 'failed' }), task('c', { status: 'completed' })], off)
    expect(stallOf(alone, run(alone))).toBeUndefined()
  })

  it('is stalled with a failed leaf Task that has tries left: nothing retries it without a coordinator', () => {
    // x failed once (tries left), nothing waits on it; f holds back d and e
    const s = state([...tasks, task('x', { status: 'failed', consecutiveFailures: 1 })], off)
    expect(stallOf(s, run(s))?.reason).toBe('waiting on f (f) (failed): 2 Task(s) wait on it')
  })

  it('stays stalled while its own question is open, and asks once per failure', () => {
    const s = state(tasks, off)
    const block = stallOf(s, run(s))!.blocks[0]
    const q = failedWaitQuestion(s, block, LATER)
    expect(q).toMatchObject({ type: 'escalation', runId: 'run_1', taskId: 'f', options: [...FAILED_WAIT_OPTIONS], answered: false })
    expect(q.subject).toBe('Before shots: 2 Tasks wait on failed f: made 19 of the screens; gaps: settings, login')
    const asked = { ...s, messages: [q] }
    expect(failedWaitAsked(s, block.task)).toBe(false)
    expect(failedWaitAsked(asked, block.task)).toBe(true)
    expect(stallOf(asked, run(s))).toBeDefined()
    // failed again after a retry: a new failure, a new question
    expect(failedWaitAsked(asked, { ...block.task, updatedAt: '2026-10-18T01:00:00.000Z' })).toBe(false)
  })

  it("reads the owner's answer, a hands-off one too", () => {
    const s = state(tasks, off)
    const f = s.tasks[0]
    const q = failedWaitQuestion(s, stallOf(s, run(s))!.blocks[0], LATER)
    expect(failedWaitChoice({ ...s, messages: [q] }, f)).toBeUndefined()
    expect(failedWaitChoice({ ...s, messages: [{ ...q, answered: true, answerBody: 'Accept as done' }] }, f)).toBe('accept')
    expect(failedWaitChoice({ ...s, messages: [{ ...q, answered: true, answerBody: 'retry. Why: a flaky run' }] }, f)).toBe('retry')
    expect(failedWaitChoice({ ...s, messages: [{ ...q, answered: true, answerBody: 'something else' }] }, f)).toBeUndefined()
  })

  it('retry: ready again with its tries reset and a changed spec; its question answered', () => {
    const s = state(tasks, off)
    const q = failedWaitQuestion(s, stallOf(s, run(s))!.blocks[0], LATER)
    const r = resolveFailedWait({ ...s, messages: [q] }, 'f', 'retry', LATER, { patch: { spec: 'only the missing screens' } })
    expect(r.ok && r.value).toMatchObject({ status: 'ready', consecutiveFailures: 0, spec: 'only the missing screens' })
    expect(r.ok && r.state.messages[0]).toMatchObject({ answered: true, answerBody: 'Retry' })
    expect(r.ok && stallOf(r.state, run(r.state))).toBeUndefined()
  })

  it('accept: done with its gaps recorded, and what waits on it is ready', () => {
    const r = resolveFailedWait(state(tasks, off), 'f', 'accept', LATER, { reason: 'the 19 screens are enough' })
    expect(r.ok && r.value).toMatchObject({ status: 'completed', completionOverride: { reason: 'the 19 screens are enough', at: LATER } })
    expect(r.ok && r.state.tasks.find((t) => t.id === 'd')?.status).toBe('ready')
  })

  it('cancel: what waits on it leaves the Run, leaves first, and the Run ends failed', () => {
    const r = resolveFailedWait(state(tasks, off), 'f', 'cancel', LATER)
    expect(r.ok && r.state.tasks.map((t) => t.id)).toEqual(['f', 'c'])
    expect(r.ok && r.value.consecutiveFailures).toBe(3)
    expect(r.ok && stallOf(r.state, run(r.state))).toBeUndefined()
  })

  it('refuses a Task that is not failed', () => {
    expect(resolveFailedWait(state(tasks, off), 'c', 'retry', LATER)).toMatchObject({ ok: false })
    expect(resolveFailedWait(state(tasks, off), 'nope', 'retry', LATER)).toMatchObject({ ok: false, missing: true })
  })
})

describe('a Task held for its owner (item 2: a hands-off plan refused the decision it needs)', () => {
  const seen = () => true
  // h is blocked with no Gate (held) in wave 0; c completed. b waits on c only, d waits on h, e waits on d.
  const tasks = [
    task('h', { status: 'blocked', result: "Waiting on the owner's decision: run the protected migration?" }),
    task('c', { status: 'completed' }),
    task('b', { deps: ['c'] }),
    task('d', { deps: ['h'], status: 'pending' }),
    task('e', { deps: ['d'], status: 'pending' })
  ]
  const at = (wave: number) => ({ lastReplan: { runId: 'run_1', mode: 'wave' as const, wave, done: 1, at: NOW, summary: 'no change' } })
  const byId = (s: OrchState, id: string) => s.tasks.find((t) => t.id === id)!

  it('holds back only its dependents: the Tasks that do not depend on it open, and no replan is due', () => {
    expect(replansDue(state(tasks), seen)).toEqual([])
    const s = state(tasks)
    expect(waveOpen(byId(s, 'b'), s)).toBe(true)
    expect(slotsToFill(s).map((x) => x.taskId)).toEqual(['b'])
  })

  it('skips its dependents: they hold no later boundary', () => {
    const next = tasks.map((t) => (t.id === 'b' ? { ...t, status: 'completed' as const } : t))
    expect(waveOpen(byId(state(next, at(1)), 'd'), state(next, at(1)))).toBe(false)
    // only h's dependents are left: nothing is due, and no final check while a Task is held
    expect(replansDue(state(next, at(1)), seen)).toEqual([])
  })

  it('waits on an open Gate instead: still only its dependents wait', () => {
    const s: OrchState = { ...state(tasks), gates: [{ id: 'gat_1', runId: 'run_1', taskId: 'h', question: 'q', status: 'open', createdAt: NOW }] }
    expect(replansDue(s, seen)).toEqual([])
    expect(waveOpen(byId(s, 'b'), s)).toBe(true)
    expect(waveOpen(byId(s, 'd'), s)).toBe(false)
  })
})

describe('completionSettled', () => {
  const tasks = [task('a', { status: 'completed' })]
  it('waits for a final check over these completed Tasks, and for a person who holds an escalated one', () => {
    expect(completionSettled(state(tasks), state(tasks).jobs[0], 'run_1')).toBe(false)
    const mark = { runId: 'run_1', mode: 'completion' as const, wave: 1, done: 1, at: NOW, summary: 'done' }
    const s = state(tasks, { lastReplan: mark })
    expect(completionSettled(s, s.jobs[0], 'run_1')).toBe(true)
    const held = state(tasks, { lastReplan: { ...mark, escalated: 'why' }, dispatchHold: true })
    expect(completionSettled(held, held.jobs[0], 'run_1')).toBe(false)
    const off = state(tasks, { replan: 'off' })
    expect(completionSettled(off, off.jobs[0], 'run_1')).toBe(true)
  })
})

describe('editRemainingTask / cancelRemainingTask', () => {
  const tasks = [task('a', { status: 'completed' }), task('r', { status: 'dispatched' }), task('b', { deps: ['a'] }), task('c', { deps: ['b'], status: 'pending' })]
  const s = state(tasks, {}, [open('r')])

  it('edits a Task that has not started, and never a completed or running one', () => {
    expect(editRemainingTask(s, 'a', { prompt: 'x' }, NOW).ok).toBe(false)
    expect(editRemainingTask(s, 'r', { prompt: 'x' }, NOW).ok).toBe(false)
    const r = editRemainingTask(s, 'b', { prompt: 'new', deps: ['a', 'r'] }, NOW)
    expect(r.ok && r.value).toMatchObject({ prompt: 'new', status: 'pending' })
  })

  it('refuses deps outside the Run and a cycle', () => {
    expect(editRemainingTask(s, 'b', { deps: ['elsewhere'] }, NOW).ok).toBe(false)
    expect(editRemainingTask(s, 'b', { deps: ['c'] }, NOW).ok).toBe(false)
  })

  // T3: a cross-plan dep, as task-create allows. Plan job_2 (same project) holds x1; job_3 is another project's.
  const withOthers = (x1: Partial<Task> = {}, delivery?: JobRun['delivery']): OrchState => ({
    ...s,
    jobs: [
      ...s.jobs,
      { id: 'job_2', objective: 'o', cwd: '/p', createdAt: NOW, autoDispatch: true, concurrency: 5 },
      { id: 'job_3', objective: 'o', cwd: '/q', createdAt: NOW, autoDispatch: true, concurrency: 5 }
    ],
    runs: [...s.runs, { id: 'run_2', jobId: 'job_2', ordinal: 1, createdAt: NOW, ...(delivery ? { delivery } : {}) }, { id: 'run_3', jobId: 'job_3', ordinal: 1, createdAt: NOW }],
    tasks: [...s.tasks, task('x1', { runId: 'run_2', status: 'completed', ...x1 }), task('y1', { runId: 'run_3', status: 'dispatched' })]
  })

  it('takes a dep on a Task of another plan of the project, and keeps the Task pending until that plan delivers', () => {
    const held = editRemainingTask(withOthers(), 'b', { deps: ['a', 'x1'] }, NOW)
    expect(held.ok && held.value).toMatchObject({ deps: ['a', 'x1'], status: 'pending' })
    const landed = editRemainingTask(withOthers({}, { sha: 'abc' } as JobRun['delivery']), 'b', { deps: ['a', 'x1'] }, NOW)
    expect(landed.ok && landed.value).toMatchObject({ status: 'ready' })
  })

  it('refuses a dep on another project’s Task, an unknown one and a cycle across plans', () => {
    const other = editRemainingTask(withOthers(), 'b', { deps: ['y1'] }, NOW)
    expect(!other.ok && other.error).toMatch(/another project/)
    expect(editRemainingTask(withOthers(), 'b', { deps: ['nope'] }, NOW).ok).toBe(false)
    const looped = withOthers()
    looped.tasks = looped.tasks.map((t) => (t.id === 'x1' ? { ...t, status: 'pending' as const, deps: ['b'] } : t))
    const cycle = editRemainingTask(looped, 'b', { deps: ['x1'] }, NOW)
    expect(!cycle.ok && cycle.error).toMatch(/wait on itself/)
  })

  it('cancels a Task nothing unfinished waits on', () => {
    expect(cancelRemainingTask(s, 'b').ok).toBe(false)
    expect(cancelRemainingTask(s, 'r').ok).toBe(false)
    const r = cancelRemainingTask(s, 'c')
    expect(r.ok && r.state.tasks.map((t) => t.id)).toEqual(['a', 'r', 'b'])
  })
})

// W8-E (#95): the coordinator's Gate on a Task it never started does not keep the replan from changing it
describe('a Task blocked by a Gate before it ran', () => {
  const gated = state([task('a', { status: 'completed' }), task('p6', { deps: ['a'], status: 'blocked' }), task('ran', { status: 'blocked' })], {}, [
    { ...open('ran'), outcome: 'failed', endedAt: NOW }
  ])
  const withGates: OrchState = {
    ...gated,
    gates: [
      { id: 'g1', runId: 'run_1', taskId: 'p6', question: 'Release the hold?', status: 'open', createdAt: NOW },
      { id: 'g2', runId: 'run_1', taskId: 'ran', question: 'Retry?', status: 'open', createdAt: NOW }
    ]
  }

  it('counts as not started; one that had a worker does not', () => {
    expect(notStarted(withGates, withGates.tasks[1])).toBe(true)
    expect(notStarted(withGates, withGates.tasks[2])).toBe(false)
  })

  it('a replan edits it and it stays blocked for its Gate to unblock', () => {
    const r = editRemainingTask(withGates, 'p6', { prompt: 'adjusted' }, NOW)
    expect(r.ok && r.value).toMatchObject({ prompt: 'adjusted', status: 'blocked' })
  })

  it('a replan cancels it, and its open Gate goes with it', () => {
    const r = cancelRemainingTask(withGates, 'p6')
    expect(r.ok && r.state.gates.map((g) => g.id)).toEqual(['g2'])
  })
})

// T5: the owner cancels any Task of a Run that has not completed, started or not
describe('cancelTaskByOwner', () => {
  const base = (): OrchState => ({
    ...state(
      [task('a', { status: 'completed' }), task('r', { status: 'dispatched', deps: ['a'] }), task('m', { status: 'merging' }), task('c', { status: 'pending', deps: ['r'] })],
      {},
      [open('r')]
    ),
    gates: [{ id: 'g1', runId: 'run_1', taskId: 'r', question: 'Retry?', status: 'open', createdAt: NOW }],
    messages: [
      { id: 'q1', runId: 'run_1', type: 'question', taskId: 'r', dispatchId: 'dsp_r', subject: 'which?', body: '?', answered: false, createdAt: NOW },
      { id: 'q2', runId: 'run_1', type: 'question', taskId: 'a', dispatchId: 'dsp_a', subject: 'other', body: '?', answered: false, createdAt: NOW }
    ]
  })
  const lastLeft = (s: OrchState): OrchState => ({ ...s, tasks: s.tasks.filter((t) => t.id !== 'c') })

  it('closes the open Dispatch, settles its questions, drops its Gates and the Task, and says so in the Run', () => {
    const r = cancelTaskByOwner(lastLeft(base()), 'r', 'replaced by r2', NOW)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.tasks.map((t) => t.id)).toEqual(['a', 'm'])
    expect(r.state.gates).toEqual([])
    expect(r.state.dispatches).toEqual([expect.objectContaining({ id: 'dsp_r', workerState: 'stopped', endedAt: NOW, closedBy: 'stop' })])
    expect(r.state.messages.find((m) => m.id === 'q1')).toMatchObject({ answered: true, answerBody: '' })
    expect(r.state.messages.find((m) => m.id === 'q2')?.answered).toBe(false)
    expect(r.state.messages.at(-1)).toMatchObject({ runId: 'run_1', type: 'status', subject: 'r cancelled by the owner: replaced by r2' })
    expect(r.value.closed.map((d) => d.id)).toEqual(['dsp_r'])
  })

  it('cancels a Task that has not started, and a failed one, with nothing to close', () => {
    const s = state([task('f', { status: 'failed' }), task('p', { status: 'pending' })])
    for (const id of ['f', 'p']) {
      const r = cancelTaskByOwner(s, id, 'no longer needed', NOW)
      expect(r.ok && r.value.closed).toEqual([])
    }
  })

  it('refuses a completed or merging Task', () => {
    for (const id of ['a', 'm']) {
      const r = cancelTaskByOwner(lastLeft(base()), id, 'x', NOW)
      expect(!r.ok && r.error).toMatch(/completed|merging/)
    }
  })

  it('refuses while an unfinished Task depends on it, but not a completed one', () => {
    const r = cancelTaskByOwner(base(), 'r', 'x', NOW)
    expect(!r.ok && r.error).toBe('c depend on r: change their --deps first')
    const done = { ...base(), tasks: base().tasks.map((t) => (t.id === 'c' ? { ...t, status: 'completed' as const } : t)) }
    expect(cancelTaskByOwner(done, 'r', 'x', NOW).ok).toBe(true)
  })

  it('refuses an unknown Task', () => {
    const r = cancelTaskByOwner(base(), 'nope', 'x', NOW)
    expect(!r.ok && r.missing).toBe(true)
  })
})
