// W9-J: the git facts behind the ready rule, and a removal that is never forced. Real git, in temp repos.
import { beforeEach, describe, expect, it } from 'vitest'
import { promises as fs, existsSync } from 'node:fs'
import path from 'node:path'
import { cleanFinished, cleanRows, cleanRun, worktreeRows } from './cleanupRun'
import { createWorktree } from './create'
import { listWithStatus } from './list'
import { WorktreeRegistry } from './registry'
import { addOrigin, gitSync, makeRepo, tempDir } from './testRepo'
import { emptyState, type OrchState } from '../orchestration/state'
import type { Task } from '../orchestration/types'

const NOW = '2026-10-18T00:00:00.000Z'
const noUse = (): null => null
let repo: string
let reg: WorktreeRegistry

beforeEach(async () => {
  repo = await makeRepo('astera-wt-clean-')
  await addOrigin(repo)
  reg = new WorktreeRegistry(path.join(await tempDir('astera-wt-cleanreg-'), 'worktrees.json'), await tempDir('astera-wt-cleanroot-'))
  await reg.load()
})

/** A worktree a plan made for task t1, merged unless said otherwise, with one commit that is pushed unless said otherwise. */
async function planWorktree(o: { merged?: boolean; push?: boolean } = {}): Promise<{ state: OrchState; path: string; id: string }> {
  const { info } = await createWorktree({ repoPath: repo, name: 'task-one', registry: reg })
  await fs.writeFile(path.join(info.path, 'w.txt'), 'w', 'utf8')
  gitSync(info.path, ['add', 'w.txt'])
  gitSync(info.path, ['commit', '-m', 'work'])
  if (o.push !== false) gitSync(info.path, ['push', '-u', 'origin', info.branch])
  const state = {
    ...emptyState(),
    jobs: [{ id: 'job_1', objective: 'Plan', cwd: repo, createdAt: NOW }],
    runs: [{ id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: NOW }],
    tasks: [{ id: 't1', runId: 'run_1', status: 'completed', ...(o.merged === false ? {} : { mergedIntoPlanAt: NOW }) } as Task],
    dispatches: [{ id: 'd1', taskId: 't1', cwd: info.path, sessionId: 's1' }]
  } as OrchState
  return { state, path: info.path, id: info.id }
}

const rowsOf = async (state: OrchState, inUse: (p: string) => string | null = noUse) => worktreeRows(await listWithStatus(reg), state, inUse)

describe('worktreeRows + cleanRows', () => {
  it('merged, clean, pushed, no session: ready, and removed without force', async () => {
    const w = await planWorktree()
    const rows = await rowsOf(w.state)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ dirty: 0, unpushed: 0, live: false, ready: true })
    const r = await cleanRows(rows, { registry: reg, isPathInUse: noUse })
    expect(r.removed).toEqual([w.path])
    expect(existsSync(w.path)).toBe(false)
  })

  it.each([
    ['unpushed commits', async (w: { path: string }) => { await fs.writeFile(path.join(w.path, 'n.txt'), 'n'); gitSync(w.path, ['add', 'n.txt']); gitSync(w.path, ['commit', '-m', 'more']) }],
    ['uncommitted changes', async (w: { path: string }) => { await fs.writeFile(path.join(w.path, 'dirty.txt'), 'd') }]
  ])('%s: not ready, and stays', async (_, spoil) => {
    const w = await planWorktree()
    await spoil(w)
    const rows = await rowsOf(w.state)
    expect(rows[0].ready).toBe(false)
    expect((await cleanRows(rows, { registry: reg, isPathInUse: noUse })).removed).toEqual([])
    expect(existsSync(w.path)).toBe(true)
  })

  it('a Task not merged, or a session in the folder: not ready', async () => {
    const a = await planWorktree({ merged: false })
    expect((await rowsOf(a.state))[0].ready).toBe(false)
    const b = await planWorktree()
    expect((await rowsOf(b.state, () => 'SESSION:worker'))[0]).toMatchObject({ live: true, ready: false })
  })

  it('a worktree Astera made for no plan is Yours: never ready', async () => {
    const w = await planWorktree()
    const rows = await rowsOf({ ...w.state, dispatches: [] })
    expect(rows[0]).toMatchObject({ owner: undefined, ready: false })
  })

  it('a folder that turned dirty after the rows were read is kept: the removal itself refuses it', async () => {
    const w = await planWorktree()
    const rows = await rowsOf(w.state)
    expect(rows[0].ready).toBe(true)
    await fs.writeFile(path.join(w.path, 'late.txt'), 'late')
    const r = await cleanRows(rows, { registry: reg, isPathInUse: noUse })
    expect(r.removed).toEqual([])
    expect(r.kept).toHaveLength(1)
    expect(existsSync(w.path)).toBe(true)
  })
})

