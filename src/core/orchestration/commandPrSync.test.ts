// T6: runs-pr-sync asks GitHub for each ready, not-landed PR and records merged/closed. Over a fake gh; nothing real runs.
import { describe, it, expect } from 'vitest'
import { handleCommand, type OrchServerDeps } from './command'
import { emptyState, type OrchState } from './state'
import type { JobRun, RunPr } from './types'
import type { GhResult } from '../github/gh'
import { APP_CALLER } from '../host/driver'

const NOW = '2026-10-27T12:00:00.000Z'
const url = (n: number): string => `https://github.com/o/r/pull/${n}`

const run = (id: string, pr: RunPr | undefined, over: Partial<JobRun> = {}): JobRun =>
  ({ id, jobId: 'job_1', ordinal: 1, createdAt: NOW, worktree: `/wt/${id}`, ...(pr ? { pr } : {}), ...over }) as JobRun

/** `states` answers `gh pr view <url>` by PR url: a state name, or undefined for a gh failure. */
const setup = (runs: JobRun[], states: Record<string, string | undefined>) => {
  const box: { state: OrchState } = {
    state: { ...emptyState(), jobs: [{ id: 'job_1', objective: 'x', cwd: '/repo', createdAt: NOW }], runs }
  }
  const asked: string[] = []
  const cwds: string[] = []
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
  return { call, asked, cwds, runOf: (id: string) => box.state.runs.find((r) => r.id === id)! }
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
})
