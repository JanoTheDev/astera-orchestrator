// W3-A: the activity feed's lines, summaries and notices (activity.ts).
import { describe, expect, it } from 'vitest'
import {
  waitingActivity,
  createActivityNotices,
  createNoticeThrottle,
  deriveActivity,
  digestText,
  noticeOf,
  summarize,
  type ActivityDraft,
  type ActivityEvent,
  type ActivityNotice,
  type ActivitySummary
} from './activity'
import { emptyState, type OrchState } from './state'
import { FAILURE_LIMIT, type Dispatch, type Gate, type Job, type JobRun, type Task } from './types'

const T0 = '2026-10-17T00:00:00.000Z'

const job = (over: Partial<Job> = {}): Job => ({ id: 'j1', objective: 'Ship it', title: 'Plan A', projectId: 'p1', cwd: '/p', createdAt: T0, autoDispatch: true, concurrency: 3, ...over })
const run = (over: Partial<JobRun> = {}): JobRun => ({ id: 'r1', jobId: 'j1', ordinal: 1, createdAt: T0, ...over })
const task = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  runId: 'r1',
  title: `title ${id}`,
  spec: 's',
  deps: [],
  status: 'ready',
  accountIds: ['acc_1'],
  consecutiveFailures: 0,
  createdAt: T0,
  updatedAt: T0,
  ...over
})
const dispatch = (id: string, taskId: string, over: Partial<Dispatch> = {}): Dispatch => ({
  id,
  taskId,
  provider: 'claude',
  accountId: 'acc_1',
  sessionId: `ses_${id}`,
  cwd: '/p',
  specPath: '/spec',
  startedAt: T0,
  workerState: 'ready',
  retained: false,
  model: 'sonnet',
  ...over
})
const gate = (over: Partial<Gate> = {}): Gate => ({ id: 'g1', runId: 'r1', taskId: 'a', question: 'Which way?', status: 'open', createdAt: T0, ...over })
const state = (over: Partial<OrchState> = {}): OrchState => ({ ...emptyState(), jobs: [job()], runs: [run()], tasks: [task('a')], ...over })

const types = (ds: ActivityDraft[]): string[] => ds.map((d) => d.type)
let seq = 0
const stamp = (d: ActivityDraft, occurredAt: string): ActivityEvent => ({ ...d, id: `ev_000000000000_${++seq}`, sequence: seq, occurredAt })

