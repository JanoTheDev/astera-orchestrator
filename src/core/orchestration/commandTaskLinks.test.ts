// W2-D GitHub links: task-link-issue, worker_done's --issue, and run-open-pr, over a fake gh keyed by argv. Nothing here
// runs a real gh or git.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { handleCommand, linkReportedWork, type OrchServerDeps } from './command'
import { emptyState, type OrchState } from './state'
import type { Dispatch, JobRun, Task } from './types'
import type { GhResult } from '../github/gh'
import type { PrCreateRequest } from '../github/prCreate'
import { taskMarker } from '../github/taskLinks'

const NOW = '2026-10-17T00:00:00.000Z'
const WT = '/wt/run'
const info = { id: 'w1', repoPath: '/repo', path: WT, name: 'run', branch: 'astera/run', baseRef: 'main', createdAt: NOW }
const ISSUE_URL = (n: number): string => `https://github.com/o/r/issues/${n}`
const issueJson = (n: number, over: Record<string, unknown> = {}) => ({
  number: n, title: 'Add login', body: '', state: 'open', labels: [], user: { login: 'me' }, author_association: 'OWNER', html_url: ISSUE_URL(n), ...over
})

let repo: string
beforeEach(async () => {
  repo = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-tasklinks-'))
})
afterEach(async () => {
  await fs.rm(repo, { recursive: true, force: true })
})

const task = (over: Partial<Task> = {}): Task =>
  ({ id: 't1', runId: 'r1', title: 'Add login', spec: 'Make login work', deps: [], status: 'completed', consecutiveFailures: 0, createdAt: NOW, updatedAt: NOW, ...over }) as Task

/** A plan with one Run and its Tasks, a fake gh answering by argv (a function of it, for searches) and fakes for the
 *  github dep's writes. */
const setup = (o: { gh?: (args: string[]) => Partial<GhResult> | undefined; tasks?: Task[]; run?: Partial<JobRun>; dispatches?: Dispatch[] } = {}) => {
  const box: { state: OrchState } = {
    state: {
      ...emptyState(),
      jobs: [{ id: 'job_1', objective: 'Refactor auth', cwd: repo, createdAt: NOW }],
      runs: [{ id: 'r1', jobId: 'job_1', ordinal: 1, createdAt: NOW, worktree: WT, ...o.run } as JobRun],
      tasks: o.tasks ?? [task()],
      dispatches: o.dispatches ?? []
    }
  }
  const ghCalls: string[][] = []
  const prs: PrCreateRequest[] = []
  const merges: [string, string[]][] = []
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
    mergeWorktrees: async (into: string, paths: string[]) => {
      merges.push([into, paths])
      return { ok: true as const, merged: paths, uncommitted: 0 }
    },
    github: {
      run: async (args: string[]): Promise<GhResult> => {
        ghCalls.push(args)
        const a = o.gh?.(args)
        return a ? { ok: true, stdout: '', stderr: '', ...a } : { ok: false, stdout: '', stderr: `unexpected gh call: ${args.join(' ')}` }
      },
      worktreeOf: (p: string) => (p === WT ? info : p === '/wt/t1' ? { ...info, path: p, branch: 'astera/t1' } : null),
      createPr: async (req: PrCreateRequest) => {
        prs.push(req)
        return { ok: true as const, url: 'https://github.com/o/r/pull/13' }
      },
      readCommits: async () => [{ subject: 'Add login', body: '' }],
      isClean: async () => ({ changedCount: 0 })
    }
  } as unknown as OrchServerDeps
  const call = (cmd: string, args: Record<string, unknown>) => handleCommand(deps, { sessionId: 'coordinator' }, cmd, args)
  return { deps, call, ghCalls, prs, merges, state: () => box.state }
}

const isList = (a: string[]): boolean => a[0] === 'issue' && a[1] === 'list'
const isCreate = (a: string[]): boolean => a[0] === 'issue' && a[1] === 'create'
const searching = (a: string[], rows: unknown[]): Partial<GhResult> | undefined => (isList(a) ? { stdout: JSON.stringify(rows) } : undefined)
const existing = { number: 7, title: 'Add login', url: ISSUE_URL(7), body: '', state: 'OPEN' }

