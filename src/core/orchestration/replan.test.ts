// W6-D wave replanning: waves, the wave gate, when a replan is due, and the edits a replan may make.
import { describe, it, expect } from 'vitest'
import { emptyState, type OrchState } from './state'
import type { Dispatch, Job, Task } from './types'
import { cancelRemainingTask, completionSettled, editRemainingTask, notStarted, replanOn, replansDue, waveOf, waveOpen } from './replan'
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
  // a (wave 0) still runs; c (wave 0) is done; b waits only on c, so it is ready, but it is wave 1
  const tasks = [task('a', { status: 'dispatched' }), task('c', { status: 'completed' }), task('b', { deps: ['c'] })]

  it('keeps a later wave shut until every earlier Task has completed', () => {
    const s = state(tasks, {}, [open('a')])
    expect(waveOpen(s.tasks[2], s)).toBe(false)
    expect(slotsToFill(s).map((x) => x.taskId)).toEqual([])
    const allDone = tasks.map((t) => (t.id === 'a' ? { ...t, status: 'completed' as const } : t))
    // wave 0 is done, but the boundary has not been replanned yet
    const due = state(allDone)
    expect(waveOpen(due.tasks[2], due)).toBe(false)
    const done = state(allDone, { lastReplan: { runId: 'run_1', mode: 'wave', wave: 1, done: 2, at: NOW, summary: 'no change' } })
    expect(waveOpen(done.tasks[2], done)).toBe(true)
    expect(slotsToFill(done).map((x) => x.taskId)).toEqual(['b'])
  })

  it('does not gate a Job with replanning off', () => {
    const s = state(tasks, { replan: 'off' }, [open('a')])
    expect(slotsToFill(s).map((x) => x.taskId)).toEqual(['b'])
  })

  it('shuts every wave while a replan runs', () => {
    const s = state([task('a')], { replanning: { runId: 'run_1', mode: 'wave', wave: 1, done: 0, startedAt: NOW } })
    expect(waveOpen(s.tasks[0], s)).toBe(false)
  })
})

describe('replansDue', () => {
  const seen = () => true
  it('asks once at a wave boundary, when the last Task of the wave before completes', () => {
    const running = state([task('a', { status: 'dispatched' }), task('b', { deps: ['a'], status: 'pending' })], {}, [open('a')])
    expect(replansDue(running, seen)).toEqual([])
    const s = state([task('a', { status: 'completed' }), task('b', { deps: ['a'] })])
    expect(replansDue(s, seen)).toEqual([{ runId: 'run_1', mode: 'wave', wave: 1, done: 1 }])
    const after = state(s.tasks, { lastReplan: { runId: 'run_1', mode: 'wave', wave: 1, done: 1, at: NOW, summary: 'no change' } })
    expect(replansDue(after, seen)).toEqual([])
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
    const tasks = [task('a', { status: 'completed' }), task('b', { deps: ['a'] })]
    expect(replansDue(state(tasks, { replan: 'off' }), seen)).toEqual([])
    expect(replansDue(state(tasks, { replanning: { runId: 'run_1', mode: 'wave', wave: 1, done: 1, startedAt: NOW } }), seen)).toEqual([])
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
