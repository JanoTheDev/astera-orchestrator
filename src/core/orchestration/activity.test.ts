// W3-A: the activity feed's lines, summaries and notices (activity.ts).
import { describe, expect, it } from 'vitest'
import {
  decisionLine,
  waitingActivity,
  createActivityNotices,
  createNoticeThrottle,
  deriveActivity,
  digestText,
  noticeOf,
  usageActivity,
  summarize,
  type ActivityDraft,
  type ActivityEvent,
  type ActivityNotice,
  type ActivitySummary
} from './activity'
import { answerEscalation, applyReply, emptyState, type OrchState } from './state'
import { FAILURE_LIMIT, type Dispatch, type Gate, type Job, type JobRun, type Message, type Task } from './types'

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
  // Seen in the W7-C run: a state put back whole made every finished plan "replanned" and "done" again, with notices
  it('says nothing for a whole state read back with the same replan marks (new objects, same values)', () => {
    const s = state({ jobs: [job({ lastReplan: { runId: 'r1', mode: 'completion', wave: 1, done: 1, at: T0, summary: 'done' } })], tasks: [task('a', { status: 'completed' })] })
    expect(deriveActivity(s, structuredClone(s))).toEqual([])
  })

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

  it('a fresh coordinator: "Coordinator refreshed (wave 3)", once per refresh', () => {
    const first = { at: T0, reason: 'wave 3', from: 'c1', to: 'c2', wave: 3 }
    const lines = deriveActivity(state(), state({ runs: [run({ coordinatorRefreshes: [first] })] }))
    expect(lines).toMatchObject([{ type: 'coordinator.refreshed', runId: 'r1', sessionId: 'c2', payload: { title: 'Plan A', reason: 'wave 3' } }])
    const second = { at: T0, reason: 'context 72%', from: 'c2', to: 'c3', contextPct: 72 }
    const next = deriveActivity(state({ runs: [run({ coordinatorRefreshes: [first] })] }), state({ runs: [run({ coordinatorRefreshes: [first, second] })] }))
    expect(next).toMatchObject([{ type: 'coordinator.refreshed', payload: { reason: 'context 72%' } }])
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
    expect(out[1].payload.failedTasks).toBe(1)
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
    // W8-E (#99): a failed plan says how many failed and that its final check was skipped, with no chime
    const failed = noticeOf(ev({ type: 'plan.done', runId: 'r1', payload: { title: 'P', runOutcome: 'failed', failedTasks: 2 } }))
    expect(failed).toMatchObject({ title: 'Plan finished with 2 failed', body: 'P. The final check was skipped.' })
    expect(failed?.alert).toBeUndefined()
    expect(noticeOf(ev({ type: 'gate.opened', payload: { title: 'A', gateId: 'g', question: 'Q?' } }))?.body).toContain('Q?')
    expect(noticeOf(ev({ type: 'plan.awaiting-approval', jobId: 'j1', payload: { title: 'P' } }))?.key).toBe('approve:j1')
    expect(noticeOf(ev({ type: 'dispatch.started', payload: { title: 'A' } }))).toBeNull()
  })

  // W6-G: a usage pause and its end are feed lines and notices; nothing in them asks the owner for anything.
  it('a usage pause and its end each give a notice', () => {
    const pause = { accountId: 'acc_1', window: 'five_hour' as const, percent: 93, resetsAt: '2026-10-17T14:20:00.000Z' }
    const paused = usageActivity({ type: 'usage.paused', pause })
    expect(paused).toEqual({
      type: 'usage.paused',
      payload: { title: 'acc_1', accountId: 'acc_1', usageWindow: 'five_hour', percent: 93, resetsAt: pause.resetsAt }
    })
    const n = noticeOf(ev(paused))
    expect(n?.title).toBe('New workers paused')
    expect(n?.body).toContain('93% of its 5-hour limit, resumes ~')
    expect(n?.body).toContain('Running workers carry on')
    expect(noticeOf(ev(usageActivity({ type: 'usage.resumed', pause })))?.title).toBe('New workers resumed')
  })

  it('a Gate that opens again with the same reason on the same Task is one notice; another reason or Task is another', () => {
    const gate = (gateId: string, taskId: string, question: string): ActivityEvent =>
      ev({ type: 'gate.opened', taskId, payload: { title: 'A', gateId, question } })
    const th = createNoticeThrottle({ max: 99 })
    const admit = (e: ActivityEvent): boolean => th.admit(noticeOf(e)!.key, 0)
    expect(admit(gate('gate_1', 'a', 'cannot merge'))).toBe(true)
    expect(admit(gate('gate_2', 'a', 'cannot merge'))).toBe(false)
    expect(admit(ev({ type: 'task.escalated', taskId: 'a', payload: { title: 'A', gateId: 'gate_3', reason: 'cannot merge' } }))).toBe(false)
    expect(admit(gate('gate_4', 'a', 'other reason'))).toBe(true)
    expect(admit(gate('gate_5', 'b', 'cannot merge'))).toBe(true)
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
    expect(digestText(summary({ blocked: [{ title: 'x', at: T0, reason: { kind: 'paused', why: 'held' } }] }))).toBeNull()
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
    const next: OrchState = { ...prev, jobs: [{ ...job, nothingToDo: { at: 'now', summary: 'login | built | web/login.py:1' } }] }
    const drafts = deriveActivity(prev, next)
    expect(drafts).toEqual([
      { type: 'plan.nothing-to-do', projectId: 'p1', jobId: 'job_1', payload: { plan: 'add login', title: 'add login', summary: 'login | built | web/login.py:1' } }
    ])
    expect(deriveActivity(next, { ...next, jobs: [...next.jobs] })).toEqual([])
    const e = { ...drafts[0], id: 'e1', sequence: 1, occurredAt: 'now' } as ActivityEvent
    expect(noticeOf(e)).toEqual({ key: 'nothing:job_1', title: 'Nothing to do: already built', body: 'add login' })
  })
})