describe('task-link-issue', () => {
  it('--find links the issue that is already there, persists it, and creates nothing', async () => {
    const { call, ghCalls, state } = setup({ gh: (a) => searching(a, [existing]) })
    expect(await call('task-link-issue', { id: 't1', find: true })).toEqual({
      status: 200,
      body: { task: 't1', issue: { number: 7, url: ISSUE_URL(7) }, created: false }
    })
    expect(state().tasks[0].links).toEqual({ issue: { number: 7, url: ISSUE_URL(7) } })
    expect(ghCalls.some(isCreate)).toBe(false)
  })

  it('--find with nothing there is 404 and creates nothing', async () => {
    const { call, ghCalls, state } = setup({ gh: (a) => searching(a, []) })
    expect((await call('task-link-issue', { id: 't1', find: true })).status).toBe(404)
    expect(ghCalls.some(isCreate)).toBe(false)
    expect(state().tasks[0].links).toBeUndefined()
  })

  it("--create is refused where the repository's CLAUDE.md makes issues", async () => {
    await fs.writeFile(path.join(repo, 'CLAUDE.md'), 'For every change, create an issue and add it to the GitHub Project.')
    const { call, ghCalls } = setup({ gh: (a) => searching(a, []) })
    const r = await call('task-link-issue', { id: 't1', create: true })
    expect(r.status).toBe(409)
    expect((r.body as { error: string }).error).toMatch(/CLAUDE\.md/)
    expect(ghCalls.some(isCreate)).toBe(false)
  })

  it('--create links an issue that is already there instead of opening a duplicate', async () => {
    const { call, ghCalls } = setup({ gh: (a) => searching(a, [existing]) })
    expect((await call('task-link-issue', { id: 't1', create: true })).body).toMatchObject({ issue: { number: 7 }, created: false })
    expect(ghCalls.some(isCreate)).toBe(false)
  })

  it('--create, with no workflow and no issue, creates one carrying the marker, marked to be closed by the PR', async () => {
    const { call, ghCalls, state } = setup({
      gh: (a) => (isCreate(a) ? { stdout: ISSUE_URL(9) } : searching(a, []))
    })
    expect((await call('task-link-issue', { id: 't1', create: true })).body).toMatchObject({ issue: { number: 9 }, created: true })
    const made = ghCalls.find(isCreate)!
    expect(made[made.indexOf('--body') + 1]).toContain(taskMarker('t1'))
    expect(state().tasks[0].links?.issue).toEqual({ number: 9, url: ISSUE_URL(9), closes: true })
  })

  it('--number links that issue after reading it; a pull request number is refused', async () => {
    const { call, state } = setup({
      gh: (a) =>
        a.join(' ') === 'api repos/{owner}/{repo}/issues/5'
          ? { stdout: JSON.stringify(issueJson(5)) }
          : a.join(' ') === 'api repos/{owner}/{repo}/issues/6'
            ? { stdout: JSON.stringify(issueJson(6, { pull_request: {} })) }
            : undefined
    })
    expect((await call('task-link-issue', { id: 't1', number: '5' })).status).toBe(200)
    expect(state().tasks[0].links?.issue).toEqual({ number: 5, url: ISSUE_URL(5) })
    expect((await call('task-link-issue', { id: 't1', number: 6 })).status).toBe(404)
  })

  it('wants exactly one mode, and is the Host’s', async () => {
    const { call, deps } = setup()
    expect((await call('task-link-issue', { id: 't1' })).status).toBe(400)
    expect((await call('task-link-issue', { id: 't1', find: true, create: true })).status).toBe(400)
    deps.github = undefined
    expect((await call('task-link-issue', { id: 't1', find: true })).status).toBe(409)
  })

  it('is refused to a worker', async () => {
    const { deps } = setup()
    const d = { id: 'd1', taskId: 't1', sessionId: 'worker1', cwd: '/wt/t1' } as Dispatch
    deps.setState({ ...deps.getState(), dispatches: [d] })
    expect((await handleCommand(deps, { sessionId: 'worker1' }, 'task-link-issue', { id: 't1', find: true })).status).toBe(403)
  })
})

describe("worker_done's --issue links the Task", () => {
  const dispatch = { id: 'd1', taskId: 't1', sessionId: 'w1', cwd: '/wt/t1', accountId: 'acc1' } as Dispatch

  it('links the reported issue, the worktree branch, and keeps them', async () => {
    const { deps, state } = setup({ dispatches: [dispatch], gh: (a) => (a[1] === 'repos/{owner}/{repo}/issues/12' ? { stdout: JSON.stringify(issueJson(12)) } : undefined) })
    await linkReportedWork(deps, 't1', 'd1', { issue: '12', issueCreated: true })
    expect(state().tasks[0].links).toEqual({ issue: { number: 12, url: ISSUE_URL(12), closes: true }, branch: 'astera/t1' })
    // A second report adds; it does not wipe
    await linkReportedWork(deps, 't1', 'd1', {})
    expect(state().tasks[0].links?.issue?.number).toBe(12)
  })

  it('an issue gh cannot read is logged and left unlinked; the branch still is', async () => {
    const log = vi.fn()
    const { deps, state } = setup({ dispatches: [dispatch] })
    deps.log = log
    await linkReportedWork(deps, 't1', 'd1', { issue: 3 })
    expect(state().tasks[0].links).toEqual({ branch: 'astera/t1' })
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/issue #3 was not linked/))
  })

  it('reaches the Task through `send --type worker_done`', async () => {
    const open = { ...dispatch, provider: 'claude', specPath: '/x/a.md', startedAt: NOW, workerState: 'running', retained: false } as unknown as Dispatch
    const { deps, state } = setup({
      tasks: [task({ status: 'dispatched' })],
      dispatches: [open],
      gh: (a) => (a[1] === 'repos/{owner}/{repo}/issues/12' ? { stdout: JSON.stringify(issueJson(12)) } : undefined)
    })
    const r = await handleCommand(deps, { sessionId: 'w1' }, 'send', {
      type: 'worker_done', taskId: 't1', dispatchId: 'd1', outcome: 'succeeded', subject: 'done', issue: '12'
    })
    expect(r.status).toBe(200)
    await vi.waitFor(() => expect(state().tasks[0].links?.issue?.number).toBe(12))
  })
})

