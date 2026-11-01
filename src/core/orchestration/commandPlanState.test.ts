// `plan-state`: a Job, its latest Run and every Task with report, review and changed files in one read, so a planner
// does not chain `jobs-get`, `tasks-list`, `dispatch-show` and `runs-changed-files`.
import { describe, it, expect } from 'vitest'
import { handleCommand, type OrchServerDeps } from './command'
import { emptyState, type OrchState } from './state'
import type { ChangedFile } from '../git/changes'

const NOW = '2026-11-01T00:00:00.000Z'
const file = (id: string, path: string): ChangedFile => ({ id, path, status: 'modified', additions: 1, deletions: 0 })

function makeDeps(state: OrchState, answers: Record<string, ChangedFile[] | null> = {}, withGit = true) {
  const box = { state }
  const asked: string[] = []
  const deps = {
    getState: () => box.state,
    setState: async (next: OrchState) => void (box.state = next),
    now: () => NOW,
    ...(withGit
      ? {
          changes: {
            read: async (repo: string, base: string, head: string | null) => {
              const key = `${repo} ${base}..${head ?? 'worktree'}`
              asked.push(key)
              return key in answers ? answers[key] : null
            },
            diff: async () => null
          }
        }
      : {})
  } as unknown as OrchServerDeps
  return { deps, asked }
}

const call = (deps: OrchServerDeps, args: Record<string, unknown>) => handleCommand(deps, { sessionId: '' }, 'plan-state', args)

const task = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  runId: 'run1',
  title: `title ${id}`,
  spec: `spec ${id}`,
  deps: [],
  status,
  consecutiveFailures: 0,
  createdAt: NOW,
  updatedAt: NOW,
  affectedPaths: [`src/${id}.ts`],
  acceptanceCriteria: [`${id} works`],
  ...extra
})

/** A Job with a Run of 5 Tasks: t1 and t2 completed (reports, reviews, a worktree each), t3 running, t4 and t5 pending. */
function fiveTasks(): OrchState {
  return {
    ...emptyState(),
    jobs: [{ id: 'job1', cwd: 'P', objective: 'o', leftOut: [{ item: 4, reason: 'later' }] }],
    runs: [{ id: 'run1', jobId: 'job1', ordinal: 1, git: { base: 'aaaaaaa', head: 'bbbbbbb' } }],
    tasks: [
      task('t1', 'completed', { result: 'did t1', filesModified: ['reported1.ts'], reviewIssues: [{ id: 'i1', severity: 'low', blocking: false, title: 'nit', description: '' }] }),
      task('t2', 'completed', { result: 'x'.repeat(10_000), gaps: 'no flock' }),
      task('t3', 'running'),
      task('t4', 'pending', { deps: ['t3'] }),
      task('t5', 'pending')
    ],
    dispatches: [
      { id: 'd1', taskId: 't1', cwd: 'T1', startedAt: '1', endedAt: '2', accountId: 'a', git: { base: 'ccccccc', head: 'ddddddd' } },
      { id: 'r1', taskId: 't1', cwd: 'T1', startedAt: '3', endedAt: '4', accountId: 'a', review: true, verdict: 'passed' },
      { id: 'd2', taskId: 't2', cwd: 'T2', startedAt: '1', endedAt: '2', accountId: 'a', git: { base: 'eeeeeee', head: 'fffffff' } },
      { id: 'r2', taskId: 't2', cwd: 'T2', startedAt: '3', endedAt: '4', accountId: 'a', review: true, verdict: 'rejected' },
      { id: 'd3', taskId: 't3', cwd: 'T3', startedAt: '5', accountId: 'b', workerState: 'busy' }
    ]
  } as unknown as OrchState
}

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

