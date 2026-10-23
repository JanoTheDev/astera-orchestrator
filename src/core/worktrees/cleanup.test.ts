// W9-J: the ready rule, who owns a folder, and how the Worktrees page groups its rows.
import { describe, expect, it } from 'vitest'
import { emptyState, type OrchState } from '../orchestration/state'
import type { Dispatch, Task } from '../orchestration/types'
import type { WorktreeListItem } from '../types'
import { groupWorktrees, inferOwner, isReadyToClean, worktreeOwners, type CleanFacts, type WorktreeOwner, type WorktreeRow } from './cleanup'

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

const owner = (over: Partial<WorktreeOwner> = {}): WorktreeOwner => ({ jobId: 'job_1', runId: 'run_1', plan: 'Auth rework', running: false, merged: true, taskIds: ['t1'], taskTitles: ['t1'], delivered: false, landed: false, archived: false, pushed: false, ...over })
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

describe('isReadyToClean: delivered, landed and archived plans', () => {
  it('a squash-merged PR (landed) frees a merged folder whose commits no remote branch holds any more', () => {
    expect(isReadyToClean(facts({ unpushed: 4 }))).toBe(false)
    expect(isReadyToClean(facts({ unpushed: 4, owner: owner({ landed: true }) }))).toBe(true)
  })
  it('a folder of a delivered plan whose Tasks the state forgot goes only if its commits are pushed or in its base', () => {
    const forgotten = owner({ merged: false, delivered: true, taskIds: [], inferred: true })
    expect(isReadyToClean(facts({ owner: forgotten }))).toBe(true)
    expect(isReadyToClean(facts({ owner: forgotten, unpushed: 2, inBase: true }))).toBe(true)
    expect(isReadyToClean(facts({ owner: forgotten, unpushed: 2, inBase: false }))).toBe(false)
    expect(isReadyToClean(facts({ owner: forgotten, unpushed: 2 }))).toBe(false)
    expect(isReadyToClean(facts({ owner: forgotten, dirty: 1 }))).toBe(false)
  })
  it("a plan's own folder goes only once its work is in the base or its PR merged, never on pushed alone", () => {
    const plan = owner({ taskIds: [], delivered: true, merged: true, planFolder: true })
    expect(isReadyToClean(facts({ owner: plan, unpushed: 0 }))).toBe(false)
    expect(isReadyToClean(facts({ owner: plan, unpushed: 0, inBase: true }))).toBe(true)
    expect(isReadyToClean(facts({ owner: { ...plan, landed: true }, unpushed: 3 }))).toBe(true)
  })
  it('an archived plan frees what is pushed or merged, and keeps the rest; a plan neither delivered nor archived frees nothing unmerged', () => {
    const archived = owner({ merged: false, archived: true })
    expect(isReadyToClean(facts({ owner: archived, unpushed: 0 }))).toBe(true)
    expect(isReadyToClean(facts({ owner: archived, unpushed: 3, inBase: true }))).toBe(true)
    expect(isReadyToClean(facts({ owner: archived, unpushed: 3, inBase: false }))).toBe(false)
    expect(isReadyToClean(facts({ owner: owner({ merged: false }), unpushed: 0 }))).toBe(false)
  })
})

describe('inferOwner', () => {
  const plans = new Map([['/wt/run', owner({ taskIds: [], delivered: true, merged: true, sessionId: 'coord' })]])
  const all = [{ repoPath: '/repo', branch: 'me/plan', path: '/wt/run' }]
  it('a folder forked from the branch of a plan’s own folder belongs to that plan, with no Task and no session', () => {
    const o = inferOwner({ repoPath: '/repo', baseRef: 'me/plan', path: '/wt/old-task' }, all, plans)
    expect(o).toMatchObject({ runId: 'run_1', delivered: true, merged: false, taskIds: [], inferred: true })
    expect(o?.sessionId).toBeUndefined()
  })
  it('another repository, another base, or the plan’s own folder: nobody’s', () => {
    expect(inferOwner({ repoPath: '/other', baseRef: 'me/plan', path: '/wt/x' }, all, plans)).toBeUndefined()
    expect(inferOwner({ repoPath: '/repo', baseRef: 'origin/main', path: '/wt/x' }, all, plans)).toBeUndefined()
    expect(inferOwner({ repoPath: '/repo', baseRef: 'me/plan', path: '/wt/run' }, all, plans)).toBeUndefined()
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
  it('a merged pull request, a delivered state and a PR with no URL: delivered, delivered, not delivered', () => {
    const run = (extra: object) => plan({ runs: [{ id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: NOW, worktree: '/wt/run', ...extra }] as never })
    expect(worktreeOwners(run({ pr: { at: NOW, url: 'u', draft: true, attributed: 'sha' } })).get('/wt/run')).toMatchObject({ delivered: true, landed: true })
    expect(worktreeOwners(run({ deliveryState: { state: 'delivered', attempts: 1 } })).get('/wt/run')?.delivered).toBe(true)
    expect(worktreeOwners(run({ pr: { at: NOW, error: 'The push was rejected' } })).get('/wt/run')?.delivered).toBe(false)
  })
  it('an archived plan is archived, a pushed branch is recorded', () => {
    const s = plan({ jobs: [{ id: 'job_1', objective: 'Auth rework', cwd: '/repo', createdAt: NOW, archivedAt: NOW }] as never, tasks: [task('t1', { status: 'failed', consecutiveFailures: 9 })] })
    expect(worktreeOwners(s).get('/wt/t1')).toMatchObject({ archived: true, pushed: false })
    expect(worktreeOwners(plan()).get('/wt/t1')?.archived).toBe(false)
    const pushed = plan({ runs: [{ id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: NOW, worktree: '/wt/run', branchPush: { state: 'delivered', attempts: 1 } }] as never })
    expect(worktreeOwners(pushed).get('/wt/t1')?.pushed).toBe(true)
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
  inBase: false,
  untracked: [],
  untrackedCount: 0,
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