describe('run-open-pr: one pull request per plan', () => {
  const ghForPr = (a: string[]): Partial<GhResult> | undefined =>
    a[0] === 'repo' && a[1] === 'view' ? { stdout: 'main\n' } : undefined
  const done = [task({ links: { issue: { number: 3, url: ISSUE_URL(3), closes: true } } }), task({ id: 't2', title: 'Add logout' })]
  const workers = [
    { id: 'd1', taskId: 't1', cwd: '/wt/t1', accountId: 'acc1', model: 'sonnet' } as Dispatch,
    { id: 'd2', taskId: 't2', cwd: WT, accountId: 'acc1' } as Dispatch
  ]

  it("folds the leaves into the Run's branch, opens one non-draft PR on the default branch, and records it", async () => {
    const { call, prs, merges, state } = setup({ gh: ghForPr, tasks: done, dispatches: workers })
    expect(await call('run-open-pr', { run: 'r1' })).toEqual({
      status: 200,
      body: { url: 'https://github.com/o/r/pull/13', number: 13, opened: true }
    })
    expect(merges).toEqual([[WT, ['/wt/t1']]])
    expect(prs).toHaveLength(1)
    expect(prs[0]).toMatchObject({ worktreePath: WT, branch: 'astera/run', base: 'main', title: 'Refactor auth', draft: false, needsPush: true })
    expect(prs[0].body).toContain('### Add login')
    expect(prs[0].body).toContain('### Add logout')
    expect(prs[0].body).toContain('Closes #3')
    expect(prs[0].body).toContain('model `sonnet`, account `Work`')
    expect(state().runs[0].pr).toEqual({ at: NOW, url: 'https://github.com/o/r/pull/13', number: 13 })
    expect(state().tasks.map((t) => t.links?.prs)).toEqual([
      [{ number: 13, url: 'https://github.com/o/r/pull/13', state: 'open' }],
      [{ number: 13, url: 'https://github.com/o/r/pull/13', state: 'open' }]
    ])
    // Asked again: the same PR, nothing opened
    expect((await call('run-open-pr', { run: 'r1' })).body).toMatchObject({ opened: false, number: 13 })
    expect(prs).toHaveLength(1)
  })

  it('is refused while the Run works, and for a Run with no integration branch', async () => {
    expect((await setup({ tasks: [task({ status: 'dispatched' })] }).call('run-open-pr', { run: 'r1' })).status).toBe(409)
    const bare = setup({ run: { worktree: undefined } })
    const r = await bare.call('run-open-pr', { run: 'r1' })
    expect(r.status).toBe(409)
    expect((r.body as { error: string }).error).toMatch(/Merge/)
  })

  it('records a failure, which is tried again only with --force', async () => {
    const { call, deps, prs, state } = setup({ gh: ghForPr })
    deps.github!.createPr = async (req) => {
      prs.push(req)
      return { ok: false, stage: 'push', kind: 'rejected', detail: 'rejected', pushed: false }
    }
    expect((await call('run-open-pr', { run: 'r1' })).status).toBe(409)
    expect(state().runs[0].pr).toMatchObject({ error: 'The push was rejected' })
    expect((await call('run-open-pr', { run: 'r1' })).status).toBe(409)
    expect(prs).toHaveLength(1)
    deps.github!.createPr = async () => ({ ok: true, url: 'https://github.com/o/r/pull/14' })
    expect((await call('run-open-pr', { run: 'r1', force: true })).body).toMatchObject({ number: 14, opened: true })
  })

  it("an existing PR for the branch (gh's \"already exists\") is linked as the plan's", async () => {
    const { call, deps, state } = setup({ gh: ghForPr })
    deps.github!.createPr = async () => ({
      ok: false, stage: 'create', kind: 'exists', pushed: true,
      detail: 'a pull request for branch "astera/run" into branch "main" already exists:\nhttps://github.com/o/r/pull/11'
    })
    expect((await call('run-open-pr', { run: 'r1' })).body).toMatchObject({ number: 11, opened: false })
    expect(state().runs[0].pr?.url).toBe('https://github.com/o/r/pull/11')
  })
})
