// W9-J: the git facts behind the ready rule, and a removal that is never forced. Real git, in temp repos.
import { beforeEach, describe, expect, it } from 'vitest'
import { promises as fs, existsSync } from 'node:fs'
import path from 'node:path'
import { cleanRows, worktreeRows } from './cleanupRun'
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