// ── T5: a delivered plan loses every folder, not only the tips ──

const sh = (cwd: string, args: string[]): string => gitSync(cwd, args)

/** A plan's own folder (branch `plan`, pushed) and `n` Task folders forked from it, each with one commit merged into the
 *  plan, as a delivered push plan leaves them. The plan is delivered; the Tasks' merges are recorded for all but `unrecorded`. */
async function deliveredPlan(n: number, o: { unrecorded?: number[]; extra?: object } = {}): Promise<{ state: OrchState; run: string; tasks: string[]; branches: string[]; planBranch: string }> {
  const plan = (await createWorktree({ repoPath: repo, name: 'plan', registry: reg })).info
  sh(plan.path, ['push', '-u', 'origin', plan.branch])
  const tasks: string[] = []
  const branches: string[] = []
  for (let i = 1; i <= n; i++) {
    const t = (await createWorktree({ repoPath: repo, name: `task-${i}`, baseRef: plan.branch, registry: reg })).info
    await fs.writeFile(path.join(t.path, `t${i}.txt`), String(i))
    sh(t.path, ['add', '-A'])
    sh(t.path, ['commit', '-m', `task ${i}`])
    sh(plan.path, ['merge', '--no-ff', '-m', `merge ${i}`, t.branch])
    tasks.push(t.path)
    branches.push(t.branch)
  }
  sh(plan.path, ['push', 'origin', plan.branch])
  const state = {
    ...emptyState(),
    jobs: [{ id: 'job_1', objective: 'Plan', cwd: repo, createdAt: NOW }],
    runs: [{ id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: NOW, worktree: plan.path, delivery: { at: NOW, sha: 'abc' }, ...o.extra }],
    tasks: tasks.map((_, i) => ({ id: `t${i + 1}`, runId: 'run_1', status: 'completed', ...(o.unrecorded?.includes(i + 1) ? {} : { mergedIntoPlanAt: NOW }) }) as Task),
    dispatches: tasks.map((p, i) => ({ id: `d${i + 1}`, taskId: `t${i + 1}`, cwd: p, sessionId: `s${i + 1}` }))
  } as OrchState
  return { state, run: plan.path, tasks, branches, planBranch: plan.branch }
}

const deps = (state: OrchState, extra: object = {}) => ({
  registry: reg,
  list: () => listWithStatus(reg),
  state: () => state,
  isPathInUse: noUse,
  ...extra
})
const branchExists = (b: string): boolean => sh(repo, ['branch', '--list', b]) !== ''
const remoteBranch = (b: string): string => sh(repo, ['ls-remote', '--heads', 'origin', b])

