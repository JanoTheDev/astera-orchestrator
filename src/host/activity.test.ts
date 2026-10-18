// W3-A: the activity feed's log on disk (a second createHostEventLog), its two Host reads, and the Host's notices.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHostEventLog, type HostEventLog } from './eventLog'
import { activityReply, followActivity, hostSessionActivity } from './activity'
import { ACTIVITY_KINDS, deriveActivity, type ActivityNotice, type ActivitySummary } from '../core/orchestration/activity'
import { emptyState, type OrchState } from '../core/orchestration/state'
import type { Dispatch, Job, JobRun, Task } from '../core/orchestration/types'

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

describe('hostSessionActivity (W5-D)', () => {
  const planned = (over: Partial<Task> = {}): Task => ({
    id: 'p1', jobId: 'j1', title: 'Plan task', spec: 's', deps: [], status: 'ready', accountIds: ['acc'], consecutiveFailures: 0, createdAt: T0, updatedAt: T0,
    prompt: 'do it', acceptanceCriteria: ['it is done'], /* W6-A */ basis: { state: 'missing', evidence: 'none yet' }, ...over
  })
  const lines = (log: HostEventLog): Array<{ type: string; jobId?: string; sessionId?: string; payload: Record<string, unknown> }> => {
    const r = log.read({ limit: 100 })
    if ('error' in r) throw new Error(r.error)
    return r.events as never
  }
  const stop = { hook_event_name: 'Stop' }

  it('#48: "plan ready" comes when the planner ends its turn on a plan that holds, once per planner', async () => {
    const log = open(BOOT_A)
    await log.load()
    const awaiting: Job = { ...job, pendingStart: true, plannerSessionIds: ['ses_plan'] }
    let s: OrchState = { ...emptyState(), jobs: [awaiting] }
    // The commit that marks the plan pending (the planner starting) makes no line
    log.committed(emptyState(), s)
    const acts = hostSessionActivity({ log, state: () => s, report: () => {} })
    // A turn ending with no Task yet, or with one that lacks its criterion: not ready
    acts.onHookEvent('ses_plan', stop)
    s = { ...s, tasks: [planned({ acceptanceCriteria: [] })] }
    acts.onHookEvent('ses_plan', stop)
    expect(lines(log)).toEqual([])
    // A tool call mid-turn on a plan that holds is not the turn's end
    s = { ...s, tasks: [planned()] }
    acts.onHookEvent('ses_plan', { hook_event_name: 'PostToolUse' })
    expect(lines(log)).toEqual([])
    acts.onHookEvent('ses_plan', stop)
    acts.onHookEvent('ses_plan', stop)
    // Another session's turn end is not the planner's
    acts.onHookEvent('ses_other', stop)
    expect(lines(log)).toMatchObject([{ type: 'plan.awaiting-approval', jobId: 'j1', sessionId: 'ses_plan', payload: { title: 'Plan A' } }])
    // A new planner (`jobs plan` again) is a new plan
    s = { ...s, jobs: [{ ...awaiting, plannerSessionIds: ['ses_plan', 'ses_plan2'] }] }
    acts.onHookEvent('ses_plan2', stop)
    expect(lines(log).map((e) => e.sessionId)).toEqual(['ses_plan', 'ses_plan2'])
    // Approved: no longer pending, no line
    s = { ...s, jobs: [{ ...awaiting, pendingStart: false, plannerSessionIds: ['ses_plan3'] }] }
    acts.onHookEvent('ses_plan3', stop)
    expect(lines(log)).toHaveLength(2)
  })

  it('W7-A: auto-approve starts the plan instead of the ready line; a start that fails asks for approval after all', async () => {
    const log = open(BOOT_A)
    await log.load()
    const s: OrchState = { ...emptyState(), jobs: [{ ...job, pendingStart: true, plannerSessionIds: ['ses_plan'], autoApprove: true }], tasks: [planned()] }
    const asked: string[] = []
    let answer = true
    const acts = hostSessionActivity({ log, state: () => s, report: () => {}, autoStart: async (id) => (asked.push(id), answer) })
    acts.onHookEvent('ses_plan', stop)
    await new Promise((r) => setTimeout(r, 0))
    expect(asked).toEqual(['j1'])
    expect(lines(log)).toEqual([])
    answer = false
    acts.onHookEvent('ses_plan', stop)
    await new Promise((r) => setTimeout(r, 0))
    expect(lines(log)).toMatchObject([{ type: 'plan.awaiting-approval', jobId: 'j1' }])
  })

  it('#42: a worker turning to waiting at a permission prompt or a question is a task.waiting line with the reason', async () => {
    const log = open(BOOT_A)
    await log.load()
    const d: Dispatch = {
      id: 'd1', taskId: 'a', provider: 'claude', accountId: 'acc', sessionId: 'ses_w', cwd: '/p', specPath: '/spec', startedAt: T0, workerState: 'ready', retained: false, model: 'haiku'
    }
    const s: OrchState = { ...at(task('dispatched')), dispatches: [d] }
    const acts = hostSessionActivity({ log, state: () => s, report: () => {} })
    acts.onSessionEvents([
      { type: 'session.input_needed', sessionId: 'ses_w', payload: { session: { id: 'ses_w' }, prompt: 'permission' } },
      // A turn that just ended is no line; nor another session event, nor a session that is no worker's
      { type: 'session.input_needed', sessionId: 'ses_w', payload: { prompt: null } },
      { type: 'session.limit_waiting', sessionId: 'ses_w', payload: {} },
      { type: 'session.input_needed', sessionId: 'ses_x', payload: { prompt: 'question' } },
      { type: 'session.input_needed', sessionId: 'ses_w', payload: { prompt: 'question' } }
    ])
    expect(lines(log)).toMatchObject([
      { type: 'task.waiting', sessionId: 'ses_w', payload: { title: 'Task A', plan: 'Plan A', model: 'haiku', accountId: 'acc', waitingFor: 'permission' } },
      { type: 'task.waiting', payload: { waitingFor: 'question' } }
    ])
  })

  it('a state that cannot be read yet (the Host still starting) is reported, never thrown', async () => {
    const log = open(BOOT_A)
    await log.load()
    const reports: string[] = []
    const acts = hostSessionActivity({ log, state: () => { throw new Error('not yet') }, report: (m) => reports.push(m) })
    acts.onHookEvent('ses_plan', stop)
    acts.onSessionEvents([{ type: 'session.input_needed', sessionId: 'ses_w', payload: { prompt: 'permission' } }])
    expect(reports).toHaveLength(2)
  })
})
