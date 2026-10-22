// T4: running plans stay current with teammates. Real temp repositories: a bare origin, the owner's clone (the project
// folder) and a second clone acting as the teammate; the commands are the real handleCommand.
import { describe, it, expect, beforeEach } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { addOrigin, gitSync, makeRepo, tempDir } from '../../worktrees/testRepo'
import { WorktreeRegistry } from '../../worktrees/registry'
import { pushBranch } from '../../github/prCreate'
import { HOST_CALLER } from '../../host/driver'
import { handleCommand, type OrchServerDeps } from '../command'
import { createJob, createTask, emptyState, setRunWorktree, startJobRun, type OrchState } from '../state'
import type { Task } from '../types'
import { forkWorktree } from './integrateGit'
import { createOriginSync, originSyncHold, ORIGIN_SYNC_EVERY_MS, ORIGIN_SYNC_MARK } from './originSync'

const NOW = '2026-10-22T10:00:00.000Z'
const commit = (cwd: string, file: string, body: string): string => {
  gitSync(cwd, ['add', file])
  gitSync(cwd, ['-c', 'user.name=Fixture', '-c', 'user.email=f@f', 'commit', '-m', `edit ${file}`])
  return gitSync(cwd, ['rev-parse', 'HEAD'])
}
const holds = (cwd: string, sha: string): boolean => {
  try {
    gitSync(cwd, ['merge-base', '--is-ancestor', sha, 'HEAD'])
    return true
  } catch {
    return false
  }
}

let repo: string, origin: string, mate: string, registry: WorktreeRegistry, logs: string[]
beforeEach(async () => {
  repo = await makeRepo('astera-osync-')
  origin = await addOrigin(repo)
  mate = path.join(await tempDir('astera-osync-mate-'), 'mate')
  gitSync(path.dirname(mate), ['clone', origin, mate])
  const root = await tempDir('astera-osync-root-')
  registry = new WorktreeRegistry(path.join(root, 'worktrees.json'), root)
  await registry.load()
  logs = []
})
const fork = (name: string) => forkWorktree({ repoPath: repo, name }, { registry, log: (m) => logs.push(m) })
/** The teammate commits `file` and pushes main. */
const teammatePushes = async (file: string, body: string): Promise<string> => {
  await fs.writeFile(path.join(mate, file), body)
  const sha = commit(mate, file, body)
  gitSync(mate, ['push', 'origin', 'main'])
  return sha
}

describe('fetch before forking (T4)', () => {
  it("a new plan forks from the teammate's commit; the owner's main stays where it was", async () => {
    const mine = gitSync(repo, ['rev-parse', 'main'])
    const theirs = await teammatePushes('mate.txt', 'hi')
    const wt = await fork('run')
    expect(gitSync(wt, ['rev-parse', 'HEAD'])).toBe(theirs)
    expect(gitSync(repo, ['rev-parse', 'main'])).toBe(mine)
    expect(registry.list().find((w) => w.path === wt)?.baseRef).toBe('main') // a PR's base stays the local name
  })

  it('a repository with no origin forks from the local branch, with no error', async () => {
    gitSync(repo, ['remote', 'remove', 'origin'])
    const wt = await fork('run')
    expect(gitSync(wt, ['rev-parse', 'HEAD'])).toBe(gitSync(repo, ['rev-parse', 'main']))
  })
})

/** A running plan in its own worktree, the loop's origin sync over the real commands, and what it said. */
async function plan(o: { originSync?: 'off' } = {}) {
  const runWt = await fork('run')
  const job = createJob({ ...emptyState(), projects: [{ id: 'p1', path: repo, name: 'game', addedAt: NOW, defaultBranch: 'main', ...o }] }, { objective: 'o', cwd: repo }, NOW)
  if (!job.ok) throw new Error(job.error)
  const run = startJobRun(job.state, job.value.id, NOW)
  if (!run.ok) throw new Error(run.error)
  const withWt = setRunWorktree(run.state, run.value.id, runWt)
  if (!withWt.ok) throw new Error(withWt.error)
  const t1 = createTask(withWt.state, { runId: run.value.id, title: 'A', spec: 'do A', deps: [] }, NOW)
  if (!t1.ok) throw new Error(t1.error)
  const box: { state: OrchState } = { state: t1.state }
  const clock = { ms: Date.parse(NOW) }
  const deps = {
    getState: () => box.state,
    setState: async (next: OrchState) => {
      box.state = next
    },
    now: () => new Date(clock.ms).toISOString(),
    listAccounts: () => [],
    github: {
      run: async () => ({ ok: false, stdout: '', stderr: 'no gh here' }),
      worktreeOf: (p: string) => registry.list().find((w) => w.path === p) ?? null,
      push: (w: string, b: string) => pushBranch(w, b)
    }
  } as unknown as OrchServerDeps
  const activity: string[] = []
  const opened: { runId: string; tip: string; reason: string }[] = []
  const sync = () =>
    createOriginSync({
      getState: () => box.state,
      handle: (cmd, args) => handleCommand(deps, { sessionId: HOST_CALLER }, cmd, args),
      openIntegration: async (runId, tip, reason) => {
        opened.push({ runId, tip, reason })
      },
      activity: (_runId, reason) => activity.push(reason),
      log: (m) => logs.push(m),
      nowMs: () => clock.ms,
      mayStart: () => true
    })
  const branch = gitSync(runWt, ['symbolic-ref', '--short', 'HEAD'])
  return { runWt, runId: run.value.id, box, clock, activity, opened, sync, branch }
}

