import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHostOrch, READS_OUTSIDE_CHAIN } from './orch'
import { createJob, createTask, emptyState, startJobRun, type OrchState } from '../core/orchestration/state'
import { OrchestrationStore } from '../core/orchestration/store'
import { ensureProject } from '../core/orchestration/projects'

// T5: `plan-state` answers a 400-Task plan beside the command chain, while a write holds it.
const NOW = '2026-11-01T10:00:00.000Z'
let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-hostorch-planstate-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})
const tick = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

class SlowStore extends OrchestrationStore {
  holdMs = 0
  private released: () => void = () => {}
  private began: () => void = () => {}
  saving: Promise<void> = new Promise((r) => (this.began = r))
  release(): void {
    this.released()
  }
  override async save(...args: Parameters<OrchestrationStore['save']>): Promise<void> {
    const wrote = super.save(...args)
    if (this.holdMs > 0) {
      this.began()
      await Promise.race([new Promise<void>((r) => (this.released = r)), tick(this.holdMs)])
    }
    return wrote
  }
}

describe('plan-state outside the command chain', () => {
  it('is on the read list and answers 400 Tasks in under 500 ms while a write holds the chain', async () => {
    expect(READS_OUTSIDE_CHAIN.has('plan-state')).toBe(true)
    let state: OrchState = ensureProject(emptyState(), { path: 'D:/p', now: NOW }).state
    const job = createJob(state, { objective: 'big', cwd: 'D:/p', concurrency: 4 }, NOW)
    if (!job.ok) throw new Error(job.error)
    const run = startJobRun(job.state, job.value.id, NOW)
    if (!run.ok) throw new Error(run.error)
    state = run.state
    for (let i = 0; i < 400; i++) {
      const t = createTask(state, { runId: run.value.id, title: `t${i}`, spec: 's', deps: [] }, NOW)
      if (!t.ok) throw new Error(t.error)
      state = t.state
    }
    await fs.writeFile(path.join(dir, 'orchestration.json'), JSON.stringify(state), 'utf8')
    const store = new SlowStore(path.join(dir, 'orchestration.json'))
    const orch = createHostOrch({
      profileDir: dir,
      version: '9.9.9',
      now: () => NOW,
      hostStartedAt: () => NOW,
      runningSessions: () => 0,
      aliveSessionIds: () => new Set<string>(),
      act: async (name: string) => (name === 'listAccounts' ? [{ id: 'acc1', name: 'a', provider: 'claude' }] : name === 'listRunConfigs' ? [] : {}),
      hasApp: () => true,
      onState: () => {},
      log: () => {},
      store,
      sessions: { listSessions: async () => [], readSession: async () => ({ cols: 80, rows: 24, screen: [], scrollback: [] }), sendSession: async () => {}, readChat: async () => [], sendChat: async () => {}, serial: (_id: string, run: () => unknown) => run() },
      readSummaries: async () => []
    } as unknown as Parameters<typeof createHostOrch>[0])
    await orch.ready()

    store.holdMs = 10_000
    const held = orch.call({ cmd: 'jobs-rename', args: { id: job.value.id, title: 'held' }, sessionId: '' })
    await store.saving
    let queuedAnswered = false
    const queued = orch.call({ cmd: 'jobs-rename', args: { id: job.value.id, title: 'second' }, sessionId: '' }).then((r) => ((queuedAnswered = true), r))

    const t0 = Date.now()
    const r = await orch.call({ cmd: 'plan-state', args: { job: job.value.id }, sessionId: '' })
    expect(Date.now() - t0).toBeLessThan(500)
    expect(r.status).toBe(200)
    expect((r.body as { tasks: unknown[] }).tasks).toHaveLength(400)
    expect(queuedAnswered).toBe(false)

    store.holdMs = 0
    store.release()
    await Promise.all([held, queued])
    await tick(300) // the last save settles before the folder goes
  }, 20_000)
})
