// The Host's worktree sweeps read git facts a few folders at a time, and only for the folders they may remove
// (2026-11-15: all 129 worktrees at once froze the Host's file calls for 72 s at every start).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorktreeListItem } from '../types'
import { emptyState, type OrchState } from '../orchestration/state'
import type { Task } from '../orchestration/types'

let inFlight = 0
let peak = 0
const asked: string[] = []
vi.mock('./remove', async (orig) => ({
  ...(await orig<typeof import('./remove')>()),
  blockingChanges: async (p: string) => {
    asked.push(p)
    peak = Math.max(peak, ++inFlight)
    await new Promise((r) => setTimeout(r, 5))
    inFlight--
    return { count: 0, untrackedCount: 0, untracked: [] }
  }
}))
vi.mock('./git', async (orig) => ({ ...(await orig<typeof import('./git')>()), git: async () => ({ ok: false, stdout: '', stderr: '' }) }))
vi.mock('./push', async (orig) => ({ ...(await orig<typeof import('./push')>()), readPushState: async () => ({}) }))

const { cleanRun, ROW_GIT_CONCURRENCY, worktreeRows } = await import('./cleanupRun')

const NOW = '2026-11-15T00:00:00.000Z'
const item = (i: number): WorktreeListItem => ({
  id: `w${i}`, repoPath: 'C:/repo', path: `C:/wt/w${i}`, name: `w${i}`, branch: `me/w${i}`, baseRef: 'main', createdAt: NOW, status: 'ok'
})
const items = Array.from({ length: 50 }, (_, i) => item(i))
/** Two plans: run_1 worked in w0 and w1, run_2 in every other folder. */
const state = {
  ...emptyState(),
  jobs: [{ id: 'job_1', objective: 'P', cwd: 'C:/repo', createdAt: NOW }],
  runs: [
    { id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: NOW },
    { id: 'run_2', jobId: 'job_1', ordinal: 2, createdAt: NOW }
  ],
  tasks: items.map((w, i) => ({ id: `t${i}`, runId: i < 2 ? 'run_1' : 'run_2', status: 'completed' }) as Task),
  dispatches: items.map((w, i) => ({ id: `d${i}`, taskId: `t${i}`, cwd: w.path, sessionId: `s${i}` }))
} as OrchState

beforeEach(() => {
  inFlight = 0
  peak = 0
  asked.length = 0
})

describe('worktreeRows bound', () => {
  it(`reads at most ${ROW_GIT_CONCURRENCY} folders at once however many there are, in the items' order`, async () => {
    const rows = await worktreeRows(items, state, () => null)
    expect(asked).toHaveLength(50)
    expect(peak).toBe(ROW_GIT_CONCURRENCY)
    expect(rows.map((r) => r.item.id)).toEqual(items.map((w) => w.id))
  })

  it("a plan's clean-up asks git about that plan's folders only", async () => {
    await cleanRun('run_1', { registry: {} as never, list: async () => items, state: () => state, isPathInUse: () => null })
    expect(asked).toEqual(['C:/wt/w0', 'C:/wt/w1'])
  })
})
