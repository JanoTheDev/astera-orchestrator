// T6: runs-pr-sync asks GitHub for each ready, not-landed PR and records merged/closed. Over a fake gh; nothing real runs.
import { describe, it, expect, vi } from 'vitest'
import { handleCommand, type OrchServerDeps } from './command'
import { emptyState, type OrchState } from './state'
import type { Job, JobRun, RunPr } from './types'
import type { GhResult } from '../github/gh'
import type { GitResult } from '../worktrees/git'
import { APP_CALLER } from '../host/driver'

// runs-pr-sync reaches git through the worktrees module, as the rest of command.ts does; the fake answers it per test
const gitBox = vi.hoisted(() => ({ answer: (_args: string[], _cwd: string): unknown => ({ ok: false, stdout: '', stderr: 'no fake' }) }))
vi.mock('../worktrees/git', async (orig) => ({
  ...(await orig<typeof import('../worktrees/git')>()),
  git: async (args: string[], opts?: { cwd?: string }) => gitBox.answer(args, opts?.cwd ?? '')
}))

const NOW = '2026-10-27T12:00:00.000Z'
const url = (n: number): string => `https://github.com/o/r/pull/${n}`

const run = (id: string, pr: RunPr | undefined, over: Partial<JobRun> = {}): JobRun =>
  ({ id, jobId: 'job_1', ordinal: 1, createdAt: NOW, worktree: `/wt/${id}`, ...(pr ? { pr } : {}), ...over }) as JobRun

/** What the fake git knows: the branch each Run folder stands on, the branches that exist, and which of them are in
 *  the delivery branch (`true`), are not (`false`) or make git fail (`'error'`). */
interface FakeGit {
  head?: Record<string, string>
  merged?: Record<string, boolean | 'error'>
}
const ok = (stdout = ''): GitResult => ({ ok: true, stdout, stderr: '' })
function fakeGit(g: FakeGit, args: string[], cwd: string): GitResult {
  if (args[0] === 'symbolic-ref') return g.head?.[cwd] !== undefined ? ok(g.head[cwd]) : { ok: false, stdout: '', stderr: 'not a branch' }
  if (args[0] === 'rev-parse') return ok()
  const branch = args[2].replace('refs/heads/', '')
  const v = g.merged?.[branch]
  return v === true ? ok() : v === false ? { ok: false, stdout: '', stderr: '' } : { ok: false, stdout: '', stderr: 'fatal: bad object' }
}
const awaiting = { state: 'awaiting-review', attempts: 0 } as const

/** `states` answers `gh pr view <url>` by PR url: a state name, or undefined for a gh failure. */
const setup = (runs: JobRun[], states: Record<string, string | undefined>, fake: FakeGit = {}, job: Partial<Job> = {}) => {
  const box: { state: OrchState } = {
    state: { ...emptyState(), jobs: [{ id: 'job_1', objective: 'x', cwd: '/repo', createdAt: NOW, ...job }], runs }
  }
  const gitCalls: string[][] = []
  const asked: string[] = []
  const cwds: string[] = []
  gitBox.answer = (args, cwd) => {
    gitCalls.push([...args, cwd])
    return fakeGit(fake, args, cwd)
  }
  const deps = {
    getState: () => box.state,
    setState: async (next: OrchState) => {
      box.state = next
    },
    now: () => NOW,
    github: {
      run: async (args: string[], cwd: string): Promise<GhResult> => {
        asked.push(args[2])
        cwds.push(cwd)
        const st = states[args[2]]
        return st === undefined ? { ok: false, stdout: '', stderr: 'boom' } : { ok: true, stdout: JSON.stringify({ state: st }), stderr: '' }
      }
    }
  } as unknown as OrchServerDeps
  const call = (args: Record<string, unknown> = {}) => handleCommand(deps, { sessionId: APP_CALLER }, 'runs-pr-sync', args)
  return { call, asked, cwds, gitCalls, runOf: (id: string) => box.state.runs.find((r) => r.id === id)! }
}