describe('cleanRun after a delivery', () => {
  it('removes the plan folder and all 3 Task folders, one of which is still unrecorded as merged (after a retry, only the tips were)', async () => {
    const p = await deliveredPlan(3, { unrecorded: [2] })
    const r = await cleanRun('run_1', deps(p.state))
    expect(r.removed.sort()).toEqual([p.run, ...p.tasks].sort())
    for (const f of [p.run, ...p.tasks]) expect(existsSync(f)).toBe(false)
  })

  it('deletes the merged Task branches and the plan branch, here and on origin, because Astera pushed it', async () => {
    const p = await deliveredPlan(2)
    expect(remoteBranch(p.planBranch)).not.toBe('')
    await cleanRun('run_1', deps(p.state))
    for (const b of [...p.branches, p.planBranch]) expect(branchExists(b)).toBe(false)
    expect(remoteBranch(p.planBranch)).toBe('')
  })

  it('keeps a branch whose work is not merged anywhere, and says so; its folder is kept too', async () => {
    const p = await deliveredPlan(1)
    const lone = (await createWorktree({ repoPath: repo, name: 'lone', baseRef: p.planBranch, registry: reg })).info
    await fs.writeFile(path.join(lone.path, 'lone.txt'), 'x')
    sh(lone.path, ['add', '-A'])
    sh(lone.path, ['commit', '-m', 'unmerged'])
    const state = { ...p.state, tasks: [...p.state.tasks, { id: 't9', runId: 'run_1', status: 'failed', consecutiveFailures: 9 } as Task], dispatches: [...p.state.dispatches, { id: 'd9', taskId: 't9', cwd: lone.path, sessionId: 's9' } as never] }
    const lines: string[] = []
    const r = await cleanRun('run_1', deps(state, { activity: (_: string, l: string) => lines.push(l) }))
    expect(existsSync(lone.path)).toBe(true)
    expect(branchExists(lone.branch)).toBe(true)
    expect(r.kept.map((k) => k.path)).toEqual([lone.path])
    expect(lines.join('\n')).toMatch(/lone .*neither pushed nor merged/)
    expect(existsSync(p.run)).toBe(false)
  })

  it('an ignored node_modules (a folder, or the link Astera makes) does not block; the untracked notes.txt does, and is reported with its path', async () => {
    const p = await deliveredPlan(2)
    const [a, b] = p.tasks
    // ignored directory in the first Task folder (committed .gitignore, as a project has)
    await fs.writeFile(path.join(a, '.gitignore'), 'node_modules/\ndist/\n')
    sh(a, ['add', '.gitignore'])
    sh(a, ['commit', '-m', 'ignore'])
    sh(p.run, ['merge', '--no-ff', '-m', 'merge ignore', sh(a, ['rev-parse', '--abbrev-ref', 'HEAD'])])
    sh(p.run, ['push', 'origin', p.planBranch])
    await fs.mkdir(path.join(a, 'node_modules', 'x'), { recursive: true })
    await fs.writeFile(path.join(a, 'node_modules', 'x', 'i.js'), '1')
    await fs.mkdir(path.join(a, 'dist'))
    await fs.writeFile(path.join(a, 'dist', 'o.js'), '1')
    // the link: `node_modules/` does not ignore a symlink
    await fs.symlink(await tempDir('astera-nm-'), path.join(b, 'node_modules'))
    await fs.writeFile(path.join(b, 'notes.txt'), 'mine')
    const lines: string[] = []
    const r = await cleanRun('run_1', deps(p.state, { activity: (_: string, l: string) => lines.push(l) }))
    expect(existsSync(a)).toBe(false)
    expect(existsSync(b)).toBe(true)
    expect(r.kept).toEqual([{ path: b, reason: '1 untracked file', untracked: ['notes.txt'] }])
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/kept: 1 untracked file \(notes\.txt\)/)
  })

  it('lists at most 10 untracked paths', async () => {
    const p = await deliveredPlan(1)
    for (let i = 0; i < 12; i++) await fs.writeFile(path.join(p.tasks[0], `n${i}.txt`), 'x')
    const lines: string[] = []
    const r = await cleanRun('run_1', deps(p.state, { activity: (_: string, l: string) => lines.push(l) }))
    expect(r.kept[0].untracked).toHaveLength(10)
    expect(lines[0]).toMatch(/12 untracked files \(.*, …\)/)
  })

  it('a folder with a live session is never removed', async () => {
    const p = await deliveredPlan(2)
    const r = await cleanRun('run_1', deps(p.state, { isPathInUse: (q: string) => (q === p.tasks[0] ? 'SESSION:worker' : null) }))
    expect(existsSync(p.tasks[0])).toBe(true)
    expect(r.removed).not.toContain(p.tasks[0])
  })

  it('a plan whose pull request was merged on GitHub (squashed, its branch gone from origin) is cleaned though no remote holds the commits', async () => {
    const p = await deliveredPlan(2, { extra: { delivery: undefined, pr: { at: NOW, url: 'https://x/pull/1', number: 1, draft: true, attributed: 'merge-sha' } } })
    sh(repo, ['push', 'origin', '--delete', p.planBranch])
    sh(repo, ['fetch', '--prune', 'origin'])
    const r = await cleanRun('run_1', deps(p.state))
    expect(r.removed).toHaveLength(3)
  })
})

