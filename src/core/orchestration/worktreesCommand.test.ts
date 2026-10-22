// T5: `astera worktrees list|remove` — the states, what a dry run lists, what is refused, and who may ask.
import { describe, expect, it, vi } from 'vitest'
import { handleCommand, type OrchServerDeps } from './command'
import { emptyState, type OrchState } from './state'
import type { WorktreeRow } from '../worktrees/cleanup'
import type { WorktreeListItem } from '../types'
import { addOrigin, gitSync, makeRepo } from '../worktrees/testRepo'
import { ageOf, stateOfRow, type WorktreesOps } from './worktreesCommand'

const NOW = '2026-10-22T12:00:00.000Z'
const DAY = 86_400_000

const owner = { jobId: 'job_1', runId: 'run_1', plan: 'Plan', running: false, merged: true, taskIds: ['t1'], taskTitles: ['t1'], delivered: true, landed: false, archived: false, pushed: true }
const row = (name: string, over: Partial<WorktreeRow> = {}): WorktreeRow => ({
  item: { id: name, name, path: `/wt/${name}`, branch: `me/${name}`, baseRef: 'me/plan', repoPath: '/repo', createdAt: new Date(Date.parse(NOW) - 3 * DAY).toISOString(), status: 'ok' } as WorktreeListItem,
  owner,
  ahead: 0,
  behind: 0,
  dirty: 0,
  unpushed: 0,
  inBase: false,
  untracked: [],
  untrackedCount: 0,
  live: false,
  ready: true,
  ...over
})

const ROWS = [
  row('merged'),
  row('live', { live: true, ready: false }),
  row('dirty', { dirty: 2, ready: false }),
  row('unpushed', { unpushed: 3, ready: false }),
  row('orphan', { owner: undefined, ready: false }),
  row('active', { owner: { ...owner, merged: false, delivered: false }, ready: false }),
  row('gone', { owner: undefined, ready: false, dirty: null, unpushed: null, item: { ...row('gone').item, status: 'orphan-dir' } as WorktreeListItem })
]

const setup = (rows: WorktreeRow[] = ROWS) => {
  const remove = vi.fn(async (id: string) => ({ removed: true, branchDeleted: id !== 'unpushed' }))
  const ops: WorktreesOps = { rows: async () => rows, remove }
  const state = {
    ...emptyState(),
    projects: [{ id: 'proj_1', path: '/repo', name: 'repo', addedAt: NOW }],
    jobs: [{ id: 'job_1', objective: 'Plan', cwd: '/repo', createdAt: NOW }],
    runs: [{ id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: NOW, coordinatorSessionId: 'coord' }]
  } as OrchState
  const deps = { getState: () => state, setState: async () => {}, now: () => NOW, worktreesOps: ops } as unknown as OrchServerDeps
  const call = (cmd: string, args: Record<string, unknown> = {}, sessionId = '') => handleCommand(deps, { sessionId }, cmd, args)
  return { call, remove }
}

type Listed = { worktrees: { path: string; state: string; stale: boolean; age: string; run?: string }[] }
type Removed = { dryRun: boolean; removed?: { path: string }[]; wouldRemove?: { path: string }[]; kept: { path: string; reason: string }[] }

describe('worktrees list', () => {
  it('names each folder’s state: live, dirty, unpushed, orphan, merged, active; a leftover folder git forgot is an orphan', async () => {
    const r = await setup().call('worktrees-list')
    expect(r.status).toBe(200)
    const by = Object.fromEntries((r.body as Listed).worktrees.map((w) => [w.path.slice(4), w.state]))
    expect(by).toEqual({ merged: 'merged', live: 'live', dirty: 'dirty', unpushed: 'unpushed', orphan: 'orphan', active: 'active', gone: 'orphan' })
    expect((r.body as Listed).worktrees[0]).toMatchObject({ run: 'run_1', age: '3d' })
  })
  it('--stale lists only the merged ones and the leftover folders git forgot; a clean folder no plan owns is never stale', async () => {
    const r = await setup().call('worktrees-list', { stale: true })
    expect((r.body as Listed).worktrees.map((w) => w.path)).toEqual(['/wt/merged', '/wt/gone'])
  })
  it('--project keeps one project’s folders; an unknown project is 404', async () => {
    const s = setup([row('a'), row('b', { item: { ...row('b').item, repoPath: '/elsewhere' } as WorktreeListItem })])
    expect(((await s.call('worktrees-list', { project: 'proj_1' })).body as Listed).worktrees.map((w) => w.path)).toEqual(['/wt/a'])
    expect((await s.call('worktrees-list', { project: '/nowhere' })).status).toBe(404)
  })
})