describe('deriveActivity', () => {
  it('says nothing for the same state, or for Tasks just created', () => {
    const s = state()
    expect(deriveActivity(s, s)).toEqual([])
    expect(deriveActivity(state({ tasks: [] }), s)).toEqual([])
  })

  it('a status change carries the project, plan, Task, session, model and account', () => {
    const d = dispatch('d1', 'a')
    const prev = state({ dispatches: [d] })
    const next = state({ tasks: [task('a', { status: 'completed' })], dispatches: [{ ...d, endedAt: T0, outcome: 'succeeded' }] })
    const [line] = deriveActivity(prev, next).filter((x) => x.type === 'task.status')
    expect(line).toEqual({
      type: 'task.status',
      projectId: 'p1',
      jobId: 'j1',
      runId: 'r1',
      taskId: 'a',
      sessionId: 'ses_d1',
      payload: { plan: 'Plan A', title: 'title a', status: 'completed', from: 'ready', category: 'done', model: 'sonnet', accountId: 'acc_1' }
    })
  })

  it('a worker a person stopped reads as cancelled, though the status did not move', () => {
    const d = dispatch('d1', 'a')
    const prev = state({ tasks: [task('a', { status: 'dispatched' })], dispatches: [d] })
    const next = state({ tasks: [task('a', { status: 'dispatched' })], dispatches: [{ ...d, endedAt: T0, workerState: 'stopped', closedBy: 'stop' }] })
    const out = deriveActivity(prev, next)
    expect(out.find((x) => x.type === 'task.status')?.payload.category).toBe('cancelled')
    expect(out.find((x) => x.type === 'dispatch.exited')?.payload).toMatchObject({ closedBy: 'stop', workerState: 'stopped' })
  })

  it('a worker starts when its real session is there, not its pending placeholder', () => {
    const pending = dispatch('d1', 'a', { sessionId: 'pending:x' })
    const t = task('a', { status: 'dispatched' })
    const s1 = state({ tasks: [t], dispatches: [] })
    const s2 = state({ tasks: [t], dispatches: [pending] })
    const s3 = state({ tasks: [t], dispatches: [{ ...pending, sessionId: 'ses_real' }] })
    expect(types(deriveActivity(s1, s2))).not.toContain('dispatch.started')
    const started = deriveActivity(s2, s3).find((x) => x.type === 'dispatch.started')
    expect(started).toMatchObject({ sessionId: 'ses_real', payload: { model: 'sonnet', accountId: 'acc_1' } })
  })

  it('a roll at a limit and its resume, each once', () => {
    const t = task('a', { status: 'dispatched' })
    const d = dispatch('d1', 'a')
    const waiting = { ...d, resumes: [{ stoppedAt: T0, reason: 'switching' as const, fromAccountId: 'acc_1' }] }
    const resumed = { ...d, accountId: 'acc_2', resumes: [{ ...waiting.resumes[0], resumedAt: T0, toAccountId: 'acc_2' }] }
    expect(types(deriveActivity(state({ tasks: [t], dispatches: [d] }), state({ tasks: [t], dispatches: [waiting] })))).toEqual(['dispatch.rolled'])
    const back = deriveActivity(state({ tasks: [t], dispatches: [waiting] }), state({ tasks: [t], dispatches: [resumed] }))
    expect(back.map((x) => [x.type, x.payload.toAccountId])).toEqual([['dispatch.resumed', 'acc_2']])
  })

  it('a question opened and answered', () => {
    const opened = deriveActivity(state(), state({ gates: [gate()] }))
    expect(opened).toMatchObject([{ type: 'gate.opened', taskId: 'a', payload: { gateId: 'g1', question: 'Which way?', title: 'title a' } }])
    const answered = deriveActivity(state({ gates: [gate()] }), state({ gates: [gate({ status: 'resolved', resolution: 'left' })] }))
    expect(answered).toMatchObject([{ type: 'gate.resolved', payload: { resolution: 'left' } }])
  })

  it('a Task’s links and the plan’s PR', () => {
    const linked = deriveActivity(state(), state({ tasks: [task('a', { links: { issue: { number: 7, url: 'u' } } })] }))
    expect(linked).toMatchObject([{ type: 'task.links', payload: { links: { issue: { number: 7 } } } }])
    const pr = deriveActivity(state(), state({ runs: [run({ pr: { at: T0, number: 9, url: 'u' } })] }))
    expect(pr).toMatchObject([{ type: 'run.pr', runId: 'r1', payload: { title: 'Plan A', pr: { number: 9 } } }])
  })

  it('#48: a planner starting is no "plan ready" line: that comes at its turn end (host/activity.ts)', () => {
    const awaiting = job({ pendingStart: true, plannerSessionIds: ['ses_p'] })
    expect(deriveActivity(state(), state({ jobs: [awaiting] }))).toEqual([])
    expect(deriveActivity(state({ jobs: [awaiting] }), state({ jobs: [{ ...awaiting, title: 'Renamed' }] }))).toEqual([])
    expect(deriveActivity(state(), state({ jobs: [job({ pendingStart: true })] }))).toEqual([])
  })

  it('#42: waitingActivity names the open Dispatch\'s Task, plan, model and account, and why it waits', () => {
    const s = state({ tasks: [task('a', { status: 'dispatched' })], dispatches: [dispatch('d1', 'a')] })
    expect(waitingActivity(s, 'ses_d1', 'permission')).toEqual({
      type: 'task.waiting',
      projectId: 'p1',
      jobId: 'j1',
      runId: 'r1',
      taskId: 'a',
      sessionId: 'ses_d1',
      payload: { title: 'title a', plan: 'Plan A', model: 'sonnet', accountId: 'acc_1', waitingFor: 'permission' }
    })
    // An ended Dispatch, or a session that is no Dispatch's (a planner, a plain terminal): no line
    expect(waitingActivity({ ...s, dispatches: [dispatch('d1', 'a', { endedAt: T0 })] }, 'ses_d1', 'question')).toBeNull()
    expect(waitingActivity(s, 'ses_other', 'question')).toBeNull()
  })

  it('a plan done follows the Task line that ended it; a failure with retries left ends nothing', () => {
    expect(types(deriveActivity(state(), state({ tasks: [task('a', { status: 'failed', consecutiveFailures: 1 })] })))).toEqual(['task.status'])
    const out = deriveActivity(state(), state({ tasks: [task('a', { status: 'failed', consecutiveFailures: FAILURE_LIMIT })] }))
    expect(types(out)).toEqual(['task.status', 'plan.done'])
    expect(out[1].payload.runOutcome).toBe('failed')
    const done = deriveActivity(state(), state({ tasks: [task('a', { status: 'completed' })] }))
    expect(done.at(-1)).toMatchObject({ type: 'plan.done', payload: { runOutcome: 'completed', title: 'Plan A' } })
  })
})

