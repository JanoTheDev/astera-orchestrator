// W3-A: the activity feed's log on disk (a second createHostEventLog), its two Host reads, and the Host's notices.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHostEventLog, type HostEventLog } from './eventLog'
import { activityReply, followActivity } from './activity'
import { ACTIVITY_KINDS, deriveActivity, type ActivityNotice, type ActivitySummary } from '../core/orchestration/activity'
import { emptyState, type OrchState } from '../core/orchestration/state'
import type { Job, JobRun, Task } from '../core/orchestration/types'

const T0 = '2026-10-17T00:00:00.000Z'
const BOOT_A = '0123456789abcdef0123456789abcdef'
const BOOT_B = 'ba9876543210fedcba9876543210fedc'

let root: string
let dir: string
const opened: HostEventLog[] = []
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'astera-activity-'))
  dir = path.join(root, 'orch')
})
afterEach(() => {
  for (const log of opened.splice(0)) log.close()
  rmSync(root, { recursive: true, force: true })
})

const open = (bootId: string, now = T0): HostEventLog => {
  const log = createHostEventLog({ dir, bootId, now: () => now, log: () => {}, name: 'activity', types: ACTIVITY_KINDS, derive: deriveActivity, retryMs: [60_000] })
  opened.push(log)
  return log
}

const job: Job = { id: 'j1', objective: 'o', title: 'Plan A', cwd: '/p', createdAt: T0, autoDispatch: true, concurrency: 1 }
const run: JobRun = { id: 'r1', jobId: 'j1', ordinal: 1, createdAt: T0 }
const task = (status: Task['status'], over: Partial<Task> = {}): Task => ({
  id: 'a', runId: 'r1', title: 'Task A', spec: 's', deps: [], status, accountIds: ['acc'], consecutiveFailures: 0, createdAt: T0, updatedAt: T0, ...over
})
const at = (t: Task): OrchState => ({ ...emptyState(), jobs: [job], runs: [run], tasks: [t] })

describe('the activity log', () => {
  it('is its own file beside the public one, and a new Host reads it back', async () => {
    const a = open(BOOT_A)
    await a.load()
    a.committed(at(task('ready')), at(task('failed', { consecutiveFailures: 3 })))
    await a.flushed()
    expect(existsSync(path.join(dir, 'activity.jsonl'))).toBe(true)
    expect(existsSync(path.join(dir, 'events.jsonl'))).toBe(false)
    const types = readFileSync(path.join(dir, 'activity.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).type)
    expect(types).toEqual(['task.status', 'plan.done'])

    // A line of another log's type is not this log's, and is skipped at the load
    appendFileSync(path.join(dir, 'activity.jsonl'), JSON.stringify({ id: 'ev_0123456789ab_9', type: 'task.completed', sequence: 9, occurredAt: T0, payload: {} }) + '\n')
    const b = open(BOOT_B)
    await b.load()
    const r = b.read({ limit: 100 })
    if ('error' in r) throw new Error(r.error)
    expect(r.events.map((e) => e.type)).toEqual(['task.status', 'plan.done'])
    // Numbered on after the old Host's
    b.committed(at(task('failed', { consecutiveFailures: 3 })), at(task('ready')))
    expect(b.read({ after: r.cursor, limit: 10 })).toMatchObject({ events: [{ sequence: 3 }], gap: false })
  })
})

describe('activityReply', () => {
  it('answers 501 with no log', async () => {
    expect((await activityReply(null, 'activity-poll', {}, () => emptyState(), async () => ({}))).status).toBe(501)
  })

  it('activity-poll is events-poll over its own types', async () => {
    const log = open(BOOT_A)
    await log.load()
    log.committed(at(task('ready')), at(task('completed')))
    const all = await activityReply(log, 'activity-poll', {}, () => emptyState(), async () => ({}))
    expect((all.body as { events: unknown[] }).events).toHaveLength(2)
    const some = await activityReply(log, 'activity-poll', { types: 'plan.done' }, () => emptyState(), async () => ({}))
    expect((some.body as { events: Array<{ type: string }> }).events.map((e) => e.type)).toEqual(['plan.done'])
    expect((await activityReply(log, 'activity-poll', { types: 'task.completed' }, () => emptyState(), async () => ({}))).status).toBe(400)
  })

  it('activity-summary reads the last 15 minutes by default, and refuses a since that is not a time', async () => {
    const log = open(BOOT_A, '2026-10-17T00:10:00.000Z')
    await log.load()
    log.committed(at(task('ready')), at(task('completed')))
    const nowMs = () => Date.parse('2026-10-17T00:20:00.000Z')
    const r = await activityReply(log, 'activity-summary', {}, () => at(task('completed')), async () => ({}), nowMs)
    expect((r.body as ActivitySummary).completed.map((x) => x.title)).toEqual(['Task A'])
    expect((r.body as ActivitySummary).plansDone).toHaveLength(1)
    const later = await activityReply(log, 'activity-summary', {}, () => at(task('completed')), async () => ({}), () => Date.parse('2026-10-17T01:00:00.000Z'))
    expect((later.body as ActivitySummary).completed).toEqual([])
    expect((await activityReply(log, 'activity-summary', { since: 'yesterday' }, () => emptyState(), async () => ({}))).status).toBe(400)
  })
})

describe('followActivity', () => {
  it('sends what comes after it starts, not what the log already held', async () => {
    const log = open(BOOT_A)
    await log.load()
    log.committed(at(task('ready')), at(task('failed')))
    const sent: ActivityNotice[] = []
    const stop = followActivity({ log, send: (n) => sent.push(n), state: () => emptyState(), limits: async () => ({}), digestMs: async () => 0, report: () => {}, tickMs: 20 })
    log.committed(at(task('ready', { id: 'b', title: 'Task B' })), at(task('failed', { id: 'b', title: 'Task B' })))
    await new Promise((r) => setTimeout(r, 50))
    stop()
    expect(sent.map((n) => [n.title, n.body])).toEqual([['Task failed', 'Task B (Plan A)']])
  })
})