describe('runs-pr-sync', () => {
  it('records merged and closed, leaves an open PR unchanged', async () => {
    const t = setup(
      [run('a', { at: NOW, url: url(1) }), run('b', { at: NOW, url: url(2) }), run('c', { at: NOW, url: url(3) })],
      { [url(1)]: 'MERGED', [url(2)]: 'CLOSED', [url(3)]: 'OPEN' }
    )
    const r = await t.call()
    expect(r.body).toEqual({ checked: 3, landed: [{ runId: 'a', landed: 'merged' }, { runId: 'b', landed: 'closed' }] })
    expect(t.runOf('a').pr?.landed).toBe('merged')
    expect(t.runOf('b').pr?.landed).toBe('closed')
    expect(t.runOf('c').pr?.landed).toBeUndefined()
  })

  it('skips drafts, landed PRs and Runs without a PR', async () => {
    const t = setup([run('d', { at: NOW, url: url(1), draft: true }), run('e', { at: NOW, url: url(2), landed: 'merged' }), run('f', undefined)], {})
    expect((await t.call()).body).toEqual({ checked: 0, landed: [] })
    expect(t.asked).toEqual([])
  })

  it('skips a PR whose gh call fails, and still handles the rest', async () => {
    const t = setup([run('a', { at: NOW, url: url(1) }), run('b', { at: NOW, url: url(2) })], { [url(1)]: undefined, [url(2)]: 'MERGED' })
    expect((await t.call()).body).toEqual({ checked: 2, landed: [{ runId: 'b', landed: 'merged' }] })
    expect(t.runOf('a').pr?.landed).toBeUndefined()
  })

  it('skips a PR checked in the last 2 minutes, and asks again after that', async () => {
    const recent = new Date(Date.parse(NOW) - 60_000).toISOString()
    const old = new Date(Date.parse(NOW) - 180_000).toISOString()
    const t = setup(
      [run('a', { at: NOW, url: url(1), landedCheckedAt: recent }), run('b', { at: NOW, url: url(2), landedCheckedAt: old })],
      { [url(1)]: 'MERGED', [url(2)]: 'OPEN' }
    )
    expect((await t.call()).body).toEqual({ checked: 1, landed: [] })
    expect(t.asked).toEqual([url(2)])
    expect(t.runOf('b').pr?.landedCheckedAt).toBe(NOW)
    expect((await t.call()).body).toEqual({ checked: 0, landed: [] })
  })

  it("asks gh in the plan's repo folder, not in a Run worktree that delivery may have removed", async () => {
    const t = setup([run('a', { at: NOW, url: url(1) })], { [url(1)]: 'MERGED' })
    await t.call()
    expect(t.cwds).toEqual(['/repo'])
  })

  it('checks at most 20 PRs per call, the longest-unchecked first', async () => {
    const runs = Array.from({ length: 25 }, (_, i) => run(`r${i}`, { at: NOW, url: url(i), ...(i < 5 ? { landedCheckedAt: '2026-10-27T00:00:00.000Z' } : {}) }))
    const t = setup(runs, {})
    expect((await t.call()).body).toMatchObject({ checked: 20 })
    expect(t.asked).toHaveLength(20)
    expect([...t.asked].sort()).toEqual(Array.from({ length: 20 }, (_, i) => url(i + 5)).sort())
  })

  describe('a plan merged by hand', () => {
    it('records an awaiting-review Run with no PR whose plan branch is in the delivery branch', async () => {
      const t = setup([run('a', undefined, { deliveryState: awaiting })], {}, { head: { '/wt/a': 'plan-a' }, merged: { 'plan-a': true } }, { deliveryBranch: 'develop' })
      expect((await t.call()).body).toEqual({ checked: 1, landed: [{ runId: 'a', landed: 'merged' }] })
      expect(t.runOf('a').pr?.landed).toBe('merged')
      expect(t.runOf('a').deliveryState?.state).toBe('delivered')
      expect(t.gitCalls).toContainEqual(['merge-base', '--is-ancestor', 'refs/heads/plan-a', 'develop', '/repo'])
      expect(t.asked).toEqual([])
    })

    it("records an open PR's Run whose recorded branch is in the delivery branch, and leaves one that is not", async () => {
      const t = setup(
        [run('a', { at: NOW, url: url(1), branch: 'plan-a' }), run('b', { at: NOW, url: url(2), branch: 'plan-b' })],
        { [url(1)]: 'OPEN', [url(2)]: 'OPEN' },
        { merged: { 'plan-a': true, 'plan-b': false } },
        { deliveryBranch: 'main' }
      )
      expect((await t.call()).body).toEqual({ checked: 2, landed: [{ runId: 'a', landed: 'merged' }] })
      expect(t.runOf('b').pr?.landed).toBeUndefined()
      expect(t.runOf('b').pr?.landedCheckedAt).toBe(NOW)
    })

    it('skips only the Run git cannot answer for', async () => {
      const t = setup(
        [run('a', undefined, { deliveryState: awaiting }), run('b', undefined, { deliveryState: awaiting })],
        {},
        { head: { '/wt/a': 'plan-a', '/wt/b': 'plan-b' }, merged: { 'plan-a': 'error', 'plan-b': true } },
        { deliveryBranch: 'main' }
      )
      expect((await t.call()).body).toEqual({ checked: 2, landed: [{ runId: 'b', landed: 'merged' }] })
      expect(t.runOf('a').pr).toBeUndefined()
    })

    it('skips an awaiting-review Run with no PR that was checked within PR_SYNC_FRESH_MS', async () => {
      const t = setup([run('a', undefined, { deliveryState: awaiting })], {}, { head: { '/wt/a': 'plan-a' }, merged: { 'plan-a': false } }, { deliveryBranch: 'main' })
      expect((await t.call()).body).toEqual({ checked: 1, landed: [] })
      expect(t.runOf('a').landedCheckedAt).toBe(NOW)
      expect((await t.call()).body).toEqual({ checked: 0, landed: [] })
    })

    it('still checks a ready PR Run after more than PR_SYNC_BATCH unchecked awaiting-review Runs with no PR', async () => {
      const waiting = Array.from({ length: 21 }, (_, i) => run(`w${i}`, undefined, { deliveryState: awaiting }))
      const t = setup([...waiting, run('pr', { at: NOW, url: url(1) })], { [url(1)]: 'MERGED' }, {}, { deliveryBranch: 'main' })
      await t.call()
      await t.call()
      expect(t.asked).toEqual([url(1)])
      expect(t.runOf('pr').pr?.landed).toBe('merged')
    })

    it('leaves an awaiting-review Run whose folder stands on no branch', async () => {
      const t = setup([run('a', undefined, { deliveryState: awaiting })], {}, {}, { deliveryBranch: 'main' })
      expect((await t.call()).body).toEqual({ checked: 1, landed: [] })
    })

    it('does not count the delivery branch itself as merged', async () => {
      const t = setup([run('a', undefined, { deliveryState: awaiting })], {}, { head: { '/wt/a': 'main' }, merged: { main: true } }, { deliveryBranch: 'main' })
      expect((await t.call()).body).toEqual({ checked: 1, landed: [] })
    })
  })
})