describe('summarize', () => {
  const at = (iso: string, d: ActivityDraft): ActivityEvent => stamp(d, iso)
  const status = (taskId: string, category: string, status: Task['status']): ActivityDraft => ({
    type: 'task.status',
    jobId: 'j1',
    runId: 'r1',
    taskId,
    payload: { title: `title ${taskId}`, category: category as never, status, model: 'opus', accountId: 'acc_1' }
  })

  it('reads only the window, each Task once, in the bucket its latest line put it', () => {
    const events = [
      at('2026-10-17T00:00:00.000Z', status('old', 'done', 'completed')),
      at('2026-10-17T00:20:00.000Z', status('a', 'awaiting-review', 'reviewing')),
      at('2026-10-17T00:25:00.000Z', status('a', 'done', 'completed')),
      at('2026-10-17T00:26:00.000Z', status('b', 'failed', 'failed')),
      at('2026-10-17T00:27:00.000Z', status('c', 'cancelled', 'dispatched')),
      at('2026-10-17T00:28:00.000Z', status('d', 'awaiting-review', 'reviewing'))
    ]
    const s = summarize(events, '2026-10-17T00:15:00.000Z')
    expect(s.completed.map((x) => x.taskId)).toEqual(['a'])
    expect(s.completed[0]).toMatchObject({ model: 'opus', accountId: 'acc_1', at: '2026-10-17T00:25:00.000Z' })
    expect(s.failed.map((x) => x.taskId)).toEqual(['b'])
    expect(s.cancelled.map((x) => x.taskId)).toEqual(['c'])
    expect(s.awaitingReview.map((x) => x.taskId)).toEqual(['d'])
  })

  it('with a state: the plans still awaiting approval, and what is blocked now with why', () => {
    const approval = at(T0, { type: 'plan.awaiting-approval', jobId: 'j1', payload: { title: 'Plan A' } })
    const s = state({ jobs: [job({ pendingStart: true, plannerSessionIds: [] })], tasks: [task('a', { status: 'pending', deps: ['b'] }), task('b')] })
    const out = summarize([approval], T0, s)
    expect(out.awaitingReview.map((x) => x.jobId)).toEqual(['j1'])
    expect(out.blocked.map((x) => [x.taskId, x.reason.kind])).toEqual([
      ['a', 'pending-start'],
      ['b', 'pending-start']
    ])
    // Approved since: no longer awaiting
    expect(summarize([approval], T0, state()).awaitingReview).toEqual([])
    const deps = summarize([], T0, state({ tasks: [task('a', { status: 'pending', deps: ['b'] }), task('b')] }))
    expect(deps.blocked.map((x) => [x.taskId, x.reason.kind])).toEqual([['a', 'deps']])
  })
})