describe('worktrees remove', () => {
  it('--stale --dry-run lists what would go and removes nothing', async () => {
    const s = setup()
    const r = await s.call('worktrees-remove', { stale: true, dryRun: true })
    expect(r.status).toBe(200)
    expect((r.body as Removed).wouldRemove?.map((w) => w.path)).toEqual(['/wt/merged', '/wt/gone'])
    expect(s.remove).not.toHaveBeenCalled()
  })
  it('--stale removes the stale ones', async () => {
    const s = setup()
    const r = await s.call('worktrees-remove', { stale: true })
    expect((r.body as Removed).removed?.map((w) => w.path)).toEqual(['/wt/merged', '/wt/gone'])
    expect(s.remove.mock.calls.map((c) => c[0])).toEqual(['merged', 'gone'])
  })
  it('--run keeps the dirty and unpushed ones with the reason, and removes them with --force', async () => {
    const plain = setup()
    const r = await plain.call('worktrees-remove', { run: 'run_1' })
    expect((r.body as Removed).kept.map((k) => k.path).sort()).toEqual(['/wt/dirty', '/wt/live', '/wt/unpushed'].sort())
    expect((r.body as Removed).kept.find((k) => k.path === '/wt/dirty')?.reason).toMatch(/2 uncommitted .*--force/)
    expect(plain.remove.mock.calls.map((c) => c[0]).sort()).toEqual(['active', 'merged'])
    const forced = setup()
    await forced.call('worktrees-remove', { run: 'run_1', force: true })
    expect(forced.remove.mock.calls.map((c) => c[0]).sort()).toEqual(['active', 'dirty', 'merged', 'unpushed'])
  })
  it('a folder with a live session is never removed, with --force or by --path', async () => {
    const s = setup()
    const r = await s.call('worktrees-remove', { path: '/wt/live', force: true })
    expect((r.body as Removed).kept).toEqual([{ path: '/wt/live', reason: 'a session runs in it' }])
    expect(s.remove).not.toHaveBeenCalled()
  })
  it('--path of a folder that is not registered is 404; none or two selectors is 400', async () => {
    const s = setup()
    expect((await s.call('worktrees-remove', { path: '/nope' })).status).toBe(404)
    expect((await s.call('worktrees-remove', {})).status).toBe(400)
    expect((await s.call('worktrees-remove', { stale: true, run: 'run_1' })).status).toBe(400)
  })
  it('a removal git refuses is kept with git’s reason, and the rest still go', async () => {
    const s = setup([row('a'), row('b')])
    s.remove.mockRejectedValueOnce(new Error('DIRTY: 1'))
    const r = await s.call('worktrees-remove', { stale: true })
    expect((r.body as Removed).kept).toEqual([{ path: '/wt/a', reason: 'DIRTY: 1' }])
    expect((r.body as Removed).removed?.map((w) => w.path)).toEqual(['/wt/b'])
  })
  it('asks origin’s copy deleted only for a plan branch Astera pushed', async () => {
    const s = setup([row('a'), row('b', { owner: { ...owner, pushed: false } })])
    await s.call('worktrees-remove', { stale: true })
    expect(s.remove.mock.calls).toEqual([['a', false, true], ['b', false, false]])
  })
})

describe('who may ask', () => {
  it('the person, and a coordinator for its own Run only; a worker and a stranger session are refused', async () => {
    const s = setup([row('mine'), row('theirs', { owner: { ...owner, runId: 'run_2' } })])
    expect(((await s.call('worktrees-list')).body as Listed).worktrees).toHaveLength(2)
    const coordinator = await s.call('worktrees-list', {}, 'coord')
    expect((coordinator.body as Listed).worktrees.map((w) => w.path)).toEqual(['/wt/mine'])
    expect((await s.call('worktrees-remove', { run: 'run_2' }, 'coord')).status).toBe(403)
    await s.call('worktrees-remove', { stale: true }, 'coord')
    expect(s.remove.mock.calls.map((c) => c[0])).toEqual(['mine'])
    expect((await s.call('worktrees-list', {}, 'some-worker')).status).toBe(403)
  })
  it('without the Host’s ops it answers 409', async () => {
    const deps = { getState: () => emptyState(), setState: async () => {}, now: () => NOW } as unknown as OrchServerDeps
    expect((await handleCommand(deps, { sessionId: '' }, 'worktrees-list', {})).status).toBe(409)
  })
})

