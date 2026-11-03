// A worker's succeeded report commits what it left uncommitted in its worktree before the Task moves on (owner report
// 2026-11-02, run_d7918893935ddbd7: a staged change, never committed, was reviewed and counted done, and the delivery
// could not carry it). Over a real git repository as the worker's worktree.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { promises as fs, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { handleCommand, type OrchServerDeps } from './command'
import { emptyState, type OrchState } from './state'
import type { Dispatch, JobRun, Task } from './types'

const NOW = '2026-11-03T00:00:00.000Z'
const sh = (cwd: string, args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

let project: string
let worktree: string
beforeEach(async () => {
  project = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-leftover-proj-'))
  worktree = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-leftover-wt-'))
  sh(worktree, ['init', '-q', '-b', 'astera/t1'])
  sh(worktree, ['config', 'user.name', 'T'])
  sh(worktree, ['config', 'user.email', 't@example.com'])
  writeFileSync(path.join(worktree, 'a.txt'), 'one\n')
  sh(worktree, ['add', '-A'])
  sh(worktree, ['commit', '-q', '-m', 'init'])
})
afterEach(async () => {
  await fs.rm(project, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  await fs.rm(worktree, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
})

const setup = (over: Partial<Dispatch> = {}) => {
  const base = sh(worktree, ['rev-parse', 'HEAD'])
  const dispatch = {
    id: 'd1',
    taskId: 't1',
    sessionId: 'w1',
    cwd: worktree,
    accountId: 'acc1',
    provider: 'claude',
    specPath: path.join(worktree, 'spec.md'),
    startedAt: NOW,
    workerState: 'running',
    retained: false,
    git: { base },
    ...over
  } as unknown as Dispatch
  const box: { state: OrchState } = {
    state: {
      ...emptyState(),
      jobs: [{ id: 'job_1', objective: 'o', cwd: project, createdAt: NOW }],
      runs: [{ id: 'r1', jobId: 'job_1', ordinal: 1, createdAt: NOW } as JobRun],
      tasks: [{ id: 't1', runId: 'r1', title: 'Popovers keep scroll', spec: 's', deps: [], status: 'dispatched', consecutiveFailures: 0, createdAt: NOW, updatedAt: NOW } as Task],
      dispatches: [dispatch]
    }
  }
  const logs: string[] = []
  const deps = {
    getState: () => box.state,
    setState: async (next: OrchState) => {
      box.state = next
    },
    startWorker: async () => ({ sessionId: 's', cwd: '/x', specPath: '/x/a.md' }),
    releaseWorker: async () => {},
    listAccounts: () => [{ id: 'acc1', label: 'Work', provider: 'claude' }],
    readWorker: async () => '',
    now: () => NOW,
    log: (m: string) => logs.push(m)
  } as unknown as OrchServerDeps
  const report = () =>
    handleCommand(deps, { sessionId: 'w1' }, 'send', { type: 'worker_done', taskId: 't1', dispatchId: 'd1', outcome: 'succeeded', subject: 'done' })
  return { report, state: () => box.state, logs }
}

describe('a succeeded report with work left uncommitted', () => {
  it('commits the staged change in the worker\'s worktree before the Task moves on', async () => {
    writeFileSync(path.join(worktree, 'a.txt'), 'two\n')
    sh(worktree, ['add', 'a.txt'])
    const h = setup()
    const r = await h.report()
    expect(r.status).toBe(200)
    expect(sh(worktree, ['status', '--porcelain'])).toBe('')
    expect(sh(worktree, ['log', '-1', '--format=%s'])).toContain('work left uncommitted at its report')
    expect(h.state().tasks[0].status).not.toBe('dispatched')
    expect(h.logs.some((m) => m.includes('Astera committed them'))).toBe(true)
  })

  it('leaves a clean worktree alone', async () => {
    const before = sh(worktree, ['rev-parse', 'HEAD'])
    const h = setup()
    expect((await h.report()).status).toBe(200)
    expect(sh(worktree, ['rev-parse', 'HEAD'])).toBe(before)
  })

  it('never commits in the plan\'s project folder, the owner\'s own checkout', async () => {
    writeFileSync(path.join(worktree, 'a.txt'), 'two\n')
    const h = setup()
    const s = h.state()
    // the Run has no worktree of its own and works in the project folder: that folder is the worktree here
    s.jobs[0] = { ...s.jobs[0], cwd: worktree }
    expect((await h.report()).status).toBe(200)
    expect(sh(worktree, ['status', '--porcelain'])).toBe('M a.txt')
  })

  it('refuses the worker\'s report, with what to do, when its work cannot be committed', async () => {
    sh(worktree, ['checkout', '-q', '-b', 'side'])
    writeFileSync(path.join(worktree, 'a.txt'), 'side\n')
    sh(worktree, ['commit', '-q', '-am', 'side'])
    sh(worktree, ['checkout', '-q', 'astera/t1'])
    writeFileSync(path.join(worktree, 'a.txt'), 'main\n')
    sh(worktree, ['commit', '-q', '-am', 'main'])
    try {
      sh(worktree, ['merge', 'side'])
    } catch {
      // the conflict is the point
    }
    const h = setup()
    const r = await h.report()
    expect(r.status).toBe(409)
    expect((r.body as { error: string }).error).toContain('git add -A && git commit')
    expect(h.state().tasks[0].status).toBe('dispatched')
  })
})