describe('notices', () => {
  const ev = (d: ActivityDraft): ActivityEvent => stamp(d, T0)

  it('only a failure, a plan’s end, a question and an approval interrupt', () => {
    expect(noticeOf(ev({ type: 'task.status', taskId: 'a', payload: { title: 'A', status: 'failed', from: 'dispatched', category: 'failed' } }))?.title).toBe('Task failed')
    expect(noticeOf(ev({ type: 'task.status', taskId: 'a', payload: { title: 'A', status: 'completed', category: 'done' } }))).toBeNull()
    expect(noticeOf(ev({ type: 'plan.done', runId: 'r1', payload: { title: 'P', runOutcome: 'completed' } }))?.title).toBe('Plan done')
    expect(noticeOf(ev({ type: 'gate.opened', payload: { title: 'A', gateId: 'g', question: 'Q?' } }))?.body).toContain('Q?')
    expect(noticeOf(ev({ type: 'plan.awaiting-approval', jobId: 'j1', payload: { title: 'P' } }))?.key).toBe('approve:j1')
    expect(noticeOf(ev({ type: 'dispatch.started', payload: { title: 'A' } }))).toBeNull()
  })

  it('the throttle: a key once a window, at most max a minute, the rest counted', () => {
    const th = createNoticeThrottle({ dedupMs: 1000, windowMs: 100, max: 2 })
    expect(th.admit('a', 0)).toBe(true)
    expect(th.admit('a', 10)).toBe(false) // dedup, not counted
    expect(th.admit('b', 20)).toBe(true)
    expect(th.admit('c', 30)).toBe(false) // rate
    expect(th.takeSuppressed()).toBe(1)
    expect(th.takeSuppressed()).toBe(0)
    expect(th.admit('d', 200)).toBe(true) // window passed
    expect(th.admit('a', 1500)).toBe(true) // dedup expired
  })

  const summary = (over: Partial<ActivitySummary> = {}): ActivitySummary => ({
    since: T0, completed: [], failed: [], cancelled: [], awaitingReview: [], plansDone: [], blocked: [], ...over
  })

  it('a digest only when something happened; blocked alone is no news', () => {
    expect(digestText(summary())).toBeNull()
    expect(digestText(summary({ blocked: [{ title: 'x', at: T0, reason: { kind: 'paused' } }] }))).toBeNull()
    const text = digestText(summary({ completed: [1, 2, 3, 4].map((i) => ({ title: `t${i}`, at: T0 })) }), 2)!
    expect(text).toContain('4 completed: t1, t2, t3 and 1 more')
    expect(text).toContain('2 more notice(s) held back')
  })

  it('a burst is held back and told in the next digest, which comes once its interval passed', async () => {
    let now = 0
    const sent: ActivityNotice[] = []
    const sinces: string[] = []
    const n = createActivityNotices({
      send: (x) => sent.push(x),
      summary: async (since) => (sinces.push(since), summary({ failed: [{ title: 'f', at: T0 }] })),
      digestMs: () => 60_000,
      nowMs: () => now
    })
    const failed = (i: number): ActivityEvent => ev({ type: 'task.status', taskId: `t${i}`, payload: { title: `t${i}`, status: 'failed', category: 'failed' } })
    n.onEvents([1, 2, 3, 4, 5].map(failed))
    expect(sent.map((x) => x.body)).toEqual(['t1', 't2', 't3'])
    now = 30_000
    await n.tick()
    expect(sent).toHaveLength(3)
    now = 60_000
    await n.tick()
    expect(sinces).toEqual([new Date(0).toISOString()])
    expect(sent.at(-1)).toMatchObject({ title: 'Activity summary' })
    expect(sent.at(-1)!.body).toContain('2 more notice(s) held back')
  })

  it('with no digest, what was held back is still told once', async () => {
    const sent: ActivityNotice[] = []
    const n = createActivityNotices({ send: (x) => sent.push(x), summary: async () => null, digestMs: () => 0, nowMs: () => 0 })
    n.onEvents([1, 2, 3, 4].map((i) => ev({ type: 'gate.opened', payload: { title: 'x', gateId: `g${i}`, question: 'q' } })))
    await n.tick()
    await n.tick()
    expect(sent.map((x) => x.title)).toEqual(['Needs your answer', 'Needs your answer', 'Needs your answer', 'More orchestration updates'])
  })
})

// W6-A: a plan that ended before approval because everything it asks for is built
describe('plan.nothing-to-do', () => {
  const job = { id: 'job_1', objective: 'add login', cwd: '/p', createdAt: '2026-10-18T00:00:00.000Z', projectId: 'p1', pendingStart: true } as Job
  it('is derived once, when the Job gains nothingToDo, and is a notice', () => {
    const prev: OrchState = { ...emptyState(), jobs: [job] }
    const next: OrchState = { ...prev, jobs: [{ ...job, nothingToDo: { at: 'now', summary: 'login | built | src/login.tsx:1' } }] }
    const drafts = deriveActivity(prev, next)
    expect(drafts).toEqual([
      { type: 'plan.nothing-to-do', projectId: 'p1', jobId: 'job_1', payload: { plan: 'add login', title: 'add login', summary: 'login | built | src/login.tsx:1' } }
    ])
    expect(deriveActivity(next, { ...next, jobs: [...next.jobs] })).toEqual([])
    const e = { ...drafts[0], id: 'e1', sequence: 1, occurredAt: 'now' } as ActivityEvent
    expect(noticeOf(e)).toEqual({ key: 'nothing:job_1', title: 'Nothing to do: already built', body: 'add login' })
  })
})