// #111: a rejected plan is a feed line (and so the Inbox's handled list), once, carrying the owner's reason
describe('plan.rejected', () => {
  const job = { id: 'job_1', objective: 'add login', cwd: '/p', createdAt: '2026-10-18T00:00:00.000Z', projectId: 'p1', pendingStart: true } as Job
  it('is derived once, when the Job gains rejected, with the reason when given', () => {
    const prev: OrchState = { ...emptyState(), jobs: [job] }
    const next: OrchState = { ...prev, jobs: [{ ...job, rejected: { at: 'now', reason: 'too broad' } }] }
    expect(deriveActivity(prev, next)).toEqual([
      { type: 'plan.rejected', projectId: 'p1', jobId: 'job_1', payload: { plan: 'add login', title: 'add login', reason: 'too broad' } }
    ])
    expect(deriveActivity(next, { ...next, jobs: [...next.jobs] })).toEqual([])
  })

  it('has no reason key when the owner gave none', () => {
    const prev: OrchState = { ...emptyState(), jobs: [job] }
    const next: OrchState = { ...prev, jobs: [{ ...job, rejected: { at: 'now' } }] }
    expect(deriveActivity(prev, next)).toEqual([{ type: 'plan.rejected', projectId: 'p1', jobId: 'job_1', payload: { plan: 'add login', title: 'add login' } }])
  })
})