describe('plan-state', () => {
  const answers = { 'T1 ccccccc..ddddddd': [file('f1', 'src/t1.ts')], 'T2 eeeeeee..fffffff': [file('f2', 'src/t2.ts'), file('f3', 'src/t2b.ts')] }

  it('answers the Job, the Run and every Task with report, review and changed files in one call', async () => {
    const { deps } = makeDeps(fiveTasks(), answers)
    const r = await call(deps, { job: 'job1' })
    expect(r.status).toBe(200)
    const b = r.body as Row
    expect(b.job.id).toBe('job1')
    expect(b.run.id).toBe('run1')
    expect(b.tasks.map((t: Row) => t.id)).toEqual(['t1', 't2', 't3', 't4', 't5'])
    const [t1, t2, t3, t4] = b.tasks as Row[]
    expect(t1).toMatchObject({ status: 'completed', deps: [], affectedPaths: ['src/t1.ts'], acceptanceCriteria: ['t1 works'] })
    expect(t1.report).toMatchObject({ text: 'did t1', truncated: false })
    expect(t1.review).toMatchObject({ verdict: 'passed', rounds: 1 })
    expect(t1.review.issues).toEqual([{ severity: 'low', blocking: false, title: 'nit' }])
    expect(t1.changedFiles).toMatchObject({ source: 'git', files: ['src/t1.ts'] })
    expect(t2.review.verdict).toBe('rejected')
    expect(t2.report.gaps).toBe('no flock')
    expect(t2.changedFiles.files).toEqual(['src/t2.ts', 'src/t2b.ts'])
    expect(t3.running).toMatchObject({ dispatchId: 'd3', accountId: 'b' })
    expect(t4).toMatchObject({ status: 'pending', deps: ['t3'] })
    expect(t4.changedFiles).toBeUndefined()
    expect(b.running).toEqual(['t3'])
    expect(b.leftOut).toEqual([{ item: 4, reason: 'later' }])
  })

  it('cuts a report at 4 KB and says so', async () => {
    const { deps } = makeDeps(fiveTasks(), answers)
    const t2 = ((await call(deps, { job: 'job1' })).body as Row).tasks[1]
    expect(t2.report.text).toHaveLength(4096)
    expect(t2.report.truncated).toBe(true)
  })

  it('reads changed files from the cache: unchanged tips run no git the second time', async () => {
    const { deps, asked } = makeDeps(fiveTasks(), answers)
    await call(deps, { job: 'job1' })
    expect(asked.sort()).toEqual(['T1 ccccccc..ddddddd', 'T2 eeeeeee..fffffff'])
    await call(deps, { job: 'job1' })
    expect(asked).toHaveLength(2)
  })

  it('falls back to what the worker reported when git cannot say', async () => {
    const { deps } = makeDeps(fiveTasks(), {})
    const t1 = ((await call(deps, { job: 'job1' })).body as Row).tasks[0]
    expect(t1.changedFiles).toEqual({ source: 'reported', files: ['reported1.ts'], total: 1 })
  })

  it('a Job with no Run answers its definition Tasks', async () => {
    const state = {
      ...emptyState(),
      jobs: [{ id: 'job1', cwd: 'P', objective: 'o' }],
      tasks: [{ ...task('d1', 'pending'), runId: undefined, jobId: 'job1' }, { ...task('d2', 'pending'), runId: undefined, jobId: 'job1' }]
    } as unknown as OrchState
    const { deps } = makeDeps(state)
    const b = (await call(deps, { job: 'job1' })).body as Row
    expect(b.run).toBeNull()
    expect(b.tasks.map((t: Row) => t.id)).toEqual(['d1', 'd2'])
  })

  it('a Run id names its Job, an unknown id is 404 and none is 400', async () => {
    const { deps } = makeDeps(fiveTasks(), answers)
    expect(((await call(deps, { job: 'run1' })).body as Row).job.id).toBe('job1')
    expect((await call(deps, { job: 'nope' })).status).toBe(404)
    expect((await call(deps, {})).status).toBe(400)
  })
})