describe('stateOfRow and ageOf', () => {
  it('unknown facts read as dirty (never removable); landed or in-base commits are not "unpushed"', () => {
    expect(stateOfRow(row('x', { dirty: null }))).toBe('dirty')
    expect(stateOfRow(row('x', { unpushed: null }))).toBe('unpushed')
    expect(stateOfRow(row('x', { unpushed: 4, inBase: true }))).toBe('merged')
    expect(stateOfRow(row('x', { unpushed: 4, owner: { ...owner, landed: true } }))).toBe('merged')
  })
  it('ages read in minutes, hours and days', () => {
    const at = Date.parse(NOW)
    expect([ageOf(new Date(at - 5 * 60_000).toISOString(), at), ageOf(new Date(at - 5 * 3_600_000).toISOString(), at), ageOf(new Date(at - 5 * DAY).toISOString(), at), ageOf('nope', at)]).toEqual(['5m', '5h', '5d', '-'])
  })
})

describe('archiving and merged pull requests clean the plan’s worktrees', () => {
  const stateWith = (tasks: object[]): OrchState =>
    ({
      ...emptyState(),
      jobs: [{ id: 'job_1', objective: 'Plan', cwd: '/repo', createdAt: NOW }],
      runs: [{ id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: NOW }],
      tasks
    }) as OrchState
  const archive = async (tasks: object[]) => {
    const box = { state: stateWith(tasks) }
    const cleanWorktrees = vi.fn(async () => undefined)
    const deps = { getState: () => box.state, setState: async (n: OrchState) => void (box.state = n), now: () => NOW, cleanWorktrees } as unknown as OrchServerDeps
    const r = await handleCommand(deps, { sessionId: '' }, 'jobs-archive', { id: 'job_1' })
    return { r, cleanWorktrees }
  }
  it('archiving a plan whose Run failed cleans that Run', async () => {
    const { r, cleanWorktrees } = await archive([{ id: 't1', runId: 'run_1', status: 'failed', consecutiveFailures: 9 }])
    expect(r.status).toBe(200)
    expect(cleanWorktrees).toHaveBeenCalledWith('run_1')
  })
  it('archiving a plan whose Run still works cleans nothing', async () => {
    const { cleanWorktrees } = await archive([{ id: 't1', runId: 'run_1', status: 'dispatched', consecutiveFailures: 0 }])
    expect(cleanWorktrees).not.toHaveBeenCalled()
  })
})

describe('a merged pull request cleans the plan', () => {
  it('attribution-remap, once it saw the PR merged, cleans the Run’s worktrees', async () => {
    const repo = await makeRepo('astera-remap-')
    await addOrigin(repo)
    const box = { state: { ...emptyState(), jobs: [{ id: 'job_1', objective: 'Plan', cwd: repo, createdAt: NOW }], runs: [{ id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: NOW, pr: { at: NOW, url: 'https://x/pull/1', number: 1, draft: true } }] } as OrchState }
    const cleanWorktrees = vi.fn(async () => undefined)
    const github = { run: async () => ({ ok: true, stdout: JSON.stringify({ state: 'MERGED', mergeCommit: { oid: 'a'.repeat(40) }, baseRefName: gitSync(repo, ['rev-parse', '--abbrev-ref', 'HEAD']) }) }) }
    const deps = { getState: () => box.state, setState: async (n: OrchState) => void (box.state = n), now: () => NOW, cleanWorktrees, github } as unknown as OrchServerDeps
    const r = await handleCommand(deps, { sessionId: '' }, 'attribution-remap', { pr: 'https://x/pull/1' })
    expect(r.body).toMatchObject({ remapped: true })
    expect(box.state.runs[0].pr?.attributed).toBe('a'.repeat(40))
    expect(cleanWorktrees).toHaveBeenCalledWith('run_1')
  })
})