// W6-B: a coordinator's answer is a feed line and no notice; an escalation is a feed line, a notice and the chime
describe('W6-B: auto-answers and escalations', () => {
  const question = (over: Partial<Message> = {}): Message => ({
    id: 'q1',
    runId: 'r1',
    type: 'question',
    taskId: 'a',
    dispatchId: 'd1',
    subject: 'Which port?',
    body: 'Which port?',
    answered: false,
    createdAt: T0,
    ...over
  })
  const base = (messages: Message[]): OrchState => state({ dispatches: [dispatch('d1', 'a')], messages })

  it('a reply is question.auto-answered on the Task, with the question and the answer', () => {
    const prev = base([question()])
    const r = applyReply(prev, { messageId: 'q1', body: 'Use 8080, as plan.md says.' }, T0)
    if (!r.ok) throw new Error(r.error)
    const lines = deriveActivity(prev, r.state)
    expect(lines).toEqual([
      {
        type: 'question.auto-answered',
        projectId: 'p1',
        jobId: 'j1',
        runId: 'r1',
        taskId: 'a',
        sessionId: 'ses_d1',
        payload: { plan: 'Plan A', title: 'title a', question: 'Which port?', answer: 'Use 8080, as plan.md says.' }
      }
    ])
    expect(noticeOf(stamp(lines[0], T0))).toBeNull()
  })

  it('the empty settlement of a question nobody answered is no answer; an ack alone is no line', () => {
    const prev = base([question()])
    const settled = base([{ ...question(), answered: true, answerBody: '' }, { id: 's1', runId: 'r1', type: 'status', subject: 'x', body: '', replyTo: 'q1', answered: true, createdAt: T0 }])
    expect(deriveActivity(prev, settled)).toEqual([])
    expect(deriveActivity(prev, base([{ ...question(), ackedAt: T0 }]))).toEqual([])
  })

  it('an escalation is task.escalated, a notice that chimes', () => {
    const prev = base([])
    const esc: Message = { id: 'e1', runId: 'r1', type: 'escalation', taskId: 'a', dispatchId: 'd1', subject: 'Drop the users table?', body: 'details', answered: false, createdAt: T0 }
    const lines = deriveActivity(prev, base([esc]))
    expect(lines).toMatchObject([{ type: 'task.escalated', taskId: 'a', sessionId: 'ses_d1', payload: { title: 'title a', reason: 'Drop the users table?' } }])
    const n = noticeOf(stamp(lines[0], T0))
    expect(n).toMatchObject({ title: 'Needs your decision', alert: true, sessionId: 'ses_d1' })
    expect(n?.body).toContain('Drop the users table?')
  })

  // W7-C (#72): the owner's answer, to an ask or to an escalation, is a feed line "answered by you", never a notice
  it("the owner's answer is question.auto-answered with answeredBy owner, and no notice", () => {
    const prev = base([question()])
    const r = applyReply(prev, { messageId: 'q1', body: 'EUR', by: 'owner' }, T0)
    if (!r.ok) throw new Error(r.error)
    const lines = deriveActivity(prev, r.state)
    expect(lines).toMatchObject([{ type: 'question.auto-answered', taskId: 'a', payload: { question: 'Which port?', answer: 'EUR', answeredBy: 'owner' } }])
    expect(noticeOf(stamp(lines[0], T0))).toBeNull()
    const esc: Message = { id: 'e1', runId: 'r1', type: 'escalation', taskId: 'a', dispatchId: 'd1', subject: 'EUR or USD?', body: '', answered: false, createdAt: T0 }
    const before = base([esc])
    const answered = answerEscalation(before, { messageId: 'e1', body: 'USD' }, T0)
    if (!answered.ok) throw new Error(answered.error)
    expect(deriveActivity(before, answered.state)).toMatchObject([
      { type: 'question.auto-answered', payload: { question: 'EUR or USD?', answer: 'USD', answeredBy: 'owner' } }
    ])
  })

  it('a heartbeat or a status is no line', () => {
    const hb: Message = { id: 'h1', runId: 'r1', type: 'heartbeat', subject: '', body: '', answered: false, createdAt: T0 }
    expect(deriveActivity(base([]), base([hb, { ...hb, id: 'h2', type: 'status' }]))).toEqual([])
  })

  it('a Gate opened because the attempts ran out escalates too, under the Gate\'s notice key', () => {
    const lines = deriveActivity(state(), state({ gates: [gate({ kind: 'convergence-exhausted' })] }))
    expect(types(lines)).toEqual(['gate.opened', 'task.escalated'])
    const [opened, escalated] = lines.map((l) => noticeOf(stamp(l, T0)))
    expect(escalated?.key).toBe(opened?.key)
    expect(opened?.alert).toBe(true)
    // W6-C's review cap, by its reason; a plain Gate does not escalate
    expect(types(deriveActivity(state(), state({ gates: [{ ...gate(), reason: 'review-rounds-exhausted' } as Gate] })))).toEqual(['gate.opened', 'task.escalated'])
    expect(types(deriveActivity(state(), state({ gates: [gate()] })))).toEqual(['gate.opened'])
  })
})

