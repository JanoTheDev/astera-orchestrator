import { describe, it, expect } from 'vitest'
import { completedWorktrees } from './draftPr'
import type { OrchState } from './state'
import type { Dispatch, JobRun, Task } from './types'

const task = (id: string, over: Partial<Task> = {}): Task => ({ id, runId: 'run_1', status: 'completed', deps: [], ...over }) as Task
const ended = (taskId: string, cwd: string): Dispatch =>
  ({ id: `dsp_${taskId}`, taskId, cwd, startedAt: '2026-10-01T00:00:00Z', endedAt: '2026-10-01T00:01:00Z', outcome: 'succeeded' }) as Dispatch
const run = { id: 'run_1', worktree: '/plan' } as JobRun
const state = (tasks: Task[]): OrchState =>
  ({ jobs: [], runs: [run], tasks, dispatches: tasks.map((t) => ended(t.id, `/wt-${t.id}`)) }) as unknown as OrchState

describe('completedWorktrees', () => {
  it('lists the worktrees of completed Tasks not folded into the plan yet', () => {
    expect(completedWorktrees(state([task('a'), task('b')]), run)).toEqual(['/wt-a', '/wt-b'])
  })

  it('leaves out a Task already merged into the plan (its folder only kept), so a push does not fold it again', () => {
    const s = state([task('a', { mergedIntoPlanAt: '2026-10-01T00:02:00Z' }), task('b')])
    expect(completedWorktrees(s, run)).toEqual(['/wt-b'])
  })
})
