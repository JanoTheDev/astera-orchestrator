import { describe, expect, it } from 'vitest'
import { createMergingWatch, MERGING_WATCH_MS } from './mergingWatch'
import { emptyState, type OrchState } from '../state'
import type { Dispatch, Task } from '../types'
import { makeRepo, gitSync } from '../../worktrees/testRepo'

const T0 = Date.parse('2026-11-01T11:00:00.000Z')
const iso = (ms: number): string => new Date(ms).toISOString()
const task = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  runId: 'run_1',
  jobId: 'job_1',
  title: id,
  spec: 's',
  deps: [],
  status: 'merging',
  consecutiveFailures: 0,
  createdAt: iso(T0),
  updatedAt: iso(T0),
  ...over
})
const worked = (taskId: string, cwd: string, head?: string): Dispatch =>
  ({ id: `dsp_${taskId}`, taskId, provider: 'claude', accountId: 'a', sessionId: 's', cwd, specPath: '', startedAt: iso(T0), endedAt: iso(T0), outcome: 'succeeded', ...(head ? { git: { head } } : {}) }) as Dispatch
const state = (tasks: Task[], dispatches: Dispatch[] = [], runRoot = '/plan'): OrchState => ({
  ...emptyState(),
  jobs: [{ id: 'job_1', objective: 'o', cwd: '/p', createdAt: iso(T0) }],
  runs: [{ id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: iso(T0), worktree: runRoot }],
  tasks,
  dispatches
})

describe('mergingWatch', () => {
  it('a Task merging over 5 minutes whose merge Task completed is due; under 5 minutes it is not', async () => {
    const s = state([task('tsk_A'), task('tsk_M', { parentId: 'tsk_A', status: 'completed' })])
    const watch = createMergingWatch({ merged: async () => false })
    expect(await watch.due(s, T0 + MERGING_WATCH_MS - 1)).toEqual([])
    expect(await watch.due(s, T0 + MERGING_WATCH_MS + 1)).toEqual([
      { runId: 'run_1', taskId: 'tsk_A', runRoot: '/plan', reason: 'its merge task tsk_M completed' }
    ])
  })

  it('a Task merging over 5 minutes whose branch tip is already in the plan branch is due, asked with its recorded head', async () => {
    const asked: unknown[] = []
    const watch = createMergingWatch({ merged: async (a) => (asked.push(a), true) })
    const s = state([task('tsk_A')], [worked('tsk_A', '/wt/a', 'abc123')])
    expect(await watch.due(s, T0 + MERGING_WATCH_MS - 1)).toEqual([])
    expect(asked).toEqual([])
    const due = await watch.due(s, T0 + MERGING_WATCH_MS + 1)
    expect(due.map((d) => d.taskId)).toEqual(['tsk_A'])
    expect(due[0].reason).toContain('already in the plan branch')
    expect(asked).toEqual([{ head: 'abc123', worktree: '/wt/a', runRoot: '/plan' }])
  })

  it('a branch not in the plan branch is not due, and git is asked again only after a minute', async () => {
    let asks = 0
    const watch = createMergingWatch({ merged: async () => (asks++, false) })
    const s = state([task('tsk_A')], [worked('tsk_A', '/wt/a', 'abc123')])
    const at = T0 + MERGING_WATCH_MS + 1
    expect(await watch.due(s, at)).toEqual([])
    expect(await watch.due(s, at + 1_000)).toEqual([])
    expect(asks).toBe(1)
    await watch.due(s, at + 61_000)
    expect(asks).toBe(2)
  })

  it('asks real git: a tip merged into the plan folder is in it, one committed after is not', async () => {
    const repo = await makeRepo('astera-mergingwatch-')
    const tip = gitSync(repo, ['rev-parse', 'HEAD'])
    const s = state([task('tsk_A')], [worked('tsk_A', '/elsewhere', tip)], repo)
    expect((await createMergingWatch().due(s, T0 + MERGING_WATCH_MS + 1)).map((d) => d.taskId)).toEqual(['tsk_A'])
    gitSync(repo, ['-c', 'user.name=F', '-c', 'user.email=f@f', 'commit', '--allow-empty', '-m', 'later'])
    const later = gitSync(repo, ['rev-parse', 'HEAD'])
    gitSync(repo, ['reset', '--hard', 'HEAD~1'])
    const s2 = state([task('tsk_A')], [worked('tsk_A', '/elsewhere', later)], repo)
    expect(await createMergingWatch().due(s2, T0 + MERGING_WATCH_MS + 1)).toEqual([])
  })
})