// #117: a hands-off plan's decisions are feed lines, and its one notice is the plan.done that lists them
describe('hands-off decisions (#117)', () => {
  const hands = (over: Partial<Job> = {}): Job => job({ handsOff: true, ...over })
  const retry = { at: T0, kind: 'gate' as const, taskId: 'a', question: 'Checks failed 3 times', choice: 'retry-once', why: 'the attempts ran out: one more try' }
  const refused = { at: T0, kind: 'refused' as const, question: 'Push to main?', choice: 'hold', why: 'a guardrail' }

  it('each decision a commit adds is one plan.decided or plan.refused line', () => {
    const before = state({ jobs: [hands({ decisions: [retry] })] })
    const after = state({ jobs: [hands({ decisions: [retry, refused, { ...retry, choice: 'mark-failed', why: 'retried once' }] })] })
    const lines = deriveActivity(before, after)
    expect(types(lines)).toEqual(['plan.refused', 'plan.decided'])
    expect(lines[0].payload.reason).toBe('Refused: Push to main? (a guardrail)')
    expect(lines[1]).toMatchObject({ jobId: 'j1', taskId: 'a', payload: { title: 'title a', handsOff: true, reason: 'Decided for you: mark-failed — title a: retried once' } })
    expect(lines.map((l) => noticeOf(stamp(l, T0)))).toEqual([null, null])
  })

  it('no notice for its Gates or escalations; its plan.done notice lists the decisions', () => {
    const s0 = state({ jobs: [hands()] })
    const opened = deriveActivity(s0, state({ jobs: [hands()], gates: [gate({ kind: 'convergence-exhausted' })] }))
    expect(types(opened)).toEqual(['gate.opened', 'task.escalated'])
    expect(opened.map((l) => noticeOf(stamp(l, T0)))).toEqual([null, null])
    const decisions = [retry, refused]
    const done = deriveActivity(state({ jobs: [hands({ decisions })] }), state({ jobs: [hands({ decisions })], tasks: [task('a', { status: 'completed' })] })).filter(
      (l) => l.type === 'plan.done'
    )
    expect(done).toHaveLength(1)
    const n = noticeOf(stamp(done[0], T0))
    expect(n?.title).toBe('Plan done')
    expect(n?.body).toBe(`Plan A\n2 decision(s) made for you:\n- ${decisionLine(retry, 'title a')}\n- ${decisionLine(refused)}`)
    expect(n).not.toHaveProperty('alert')
  })

  it('a long list is trimmed for Slack: at most 10 lines of at most 160 characters', () => {
    const many = Array.from({ length: 14 }, (_, i) => `line ${i} ${'x'.repeat(200)}`)
    const n = noticeOf(stamp({ type: 'plan.done', runId: 'r1', payload: { title: 'P', runOutcome: 'completed', decisions: many } }, T0))
    const rows = n!.body.split('\n')
    expect(rows[1]).toBe('14 decision(s) made for you:')
    expect(rows.filter((r) => r.startsWith('- '))).toHaveLength(10)
    expect(rows.every((r) => r.length <= 162)).toBe(true)
    expect(rows.at(-1)).toBe('and 4 more in the activity feed')
  })

  it('a plan that is not hands-off notifies as before', () => {
    const lines = deriveActivity(state(), state({ gates: [gate({ kind: 'convergence-exhausted' })] }))
    expect(lines.map((l) => noticeOf(stamp(l, T0))?.alert)).toEqual([true, true])
  })
})

