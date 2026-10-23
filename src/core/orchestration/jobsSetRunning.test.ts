// Change a running plan: `jobs-set` takes concurrency, priority, review rounds, replan, auto-approve, hands-off and
// delivery in any mix, checked before one write.
import { describe, it, expect } from 'vitest'
import { handleCommand, type OrchServerDeps } from './command'
import { emptyState, type OrchState } from './state'
import { MAX_CONCURRENT_WORKERS, type Job, type JobRun, type Task } from './types'
import { HOST_CALLER } from '../host/driver'

const NOW = '2026-10-23T00:00:00.000Z'
const job: Job = { id: 'job_a', objective: 'o', cwd: '/repo', createdAt: NOW, concurrency: 2 }
const run: JobRun = { id: 'r1', jobId: 'job_a', ordinal: 1, createdAt: NOW }
const task = (status: Task['status']): Task =>
  ({ id: 't1', runId: 'r1', jobId: 'job_a', title: 'T', spec: 's', deps: [], status, consecutiveFailures: 0, createdAt: NOW, updatedAt: NOW }) as Task

const rig = (over: { job?: Partial<Job>; run?: Partial<JobRun>; status?: Task['status'] } = {}) => {
  const box = { state: { ...emptyState(), jobs: [{ ...job, ...over.job }], runs: [{ ...run, ...over.run }], tasks: [task(over.status ?? 'ready')] } as OrchState }
  let writes = 0
  const deps = {
    getState: () => box.state,
    setState: async (next: OrchState) => {
      writes++
      box.state = next
    },
    now: () => NOW,
    listAccounts: async () => []
  } as unknown as OrchServerDeps
  const call = (args: Record<string, unknown>, sessionId = HOST_CALLER) => handleCommand(deps, { sessionId }, 'jobs-set', { id: 'job_a', ...args })
  return { call, job: () => box.state.jobs[0], writes: () => writes }
}

describe('jobs-set on a running plan', () => {
  it('changes each field', async () => {
    const h = rig()
    expect((await h.call({ reviewRounds: 3 })).status).toBe(200)
    expect(h.job().convergence?.maxReviewRounds).toBe(3)
    await h.call({ replan: 'off' })
    expect(h.job().replan).toBe('off')
    await h.call({ autoApprove: 'on' })
    expect(h.job().autoApprove).toBe(true)
    await h.call({ handsOff: 'on' })
    expect(h.job().handsOff).toBe(true)
    await h.call({ delivery: 'push' })
    expect(h.job().delivery).toBe('push')
    await h.call({ concurrency: 4, priority: 7 })
    expect(h.job()).toMatchObject({ concurrency: 4, priority: 7 })
  })

  it('writes a combination once and says when it takes effect', async () => {
    const h = rig()
    const r = await h.call({ concurrency: 5, reviewRounds: 2, replan: 'off', autoApprove: 'off', handsOff: 'off', delivery: 'push', priority: 1 })
    expect(r.status).toBe(200)
    expect(JSON.stringify(r.body)).toContain('has not started')
    expect(h.writes()).toBe(1)
    expect(h.job()).toMatchObject({ concurrency: 5, replan: 'off', autoApprove: false, handsOff: false, delivery: 'push', priority: 1 })
  })

  it('an invalid flag changes nothing', async () => {
    const h = rig()
    expect((await h.call({ concurrency: 5, reviewRounds: 0 })).status).toBe(400)
    expect((await h.call({ concurrency: 5, replan: 'x' })).status).toBe(400)
    expect((await h.call({ concurrency: 5, delivery: 'ftp' })).status).toBe(400)
    expect(h.writes()).toBe(0)
    expect(h.job().concurrency).toBe(2)
  })

  it('refuses delivery once it started, but still sets the rest', async () => {
    const h = rig({ run: { deliveryState: { state: 'delivering', attempts: 1 } } })
    expect((await h.call({ delivery: 'push', concurrency: 5 })).status).toBe(409)
    expect(h.writes()).toBe(0)
    expect((await h.call({ concurrency: 5, replan: 'off' })).status).toBe(200)
  })

  it('refuses a finished plan', async () => {
    const h = rig({ status: 'completed' })
    expect((await h.call({ reviewRounds: 2 })).status).toBe(409)
    expect(h.writes()).toBe(0)
    expect((await rig({ job: { archivedAt: NOW } }).call({ replan: 'off' })).status).toBe(409)
  })

  it('refuses hands-off from an agent session', async () => {
    const h = rig()
    expect((await h.call({ handsOff: 'on' }, 'sess-agent')).status).toBe(403)
    expect(h.writes()).toBe(0)
  })

  it('clamps concurrency to MAX_CONCURRENT_WORKERS', async () => {
    const h = rig()
    await h.call({ concurrency: 9999, priority: 1 })
    expect(h.job().concurrency).toBe(MAX_CONCURRENT_WORKERS)
  })
})