describe('cleanRun after the owner archives a plan', () => {
  it('removes the folders whose work is merged or pushed and keeps the rest', async () => {
    const p = await deliveredPlan(2, { extra: { delivery: undefined } })
    const wip = (await createWorktree({ repoPath: repo, name: 'wip', baseRef: p.planBranch, registry: reg })).info
    await fs.writeFile(path.join(wip.path, 'w.txt'), 'x')
    sh(wip.path, ['add', '-A'])
    sh(wip.path, ['commit', '-m', 'unmerged'])
    const state = {
      ...p.state,
      jobs: p.state.jobs.map((j) => ({ ...j, archivedAt: NOW })),
      tasks: [{ id: 't1', runId: 'run_1', status: 'completed', mergedIntoPlanAt: NOW } as Task, { id: 't2', runId: 'run_1', status: 'failed', consecutiveFailures: 9 } as Task, { id: 't3', runId: 'run_1', status: 'failed', consecutiveFailures: 9 } as Task],
      dispatches: [{ id: 'd1', taskId: 't1', cwd: p.tasks[0], sessionId: 's1' }, { id: 'd2', taskId: 't2', cwd: p.tasks[1], sessionId: 's2' }, { id: 'd3', taskId: 't3', cwd: wip.path, sessionId: 's3' }] as never
    } as OrchState
    const r = await cleanRun('run_1', deps(state))
    expect(existsSync(p.tasks[0])).toBe(false) // merged
    expect(existsSync(p.tasks[1])).toBe(false) // failed, but its commit is in the plan branch that is pushed
    expect(existsSync(wip.path)).toBe(true)
    expect(r.kept.map((k) => k.path)).toContain(wip.path)
  })
})

describe('cleanFinished: the Host-start sweep', () => {
  it('removes the leftovers of a delivered plan and leaves a plan still running alone', async () => {
    const done = await deliveredPlan(2)
    const wipPlan = (await createWorktree({ repoPath: repo, name: 'other-plan', registry: reg })).info
    const state = {
      ...done.state,
      jobs: [...done.state.jobs, { id: 'job_2', objective: 'Running', cwd: repo, createdAt: NOW }],
      runs: [...done.state.runs, { id: 'run_2', jobId: 'job_2', ordinal: 1, createdAt: NOW, worktree: wipPlan.path }],
      tasks: [...done.state.tasks, { id: 'x1', runId: 'run_2', status: 'dispatched' } as Task]
    } as OrchState
    const r = await cleanFinished(deps(state))
    expect(r.removed.sort()).toEqual([done.run, ...done.tasks].sort())
    expect(existsSync(wipPlan.path)).toBe(true)
  })

  it('keeps the folders of an archived plan whose Run still runs, and says why', async () => {
    const p = await deliveredPlan(2)
    const state = {
      ...p.state,
      jobs: p.state.jobs.map((j) => ({ ...j, archivedAt: NOW })),
      runs: p.state.runs.map((r) => ({ ...r, delivery: undefined })),
      tasks: [...p.state.tasks, { id: 'tr', runId: 'run_1', status: 'dispatched' } as Task]
    } as OrchState
    const lines: string[] = []
    const r = await cleanFinished({ ...deps(state), activity: (_, l) => lines.push(l) })
    expect(r.removed).toEqual([])
    for (const f of [p.run, ...p.tasks]) expect(existsSync(f)).toBe(true)
    expect(r.kept).toContainEqual({ path: p.run, reason: 'its Run is still running' })
    expect(lines.join('\n')).toMatch(/kept: its Run is still running/)
  })

  it('finds a Task folder of a delivered plan whose Dispatches the state lost, by the branch it was forked from', async () => {
    const p = await deliveredPlan(3)
    const wiped = { ...p.state, tasks: [], dispatches: [] } as OrchState
    const r = await cleanFinished(deps(wiped))
    expect(r.removed).toHaveLength(4)
  })

  it('cleans a registry shaped like the real ~/.config/astera/worktrees.json: 18 Task folders of delivered plans, one dirty', async () => {
    const plan = (await createWorktree({ repoPath: repo, name: 'game', registry: reg })).info
    sh(plan.path, ['push', '-u', 'origin', plan.branch])
    const folders: string[] = []
    for (let i = 0; i < 18; i++) folders.push((await createWorktree({ repoPath: repo, name: `g-${i}`, baseRef: plan.branch, registry: reg })).info.path)
    await fs.writeFile(path.join(folders[7], 'wip.txt'), 'mine')
    const state = {
      ...emptyState(),
      jobs: [{ id: 'job_g', objective: 'Game', cwd: repo, createdAt: NOW }],
      runs: [{ id: 'run_g', jobId: 'job_g', ordinal: 1, createdAt: NOW, worktree: plan.path, delivery: { at: NOW, sha: 'abc' } }]
    } as OrchState
    const r = await cleanFinished(deps(state))
    expect(r.removed).toHaveLength(18) // 17 Task folders + the plan folder
    expect(existsSync(folders[7])).toBe(true)
    expect(reg.list().map((w) => w.path)).toEqual([folders[7]])
  })
})