// Item 2: a hands-off refusal of an owner-only decision holds that one Task, with one owner notice
describe('a Task held for its owner', () => {
  const hands = (over: Partial<Job> = {}): Job => job({ handsOff: true, ...over })
  const refused = { at: T0, kind: 'refused' as const, taskId: 'a', question: 'Run the protected migration?', choice: 'Refused', why: 'a guardrail' }
  const why = "Waiting on the owner's decision: Run the protected migration?"
  const tasks = [task('a'), task('b', { status: 'dispatched' }), task('c', { status: 'pending', deps: ['a'] })]

  it('the refusal and the hold together raise exactly one owner notice, naming the Task and the decision', () => {
    const before = state({ jobs: [hands()], tasks })
    const refusedNow = state({ jobs: [hands({ decisions: [refused] })], tasks })
    // task-update moves only the Task: the Gates are the same array
    const heldNow = { ...refusedNow, tasks: [task('a', { status: 'blocked', result: why }), ...tasks.slice(1)] }
    const lines = [...deriveActivity(before, refusedNow), ...deriveActivity(refusedNow, heldNow)].map((l) => stamp(l, T0))
    const notices = lines.map(noticeOf).filter((n): n is ActivityNotice => n !== null)
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ title: 'Needs your decision', alert: true })
    expect(notices[0].body).toBe(`title a (Plan A): ${why}`)
    // b still runs: the plan is not over
    expect(types(lines)).not.toContain('plan.done')
  })

  it('once the rest ends, the plan ends finished-with-blocked: one plan.done saying which Tasks wait and why', () => {
    const held = [task('a', { status: 'blocked', result: why }), task('b', { status: 'dispatched' }), task('c', { status: 'pending', deps: ['a'] })]
    const ended = held.map((t) => (t.id === 'b' ? { ...t, status: 'completed' as const } : t))
    const done = deriveActivity(state({ jobs: [hands()], tasks: held }), state({ jobs: [hands()], tasks: ended })).filter((l) => l.type === 'plan.done')
    expect(done).toHaveLength(1)
    expect(done[0].payload).toMatchObject({ runOutcome: 'blocked', blockedTasks: [`title a: ${why}`] })
    const n = noticeOf(stamp(done[0], T0))
    expect(n?.title).toBe('Plan finished with 1 blocked')
    expect(n?.body).toContain(`- title a: ${why}`)
    // released by the owner: running again, no plan.done; and its later "Plan done" has a key of its own
    const released = ended.map((t) => (t.id === 'a' ? { ...t, status: 'ready' as const } : t))
    expect(types(deriveActivity(state({ jobs: [hands()], tasks: ended }), state({ jobs: [hands()], tasks: released })))).not.toContain('plan.done')
    expect(n?.key).not.toBe(noticeOf(stamp({ type: 'plan.done', runId: 'r1', payload: { title: 'P', runOutcome: 'completed' } }, T0))?.key)
  })
})

