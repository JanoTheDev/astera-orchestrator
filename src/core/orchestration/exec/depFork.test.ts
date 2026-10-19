// W5-A: a dependent Task's worktree carries its deps' commits (#50), and a merge works when git has no
// identity (#51). Real temp repositories; only the session spawn is faked.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { makeRepo, gitSync, tempDir } from '../../worktrees/testRepo'
import { WorktreeRegistry } from '../../worktrees/registry'
import { git } from '../../worktrees/git'
import { forkWorktree, integrateWorktrees, mergeDepsInto, mergeIdentityArgs, FALLBACK_GIT_IDENTITY } from './integrateGit'
import { OrchCoordinator } from './coordinator'
import { forkForDeps, startWorkerWithChain } from './workerStart'
import { WorkerTails } from './tail'
import { closeDispatch, createJob, createTask, emptyState, openDispatch, setRunWorktree, startJobRun, type OrchState } from '../state'
import type { Account } from '../../types'

const NOW = '2026-10-18T00:00:00.000Z'
// Fixture commits carry their own identity, so they work whatever this machine's git config says.
const commit = (cwd: string, file: string): string => {
  gitSync(cwd, ['add', file])
  gitSync(cwd, ['-c', 'user.name=Fixture', '-c', 'user.email=f@f', 'commit', '-m', `add ${file}`])
  return gitSync(cwd, ['rev-parse', 'HEAD'])
}
const isAncestor = async (sha: string, cwd: string): Promise<boolean> =>
  (await git(['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd })).ok

let repo: string, registry: WorktreeRegistry, logs: string[]
beforeEach(async () => {
  repo = await makeRepo('astera-depfork-')
  const root = await tempDir('astera-depfork-root-')
  registry = new WorktreeRegistry(path.join(root, 'worktrees.json'), root); await registry.load()
  logs = []
})
const fork = (a: { repoPath: string; name?: string; baseOf?: string }) => forkWorktree(a, { registry, log: (m) => logs.push(m) })

/** A ∥ B → C: a Run with its own worktree, A and B finished in their own worktrees with one commit each. */
async function plan(): Promise<{ s: OrchState; runWt: string; a: string; b: string; shaA: string; shaB: string; c: string }> {
  const runWt = await fork({ repoPath: repo, name: 'run' })
  const a = await fork({ repoPath: repo, name: 'a' })
  const b = await fork({ repoPath: repo, name: 'b' })
  await fs.writeFile(path.join(a, 'a.txt'), 'a'); const shaA = commit(a, 'a.txt')
  await fs.writeFile(path.join(b, 'b.txt'), 'b'); const shaB = commit(b, 'b.txt')
  const job = createJob(emptyState(), { objective: 'o', cwd: repo }, NOW); if (!job.ok) throw new Error(job.error)
  const run = startJobRun(job.state, job.value.id, NOW); if (!run.ok) throw new Error(run.error)
  const withWt = setRunWorktree(run.state, run.value.id, runWt); if (!withWt.ok) throw new Error(withWt.error)
  let s = withWt.state
  const ids: string[] = []
  for (const [title, cwd] of [['A', a], ['B', b]] as const) {
    const t = createTask(s, { runId: run.value.id, title, spec: 's', deps: [] }, NOW); if (!t.ok) throw new Error(t.error)
    const d = openDispatch(t.state, { taskId: t.value.id, provider: 'claude', accountId: 'acc1', sessionId: `ses_${title}`, cwd, specPath: '' }, NOW)
    if (!d.ok) throw new Error(d.error)
    const closed = closeDispatch(d.state, { sessionId: `ses_${title}`, exitCode: 0 }, NOW); if (!closed.ok) throw new Error(closed.error)
    s = closed.state; ids.push(t.value.id)
  }
  const c = createTask(s, { runId: run.value.id, title: 'C', spec: 's', deps: ids }, NOW); if (!c.ok) throw new Error(c.error)
  return { s: c.state, runWt, a, b, shaA, shaB, c: c.value.id }
}

describe('a dependent Task forks with its deps (#50)', () => {
  it("A ∥ B → C: C's new worktree holds A's and B's commits, started through the real coordinator", async () => {
    const p = await plan()
    const spawned: Array<{ cwd: string }> = []
    const coordinator = new OrchCoordinator({
      spawnSession: async (o) => { spawned.push({ cwd: o.cwd }); return { id: 'ses_C' } },
      writeToSession: () => {}, isBusy: () => false, isAlive: () => true, killSession: () => {},
      createWorktree: async (a) => ({ path: await fork(a) }),
      mergeIntoWorktree: (wt, from) => mergeDepsInto(wt, from, { log: (m) => logs.push(m) }),
      accountProvider: () => 'claude',
      specsDir: await tempDir('astera-depfork-specs-'),
      log: (m) => logs.push(m)
    })
    const acct: Account = { id: 'acc1', label: 'one', configDir: path.join(repo, '..', 'cfg'), color: '#888', createdAt: NOW, provider: 'claude' }
    const r = await startWorkerWithChain(
      { getState: () => p.s, accounts: async () => [acct], loginStatus: async () => true, coordinator, tails: new WorkerTails(), log: (m) => logs.push(m), roleModels: async () => ({}) },
      { dispatchId: 'dsp_C', taskId: p.c, title: 'C', spec: 's', provider: 'claude', accountId: 'acc1', runCwd: repo, worktree: 'new', name: 'c' }
    )
    expect(spawned[0].cwd).toBe(r.cwd)
    expect(await isAncestor(p.shaA, r.cwd)).toBe(true)
    expect(await isAncestor(p.shaB, r.cwd)).toBe(true)
    expect(await fs.readFile(path.join(r.cwd, 'a.txt'), 'utf8')).toBe('a')
    expect(await fs.readFile(path.join(r.cwd, 'b.txt'), 'utf8')).toBe('b')
  })

  it("forks from the Run's worktree, so deps the scheduler merged and reaped are there too", async () => {
    const p = await plan()
    // The scheduler's integration: A merged into the Run's worktree, then A's folder reaped.
    gitSync(p.runWt, ['-c', 'user.name=Fixture', '-c', 'user.email=f@f', 'merge', '--no-edit', p.shaA])
    gitSync(repo, ['worktree', 'remove', '--force', p.a])
    const f = forkForDeps(p.s, { dispatchId: 'd', taskId: p.c, title: 'C', spec: 's', provider: 'claude', accountId: 'acc1', runCwd: repo, worktree: 'new', name: 'c' })
    expect(f).toEqual({ base: p.runWt, merge: [p.a, p.b] })
    const c = await fork({ repoPath: repo, name: 'c', baseOf: f!.base })
    await mergeDepsInto(c, f!.merge, { log: (m) => logs.push(m) })
    expect(await isAncestor(p.shaA, c)).toBe(true)
    expect(await isAncestor(p.shaB, c)).toBe(true)
    expect(logs.join('\n')).toMatch(/not readable, so not merged/)
  })

  it('leaves a Task without deps, a reuse and a non-new placement as before', async () => {
    const p = await plan()
    const base = { dispatchId: 'd', title: 't', spec: 's', provider: 'claude' as const, accountId: 'acc1', runCwd: repo }
    const noDeps = p.s.tasks.find((t) => t.title === 'A')!.id
    expect(forkForDeps(p.s, { ...base, taskId: noDeps, worktree: 'new', name: 'x' })).toBeUndefined()
    expect(forkForDeps(p.s, { ...base, taskId: p.c, worktree: p.runWt })).toBeUndefined()
    expect(forkForDeps(p.s, { ...base, taskId: p.c, worktree: 'new', name: 'x', terminal: 'ses_A' })).toBeUndefined()
  })

  it('aborts a conflicting dep merge and throws, leaving the fork clean', async () => {
    const p = await plan()
    await fs.writeFile(path.join(p.b, 'a.txt'), 'b wrote it'); commit(p.b, 'a.txt')
    const c = await fork({ repoPath: repo, name: 'c' })
    await expect(mergeDepsInto(c, [p.a, p.b], { log: () => {} })).rejects.toThrow(/DEP_MERGE/)
    expect((await git(['status', '--porcelain'], { cwd: c })).stdout).toBe('')
  })
})

describe('merging with no git identity (#51)', () => {
  const saved = { global: process.env.GIT_CONFIG_GLOBAL, nosystem: process.env.GIT_CONFIG_NOSYSTEM }
  beforeEach(() => {
    // No global or system identity, and no guessing: git refuses to commit exactly as on the W4 machine.
    process.env.GIT_CONFIG_GLOBAL = path.join(repo, 'no-such-gitconfig')
    process.env.GIT_CONFIG_NOSYSTEM = '1'
    gitSync(repo, ['config', '--unset', 'user.name'])
    gitSync(repo, ['config', '--unset', 'user.email'])
    gitSync(repo, ['config', 'user.useConfigOnly', 'true'])
  })
  afterEach(() => {
    for (const [k, v] of [['GIT_CONFIG_GLOBAL', saved.global], ['GIT_CONFIG_NOSYSTEM', saved.nosystem]] as const)
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
  })

  it('the scheduler merge of two worktrees succeeds, committed as the fallback identity, and writes no config', async () => {
    expect((await git(['var', 'GIT_COMMITTER_IDENT'], { cwd: repo })).ok).toBe(false)
    const a = await fork({ repoPath: repo, name: 'a' }); await fs.writeFile(path.join(a, 'a.txt'), 'a'); commit(a, 'a.txt')
    const b = await fork({ repoPath: repo, name: 'b' }); await fs.writeFile(path.join(b, 'b.txt'), 'b'); commit(b, 'b.txt')
    const configBefore = await fs.readFile(path.join(repo, '.git', 'config'), 'utf8')
    const r = await integrateWorktrees(repo, [a, b], { reap: false }, {
      log: () => {}, gitOp: { begin: () => 'op', end: () => {} }, reap: async () => true
    })
    expect(r.kind).toBe('merged')
    expect(gitSync(repo, ['log', '-1', '--format=%cn <%ce>'])).toBe(`${FALLBACK_GIT_IDENTITY.name} <${FALLBACK_GIT_IDENTITY.email}>`)
    // W8-A: the merge adds the Wave 8 notes config (notes.*), never an identity
    const configAfter = await fs.readFile(path.join(repo, '.git', 'config'), 'utf8')
    expect(configAfter.startsWith(configBefore)).toBe(true)
    expect(configAfter.slice(configBefore.length)).not.toMatch(/\[user\]|name|email/)
  })

  it("supplies only the missing key, so a person's own name or email wins", async () => {
    gitSync(repo, ['config', 'user.name', 'Me'])
    expect(await mergeIdentityArgs(repo)).toEqual(['-c', `user.email=${FALLBACK_GIT_IDENTITY.email}`])
    gitSync(repo, ['config', 'user.email', 'me@x'])
    expect(await mergeIdentityArgs(repo)).toEqual([])
  })
})