describe('origin sync of a running plan (T4)', () => {
  it("a teammate's push during a Run lands in the plan branch after a sync tick, and the plan branch is pushed", async () => {
    const p = await plan()
    const loop = p.sync()
    await loop.tick() // the first look syncs at once: nothing new yet
    expect(p.box.state.runs[0].lastOriginSyncAt).toBe(NOW)
    const theirs = await teammatePushes('mate.txt', 'hi')
    p.clock.ms += ORIGIN_SYNC_EVERY_MS
    await loop.tick()
    expect(holds(p.runWt, theirs)).toBe(true)
    expect(gitSync(origin, ['rev-parse', p.branch])).toBe(gitSync(p.runWt, ['rev-parse', 'HEAD']))
    expect(p.activity.filter((a) => a.includes('synced with origin/main: 1 incoming'))).toHaveLength(1)
    expect(logs.some((l) => l.startsWith('plan.synced'))).toBe(true)
    expect(p.box.state.runs[0].branchPush).toMatchObject({ state: 'delivered' })
  })

  it('a conflicting teammate change opens one integration Task, naming the file, and holds new dispatches', async () => {
    const p = await plan()
    await fs.writeFile(path.join(p.runWt, 'f.txt'), 'plan')
    commit(p.runWt, 'f.txt', 'plan')
    const theirs = await teammatePushes('f.txt', 'teammate')
    const before = gitSync(p.runWt, ['rev-parse', 'HEAD'])
    await p.sync().tick()
    expect(p.opened).toHaveLength(1)
    expect(p.opened[0]).toMatchObject({ tip: theirs })
    expect(p.opened[0].reason).toContain(ORIGIN_SYNC_MARK)
    expect(p.opened[0].reason).toContain('f.txt')
    expect(gitSync(p.runWt, ['rev-parse', 'HEAD'])).toBe(before) // nothing was written
    expect(gitSync(p.runWt, ['status', '--porcelain'])).toBe('')
    // the loop's startMergeWorker made it: the Run's new Tasks wait, and no second one is opened
    const merge = { id: 't_merge', runId: p.runId, parentId: p.box.state.tasks[0].id, title: 'merge', spec: p.opened[0].reason, deps: [], status: 'dispatched' } as unknown as Task
    p.box.state = { ...p.box.state, tasks: [...p.box.state.tasks, merge] }
    expect(originSyncHold(p.box.state, p.runId)?.id).toBe('t_merge')
    p.clock.ms += ORIGIN_SYNC_EVERY_MS
    await p.sync().tick()
    expect(p.opened).toHaveLength(1)
    p.box.state = { ...p.box.state, tasks: p.box.state.tasks.map((t) => (t.id === 't_merge' ? { ...t, status: 'completed' } : t)) }
    expect(originSyncHold(p.box.state, p.runId)).toBeUndefined()
  })

  it('no origin remote: the Run goes on, with one activity line and no error', async () => {
    const p = await plan()
    gitSync(repo, ['remote', 'remove', 'origin'])
    const loop = p.sync()
    await loop.tick()
    p.clock.ms += ORIGIN_SYNC_EVERY_MS
    await loop.tick()
    expect(p.activity).toEqual(['Plan o has no origin remote, so it is not kept in sync with teammates\' pushes'])
    expect(logs.some((l) => l.includes('origin sync failed'))).toBe(false)
    expect(p.box.state.runs[0].lastOriginSyncAt).toBe(new Date(p.clock.ms).toISOString())
  })

  it('does not sync twice within 10 minutes across a restart', async () => {
    const p = await plan()
    await p.sync().tick()
    const theirs = await teammatePushes('mate.txt', 'hi')
    p.clock.ms += 5 * 60_000
    await p.sync().tick() // a restarted Host: a fresh loop, the persisted time
    expect(holds(p.runWt, theirs)).toBe(false)
    p.clock.ms += 5 * 60_000
    await p.sync().tick()
    expect(holds(p.runWt, theirs)).toBe(true)
  })

  it('a project with originSync off is never synced', async () => {
    const p = await plan({ originSync: 'off' })
    const theirs = await teammatePushes('mate.txt', 'hi')
    await p.sync().tick()
    expect(holds(p.runWt, theirs)).toBe(false)
    expect(p.box.state.runs[0].lastOriginSyncAt).toBeUndefined()
  })

  it('workers forked after a sync start from the updated plan branch', async () => {
    const p = await plan()
    const theirs = await teammatePushes('mate.txt', 'hi')
    await p.sync().tick()
    const worker = await forkWorktree({ repoPath: repo, name: 'worker', baseOf: p.runWt }, { registry, log: (m) => logs.push(m) })
    expect(holds(worker, theirs)).toBe(true)
  })
})