// Item 8: "Plan done" only after the final check settled having added nothing
describe('plan.done of a plan that replans', () => {
  const planned = (over: Partial<Job> = {}): Job => job({ coordinatorAccountId: 'acc_1', plannerSessionIds: ['ses_p'], ...over })
  const check = (done: number) => ({ runId: 'r1', mode: 'completion' as const, wave: 1, done, at: T0, summary: 'nothing to add' })
  const doneOf = (lines: ActivityDraft[]) => lines.filter((l) => l.type === 'plan.done')

  it('is not sent when the Tasks complete: the final check has not run', () => {
    const lines = deriveActivity(state({ jobs: [planned()], tasks: [task('a', { status: 'dispatched' })] }), state({ jobs: [planned()], tasks: [task('a', { status: 'completed' })] }))
    expect(doneOf(lines)).toEqual([])
  })

  it('is not sent from the Tasks either when an earlier check covered as many done Tasks: only a check that ends says so', () => {
    const lines = deriveActivity(
      state({ jobs: [planned({ lastReplan: check(1) })], tasks: [task('a', { status: 'dispatched' })] }),
      state({ jobs: [planned({ lastReplan: check(1) })], tasks: [task('a', { status: 'completed' })] })
    )
    expect(doneOf(lines)).toEqual([])
  })

  it('is sent once when the final check settles having added nothing, and not when it adds Tasks', () => {
    const tasks = [task('a', { status: 'completed' })]
    const checking = state({ jobs: [planned({ replanning: { runId: 'r1', mode: 'completion', wave: 1, done: 1, startedAt: T0 } })], tasks })
    const settled = state({ jobs: [planned({ lastReplan: check(1) })], tasks })
    expect(doneOf(deriveActivity(checking, settled))).toHaveLength(1)
    // the same settlement read back again is no second plan.done
    expect(doneOf(deriveActivity(settled, structuredClone(settled)))).toEqual([])
    const added = state({ jobs: [planned({ lastReplan: check(1) })], tasks: [...tasks, task('f', { status: 'ready' })] })
    expect(doneOf(deriveActivity(checking, added))).toEqual([])
  })
})

describe('plan.deliveryDismissed (T34)', () => {
  it('one line of its own kind when the owner dismisses a failed delivery, none when it was dismissed already', () => {
    const failed = state({ runs: [run({ deliveryState: { state: 'failed', attempts: 1 } })] })
    const dismissed = state({ runs: [run({ deliveryState: { state: 'dismissed', attempts: 1 } })] })
    expect(deriveActivity(failed, dismissed).filter((d) => d.type === 'plan.deliveryDismissed')).toEqual([
      { type: 'plan.deliveryDismissed', projectId: 'p1', jobId: 'j1', runId: 'r1', payload: { plan: 'Plan A', title: 'Plan A' } }
    ])
    expect(types(deriveActivity(failed, dismissed))).not.toContain('watchdog')
    expect(types(deriveActivity(dismissed, state({ runs: [run({ deliveryState: { state: 'dismissed', attempts: 1 } })], tasks: [task('a', { spec: 'x' })] })))).not.toContain('plan.deliveryDismissed')
  })
})

describe('task.edited (T7)', () => {
  it("one line when the owner changes a run Task's deps, spec, basis or evidence", () => {
    const before = state({ tasks: [task('a'), task('b', { status: 'pending', deps: ['a'], basis: { state: 'missing', evidence: 'none' } })] })
    const after = state({ tasks: [task('a'), task('b', { status: 'ready', deps: [], spec: 'new spec', basis: { state: 'missing', evidence: 'src/b.ts' } })] })
    const edited = deriveActivity(before, after).filter((d) => d.type === 'task.edited')
    expect(edited).toEqual([
      { type: 'task.edited', projectId: 'p1', jobId: 'j1', runId: 'r1', taskId: 'b', payload: { plan: 'Plan A', title: 'title b', edited: ['deps', 'spec', 'evidence'] } }
    ])
  })
  it('no line for a status move alone, nor for a replan editing its own plan', () => {
    expect(types(deriveActivity(state(), state({ tasks: [task('a', { status: 'dispatched' })] })))).not.toContain('task.edited')
    const replanning = job({ replanning: { runId: 'r1', mode: 'wave', wave: 1, done: 0, startedAt: T0 } })
    const before = state({ jobs: [replanning] })
    const after = state({ jobs: [replanning], tasks: [task('a', { spec: 'rewritten' })] })
    expect(types(deriveActivity(before, after))).not.toContain('task.edited')
  })
})
