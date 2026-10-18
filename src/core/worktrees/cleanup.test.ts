// W9-J: the ready rule, who owns a folder, and how the Worktrees page groups its rows.
import { describe, expect, it } from 'vitest'
import { emptyState, type OrchState } from '../orchestration/state'
import type { Dispatch, Task } from '../orchestration/types'
import type { WorktreeListItem } from '../types'
import { groupWorktrees, isReadyToClean, worktreeOwners, type CleanFacts, type WorktreeOwner, type WorktreeRow } from './cleanup'

const NOW = '2026-10-18T00:00:00.000Z'

const task = (id: string, over: Partial<Task> = {}): Task =>
  ({ id, runId: 'run_1', title: id, spec: 's', deps: [], status: 'completed', consecutiveFailures: 0, createdAt: NOW, updatedAt: NOW, ...over }) as Task
const dispatch = (taskId: string, cwd: string): Dispatch => ({ id: `d_${taskId}`, taskId, cwd, sessionId: `s_${taskId}` }) as Dispatch

function plan(over: Partial<OrchState> = {}): OrchState {
  return {
    ...emptyState(),
    jobs: [{ id: 'job_1', objective: 'Auth rework', cwd: '/repo', createdAt: NOW }],
    runs: [{ id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: NOW, worktree: '/wt/run' }],
    tasks: [task('t1', { mergedIntoPlanAt: NOW }), task('t2')],
    dispatches: [dispatch('t1', '/wt/t1'), dispatch('t2', '/wt/t2')],
    ...over
  } as OrchState
}

const owner = (over: Partial<WorktreeOwner> = {}): WorktreeOwner => ({ jobId: 'job_1', runId: 'run_1', plan: 'Auth rework', running: false, merged: true, taskIds: ['t1'], taskTitles: ['t1'], ...over })
const facts = (over: Partial<CleanFacts> = {}): CleanFacts => ({ owner: owner(), live: false, dirty: 0, unpushed: 0, ...over })

describe('isReadyToClean', () => {
  it('merged, clean, nothing unpushed, no session: ready', () => {
    expect(isReadyToClean(facts())).toBe(true)
  })
  it.each([
    ['dirty', { dirty: 3 }],
    ['unpushed', { unpushed: 2 }],
    ['a live session', { live: true }],
    ['not made by Astera for a plan', { owner: undefined }],
    ['its Task not merged', { owner: owner({ merged: false }) }],
    ['a dirty count git could not read', { dirty: null }],
    ['an unpushed count git could not read', { unpushed: null }]
  ] as [string, Partial<CleanFacts>][])('%s: not ready', (_, over) => {
    expect(isReadyToClean(facts(over))).toBe(false)
  })
})

describe('worktreeOwners', () => {
  it('knows the Task folders, whether each is merged, and the Run folder (merged only once delivered)', () => {
    const o = worktreeOwners(plan())
    expect(o.get('/wt/t1')).toMatchObject({ jobId: 'job_1', runId: 'run_1', plan: 'Auth rework', merged: true, taskIds: ['t1'], taskTitles: ['t1'], sessionId: 's_t1' })
    expect(o.get('/wt/t2')).toMatchObject({ merged: false })
    expect(o.get('/wt/run')).toMatchObject({ merged: false, taskIds: [] })
  })
  it('a delivered Run (pushed commit, or a PR out of draft) merges its own folder; a draft PR does not', () => {
    const run = (extra: object) => plan({ runs: [{ id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: NOW, worktree: '/wt/run', ...extra }] as never })
    expect(worktreeOwners(run({ delivery: { at: NOW, sha: 'abc' } })).get('/wt/run')?.merged).toBe(true)
    expect(worktreeOwners(run({ pr: { url: 'u', number: 1, draft: false } })).get('/wt/run')?.merged).toBe(true)
    expect(worktreeOwners(run({ pr: { url: 'u', number: 1, draft: true } })).get('/wt/run')?.merged).toBe(false)
  })
  it('a folder two Tasks used is merged only when both are; the project folder is nobody’s', () => {
    const s = plan({ tasks: [task('t1', { mergedIntoPlanAt: NOW }), task('t2')], dispatches: [dispatch('t1', '/wt/shared'), dispatch('t2', '/wt/shared'), dispatch('t1', '/repo')] })
    const o = worktreeOwners(s)
    expect(o.get('/wt/shared')).toMatchObject({ merged: false, taskIds: ['t1', 't2'] })
    expect(o.has('/repo')).toBe(false)
  })
  it('a plan with unfinished Tasks is running', () => {
    expect(worktreeOwners(plan({ tasks: [task('t1', { mergedIntoPlanAt: NOW }), task('t2', { status: 'dispatched' })] })).get('/wt/t1')?.running).toBe(true)
    expect(worktreeOwners(plan()).get('/wt/t1')?.running).toBe(false)
  })
})

const row = (name: string, over: Partial<WorktreeRow> = {}): WorktreeRow => ({
  item: { id: name, name, path: `/wt/${name}`, branch: name } as WorktreeListItem,
  owner: undefined,
  ahead: 0,
  behind: 0,
  dirty: 0,
  unpushed: 0,
  live: false,
  ready: false,
  ...over
})

describe('groupWorktrees', () => {
  it('ready first, then per plan (in first-seen order), then Yours', () => {
    const g = groupWorktrees([
      row('a', { owner: owner({ jobId: 'job_1' }) }),
      row('b', { owner: owner({ jobId: 'job_2', plan: 'Docs' }) }),
      row('c', { owner: owner(), ready: true }),
      row('d'),
      row('e', { owner: owner({ jobId: 'job_1' }) })
    ])
    expect(g.ready.map((r) => r.item.name)).toEqual(['c'])
    expect(g.plans.map((p) => [p.jobId, p.plan, p.rows.map((r) => r.item.name)])).toEqual([
      ['job_1', 'Auth rework', ['a', 'e']],
      ['job_2', 'Docs', ['b']]
    ])
    expect(g.yours.map((r) => r.item.name)).toEqual(['d'])
  })
  it('nothing Astera did not make for a plan is ever in the ready group, even if its row says ready', () => {
    // the rule owns the verdict (no owner → not ready); grouping trusts it, so this pins the pair
    const r = row('x', { ready: isReadyToClean(facts({ owner: undefined })) })
    expect(groupWorktrees([r]).ready).toEqual([])
    expect(groupWorktrees([r]).yours).toHaveLength(1)
  })
})
