import { describe, expect, it } from 'vitest'
import type { JobTask, TaskBlockedReason } from '../../../../core/types'
import { ko } from '../../../../core/i18n/messages/ko'
import { t } from '../../../../core/i18n'
import type { ActivityEvent } from '../../../../core/orchestration/activity'
import type { JobEvent } from '../../../../core/types'
import { filterByKind, kindsOf, reuseOf, answersKey, autoAnswersOf, cardEffortOf, cardModelOf, categoryOf, collapsedWavesOf, currentWaveOf, filesOf, nowOf, ordinal, planProgressOf, reasonText, replanningOf, stepStateOf, wavesOf } from './planBoard'
// W8-C plan after plan
import { reasonTone } from './planBoard'

const task = (id: string, over: Partial<JobTask> = {}): JobTask => ({ id, title: id, status: 'pending', openGates: 0, ...over })

describe('planProgressOf', () => {
  it('counts each bucket apart, and done over total rounded down', () => {
    const p = planProgressOf([
      task('a', { status: 'completed', board: { category: 'done' } }),
      task('b', { status: 'completed', board: { category: 'done' } }),
      task('c', { status: 'dispatched', board: { category: 'running' } }),
      task('d', { status: 'reviewing', board: { category: 'awaiting-review' } }),
      task('e', { status: 'failed', board: { category: 'failed' } }),
      task('f', { status: 'dispatched', board: { category: 'cancelled' } }),
      task('g', { board: { category: 'queued', reason: { kind: 'deps', waitingOn: [] } } })
    ])
    expect(p).toEqual({
      total: 7,
      percent: 28,
      counts: { done: 2, running: 1, 'awaiting-review': 1, queued: 1, failed: 1, cancelled: 1 }
    })
  })

  it('an empty plan is 0%, and 100% only when every Task is done', () => {
    expect(planProgressOf([]).percent).toBe(0)
    expect(planProgressOf([task('a', { status: 'completed' })]).percent).toBe(100)
    const many = Array.from({ length: 200 }, (_, i) => task(`t${i}`, { status: i === 0 ? 'pending' : 'completed' }))
    expect(planProgressOf(many).percent).toBe(99)
  })
})

describe('categoryOf', () => {
  it("takes the snapshot's bucket first", () => {
    expect(categoryOf(task('a', { status: 'dispatched', board: { category: 'cancelled' } }))).toBe('cancelled')
  })

  it('falls back to the status, with a stopped worker queued rather than cancelled', () => {
    const of = (over: Partial<JobTask>) => categoryOf(task('a', over))
    expect(of({ status: 'completed' })).toBe('done')
    expect(of({ status: 'failed' })).toBe('failed')
    expect(of({ status: 'reviewing' })).toBe('awaiting-review')
    expect(of({ status: 'validating' })).toBe('running')
    expect(of({ status: 'merging' })).toBe('running')
    expect(of({ status: 'dispatched', startedAt: '2026-10-17T00:00:00.000Z' })).toBe('running')
    expect(of({ status: 'dispatched' })).toBe('queued')
    for (const status of ['pending', 'ready', 'blocked'] as const) expect(of({ status })).toBe('queued')
  })
})

describe('reasonText', () => {
  const label = (id: string): string => `label:${id}`
  const now = Date.parse('2026-10-17T00:00:00.000Z')

  it('every reason has a catalog key, and the params the key names', () => {
    const all: TaskBlockedReason[] = [
      { kind: 'rate-limited', accountId: 'a', switching: false, resetsAt: '2026-10-17T02:00:00.000Z' },
      { kind: 'rate-limited', accountId: 'a', switching: false },
      { kind: 'rate-limited', accountId: 'a', switching: true },
      { kind: 'archived' },
      { kind: 'pending-start' },
      { kind: 'paused', why: 'stopped' },
      { kind: 'paused', why: 'schedule' },
      { kind: 'paused', why: 'held' },
      { kind: 'paused', why: 'replanning' },
      { kind: 'paused', why: 'final-check' },
      { kind: 'paused', why: 'replan-question' },
      { kind: 'definition' },
      { kind: 'gate', gateId: 'g', question: 'q?' },
      { kind: 'failure-limit', failures: 3, limit: 3 },
      { kind: 'failed-retry', failures: 1, limit: 3 },
      { kind: 'failed-retry', failures: 1, limit: 3, noCoordinator: true },
      { kind: 'awaiting-review' },
      { kind: 'stopped' },
      { kind: 'deps', waitingOn: [{ id: 'x', title: 'X', status: 'ready' }] },
      { kind: 'no-account' },
      { kind: 'coordinator' },
      { kind: 'plan-cap', used: 2, limit: 2 },
      { kind: 'global-cap', running: 3, starting: 1, limit: 4, priority: 1 },
      { kind: 'next' },
      // W6-G
      { kind: 'usage-paused', accountId: 'a', window: 'five_hour', percent: 93, resetsAt: '2026-10-17T14:20:00.000Z' },
      { kind: 'usage-paused', accountId: 'a', window: 'seven_day', percent: 95, resetsAt: '2026-10-20T14:20:00.000Z' },
      { kind: 'usage-paused', accountId: 'a', window: 'five_hour', percent: 93, resetsAt: null },
      // W8-D
      { kind: 'same-files', waitingOn: { id: 't6', title: 'T6' }, path: 'src/a.ts' },
      { kind: 'same-files', waitingOn: { id: 't6', title: 'T6' }, path: 'src/a.ts', plan: { id: 'jA', title: 'Auth rework' } }
    ]
    for (const r of all) {
      const { key, params } = reasonText(r, now, label)
      expect(ko[key], key).toBeDefined()
      const named = [...ko[key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
      expect(Object.keys(params ?? {}).sort(), key).toEqual(named)
    }
  })

  it('names the account and the time left; a past reset drops the time', () => {
    expect(reasonText({ kind: 'rate-limited', accountId: 'a', switching: false, resetsAt: '2026-10-17T02:00:00.000Z' }, now, label))
      .toMatchObject({ key: 'plan.reason.rateLimited', params: { account: 'label:a' } })
    expect(reasonText({ kind: 'rate-limited', accountId: 'a', switching: false, resetsAt: '2026-10-16T00:00:00.000Z' }, now, label))
      .toEqual({ key: 'plan.reason.rateLimitedNoTime', params: { account: 'label:a' } })
  })

  // W6-G: "paused: account at 93% of its 5-hour limit, resumes ~14:20"
  it('a usage pause names the account, the share, the window and when it resumes', () => {
    const resetsAt = '2026-10-17T14:20:00.000Z'
    const time = new Date(resetsAt).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
    expect(reasonText({ kind: 'usage-paused', accountId: 'a', window: 'five_hour', percent: 93, resetsAt }, now, label)).toEqual({
      key: 'plan.reason.usagePaused5h',
      params: { account: 'label:a', percent: 93, time }
    })
  })

  it('lists the deps it waits on by title', () => {
    const r: TaskBlockedReason = {
      kind: 'deps',
      waitingOn: [
        { id: 'x', title: 'Build API', status: 'dispatched' },
        { id: 'y', title: 'Write schema', status: 'pending' }
      ]
    }
    expect(reasonText(r, now, label)).toEqual({ key: 'plan.reason.deps', params: { tasks: 'Build API, Write schema' } })
  })
})

// W6-E progress view
const act = (type: string, over: Partial<ActivityEvent> = {}): ActivityEvent =>
  ({ id: type, sequence: 0, occurredAt: '2026-10-18T10:00:00Z', type, runId: 'r1', payload: { title: 't' }, ...over }) as ActivityEvent
const done = (id: string, over: Partial<JobTask> = {}): JobTask => task(id, { status: 'completed', ...over })
const running = (id: string, over: Partial<JobTask> = {}): JobTask => task(id, { status: 'dispatched', startedAt: '2026-10-18T09:00:00Z', ...over })

describe('wavesOf / currentWaveOf', () => {
  it('groups by the depth layers with per-wave done counts, and points at the first unfinished wave', () => {
    const tasks = [done('a'), done('b'), running('c'), task('d')]
    const waves = wavesOf(tasks, [['a', 'b'], ['c'], ['d']])
    expect(waves.map((w) => [w.index, w.tasks.map((t) => t.id), w.done])).toEqual([
      [0, ['a', 'b'], 2],
      [1, ['c'], 0],
      [2, ['d'], 0]
    ])
    expect(currentWaveOf(waves)).toBe(1)
    expect(currentWaveOf(wavesOf([done('a')], [['a']]))).toBe(-1)
  })
  it('puts a Task the layers do not place (a cycle, a stale detail) in one wave after them', () => {
    const waves = wavesOf([done('a'), task('x')], [['a', 'gone']])
    expect(waves.map((w) => w.tasks.map((t) => t.id))).toEqual([['a'], ['x']])
  })
})

describe('replanningOf', () => {
  it("is on from this plan's plan.replanning until its plan.replanned", () => {
    expect(replanningOf([], 'r1')).toBe(false)
    expect(replanningOf([act('plan.replanning')], 'r1')).toBe(true)
    expect(replanningOf([act('plan.replanning'), act('plan.replanned')], 'r1')).toBe(false)
    expect(replanningOf([act('plan.replanning', { runId: undefined, jobId: 'r1' })], 'r1')).toBe(true)
    expect(replanningOf([act('plan.replanning', { runId: 'other' })], 'r1')).toBe(false)
  })
})

describe('autoAnswersOf', () => {
  it("lists one Task's question.auto-answered lines with question and answer", () => {
    const events = [
      act('question.auto-answered', { taskId: 't1', payload: { title: 'T', question: 'Use v2?', answer: 'Yes' } as never }),
      act('question.auto-answered', { taskId: 't2', payload: { title: 'T', question: 'other' } as never }),
      act('task.status', { taskId: 't1' })
    ]
    expect(autoAnswersOf(events, 't1')).toEqual([{ question: 'Use v2?', answer: 'Yes', at: '2026-10-18T10:00:00Z' }])
  })
})

describe('filesOf', () => {
  it('lists every path with the Tasks that touch it, sorted, so overlap shows', () => {
    const files = filesOf([task('a', { affectedPaths: ['src/x.ts', 'b.ts'] }), task('b', { affectedPaths: ['src/x.ts'] }), task('c')])
    expect(files.map((f) => [f.path, f.tasks.map((t) => t.id)])).toEqual([
      ['b.ts', ['a']],
      ['src/x.ts', ['a', 'b']]
    ])
  })
})

describe('nowOf', () => {
  const now = Date.parse('2026-10-18T10:00:12Z')
  const at = Date.parse('2026-10-18T10:00:00Z')
  const question = (answered: boolean): JobEvent =>
    ({ at: '', kind: 'message', sourceId: 'm', taskId: 'c', messageType: 'question', summary: 'q', answered }) as JobEvent
  it('says what a running worker is doing, the most pressing first', () => {
    const c = running('c')
    expect(nowOf(c, { lastAction: { tool: 'Edit', target: 'src/x.ts', at } }, [], now)).toEqual({
      key: 'plan.now.editing',
      params: { target: 'src/x.ts', ago: '0:12' }
    })
    expect(nowOf(c, { lastAction: { tool: 'Bash', target: 'npm test', at } }, [], now)?.key).toBe('plan.now.running')
    expect(nowOf(c, { lastAction: { tool: 'Edit', at } }, [question(false)], now)?.key).toBe('plan.steps.now.asked')
    expect(nowOf(c, { lastAction: { tool: 'Edit', at } }, [question(true)], now)?.key).toBe('plan.now.editing')
    expect(nowOf(c, { prompt: 'permission' }, [question(false)], now)?.key).toBe('plan.now.permission')
    expect(nowOf(c, undefined, [], now)).toBeNull()
  })
  it('W8-C heavy: says its place in the heavy-job line instead of the last tool call', () => {
    const c = running('c')
    expect(nowOf(c, { heavyWait: 2, lastAction: { tool: 'Bash', target: 'astera heavy -- npm test', at } }, [], now)).toEqual({
      key: 'plan.now.heavyWait',
      params: { place: '2nd' }
    })
    expect(nowOf(c, { heavyWait: 1, prompt: 'permission' }, [], now)?.key).toBe('plan.now.permission')
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st', '111th'])
  })
  it('says nothing for a Task that is not running', () => {
    expect(nowOf(done('c'), { prompt: 'permission' }, [], now)).toBeNull()
  })
})

describe('questionsOfTask', () => {
  it('picks one Task\'s asks and escalations, never a Gate row', async () => {
    const { questionsOfTask } = await import('./planBoard')
    const rows = [
      { id: 'msg_1', source: 'ask' as const, taskId: 't1', question: 'a' },
      { id: 'msg_2', source: 'escalation' as const, taskId: 't2', question: 'b' },
      { id: 'g1', taskId: 't1', question: 'gate' } as never
    ]
    expect(questionsOfTask(rows, 't1').map((q) => q.id)).toEqual(['msg_1'])
  })

  it('shows only the escalation when one is open beside the ask it is about', async () => {
    const { questionsOfTask } = await import('./planBoard')
    const rows = [
      { id: 'msg_1', source: 'ask' as const, taskId: 't1', question: 'EUR or USD?' },
      { id: 'msg_2', source: 'escalation' as const, taskId: 't1', question: 'EUR or USD? (owner decides)' }
    ]
    expect(questionsOfTask(rows, 't1').map((q) => q.id)).toEqual(['msg_2'])
  })
})

describe('cardModelOf / answersKey (#76)', () => {
  const task = (o: object): JobTask => ({ id: 't', title: 'T', status: 'pending', openGates: 0, ...o }) as JobTask
  it('an undispatched light Task shows the difficulty model, a Job override beats the default', () => {
    expect(cardModelOf(task({ difficulty: 'light' }), {}, [])).toBe('haiku')
    expect(cardModelOf(task({}), {}, [])).toBeUndefined()
    expect(cardModelOf(task({ jobModels: { worker: 'opus' } }), {}, [])).toBe('opus')
  })
  it('a dispatched Task keeps its attempt model', () => {
    expect(cardModelOf(task({ difficulty: 'light', attempts: 1 }), {}, [])).toBeUndefined()
    expect(cardModelOf(task({ difficulty: 'light', model: 'opus', attempts: 1 }), {}, [])).toBe('opus')
  })
  it('cardEffortOf: undispatched resolves (Task effort, then difficulty), dispatched keeps the recorded one', () => {
    expect(cardEffortOf(task({ difficulty: 'hard' }), {}, [])).toBe('high')
    expect(cardEffortOf(task({ difficulty: 'hard', effort: 'max' }), {}, [])).toBe('max')
    expect(cardEffortOf(task({ difficulty: 'hard', attempts: 1 }), {}, [])).toBeUndefined()
    expect(cardEffortOf(task({ difficulty: 'hard', attempts: 1, effort: 'low' }), {}, [])).toBe('low')
  })
  it('singular for one answer', () => {
    expect(answersKey(1)).toBe('plan.card.answers.one')
    expect(answersKey(2)).toBe('plan.card.answers')
  })
})

// W8-C plan after plan
describe('reasonText: a plan queued after another (W8-C)', () => {
  it('says Queued after <plan>, a wait; and Waiting on <plan>, which stopped, for a person', () => {
    const queued = { kind: 'pending-start' as const, after: { id: 'j1', title: 'Plan A' } }
    const stopped = { kind: 'pending-start' as const, after: { id: 'j1', title: 'Plan A', stopped: true as const } }
    expect(reasonText(queued, 0, (x) => x)).toEqual({ key: 'plan.reason.queuedAfter', params: { plan: 'Plan A' } })
    expect(reasonTone(queued)).toBe('wait')
    expect(reasonText(stopped, 0, (x) => x)).toEqual({ key: 'plan.reason.afterStopped', params: { plan: 'Plan A' } })
    expect(reasonTone(stopped)).toBe('action')
    expect(reasonText({ kind: 'pending-start' }, 0, (x) => x)).toEqual({ key: 'plan.reason.pendingStart' })
  })
})

// A held plan says why: a replan and the final check end by themselves, the rest wait on the owner
describe('reasonText — why a plan is paused', () => {
  it('a distinct key per why; a replan and the final check are plain waiting', () => {
    const whys = ['stopped', 'schedule', 'held', 'replanning', 'final-check', 'replan-question'] as const
    const keys = whys.map((why) => reasonText({ kind: 'paused', why }, 0, (x) => x).key)
    expect(new Set(keys).size).toBe(whys.length)
    expect(whys.map((why) => reasonTone({ kind: 'paused', why }))).toEqual(['action', 'action', 'action', 'wait', 'wait', 'action'])
  })
})

// W8-D: a Task held by another plan's worker on the same files says which plan and Task
describe('reasonText — same files of another plan', () => {
  it('reads "Waits for <plan> · <task> (same files: <path>)"', () => {
    const { key, params } = reasonText({ kind: 'same-files', waitingOn: { id: 't6', title: 'T6' }, path: 'src/api/routes.ts', plan: { id: 'jA', title: 'Auth rework' } }, 0, (id) => id)
    expect(t('en', key, params)).toBe('Waits for Auth rework · T6 (same files: src/api/routes.ts)')
  })
})

describe('gateQuestionsOfTask (W8-F, #97)', () => {
  it('a coordinator Gate and the convergence Gate become answer boxes with their options; free text is taken', async () => {
    const { gateQuestionsOfTask } = await import('./planBoard')
    expect(gateQuestionsOfTask(task('t1'))).toEqual([])
    const conv = task('t1', { gate: { id: 'gat_1', question: 'Out of tries', options: ['retry-once', 'mark-failed'], kind: 'convergence-exhausted' }, openGates: 1 })
    expect(gateQuestionsOfTask(conv)).toEqual([{ id: 'gat_1', source: 'ask', taskId: 't1', question: 'Out of tries', options: ['retry-once', 'mark-failed'] }])
    const asked = task('t2', { gate: { id: 'gat_2', question: 'Base on main?' }, openGates: 1 })
    expect(gateQuestionsOfTask(asked)).toEqual([{ id: 'gat_2', source: 'ask', taskId: 't2', question: 'Base on main?' }])
  })
  it('a check that could not be made takes its options only', async () => {
    const { gateQuestionsOfTask } = await import('./planBoard')
    const t = task('t3', { gate: { id: 'gat_3', question: 'q', options: ['retry', 'skip-check', 'mark-failed'], kind: 'check-unavailable' }, openGates: 1 })
    expect(gateQuestionsOfTask(t)[0].freeText).toBe(false)
  })
})

// W9-C Tasks page, Plans page, plan page
import type { JobRow } from '../../../../core/types'
import { areaGroupsOf, needsYouOf, overlapTableOf, planListOrder, planSectionOf, taskClickOf, taskColumnOf, topFolderOf } from './planBoard'

const row = (id: string, over: Partial<JobRow> = {}): JobRow => ({
  id, objective: id, outcome: 'running', done: 0, total: 0, eventCount: 0, sharesProjectFolder: false, tasks: [], ...over
})

describe('taskColumnOf (W9-C Tasks page)', () => {
  it('puts each Task in one of the five columns', () => {
    expect(taskColumnOf(task('a', { board: { category: 'queued', reason: { kind: 'deps', waitingOn: [] } } }))).toBe('planned')
    expect(taskColumnOf(task('b', { status: 'dispatched', startedAt: 'x', board: { category: 'running' } }))).toBe('working')
    expect(taskColumnOf(task('c', { status: 'reviewing', board: { category: 'awaiting-review' } }))).toBe('review')
    expect(taskColumnOf(task('d', { status: 'completed', board: { category: 'done' } }))).toBe('done')
    expect(taskColumnOf(task('e', { board: { category: 'cancelled' } }))).toBe('done')
  })
  it('needs you: a fault, an open gate, an ask, a prompt in its console, or a reason only the owner clears', () => {
    expect(taskColumnOf(task('a', { status: 'failed', board: { category: 'failed' } }))).toBe('needs-you')
    expect(taskColumnOf(task('b', { status: 'blocked', gate: { id: 'g', question: '?' }, openGates: 1 }))).toBe('needs-you')
    const running = task('c', { status: 'dispatched', startedAt: 'x', board: { category: 'running' } })
    expect(taskColumnOf(running, { prompt: 'permission' })).toBe('needs-you')
    expect(taskColumnOf(running, undefined, true)).toBe('needs-you')
    expect(taskColumnOf(task('d', { board: { category: 'queued', reason: { kind: 'no-account' } } }))).toBe('needs-you')
  })
  it('a plan waiting for approval or queued after another is planned, not needs-you (the Inbox card asks)', () => {
    expect(taskColumnOf(task('a', { board: { category: 'queued', reason: { kind: 'pending-start' } } }))).toBe('planned')
    expect(taskColumnOf(task('b', { board: { category: 'queued', reason: { kind: 'pending-start', after: { id: 'j', title: 'L' } } } }))).toBe('planned')
  })
})

describe('taskClickOf (W9-C click rules)', () => {
  const open = (id: string): boolean => id === 's1'
  it('working or in review → its console', () => {
    expect(taskClickOf('working', task('a', { sessionId: 's1' }), 'j', open)).toEqual({ kind: 'console', sessionId: 's1' })
    expect(taskClickOf('review', task('a', { sessionId: 's1' }), 'j', open)).toEqual({ kind: 'console', sessionId: 's1' })
  })
  it('a console that is gone → the plan Waves', () => {
    expect(taskClickOf('working', task('a', { sessionId: 's2' }), 'j', open)).toEqual({ kind: 'plan', jobId: 'j', section: 'waves' })
  })
  it('needs you → its Inbox card; planned → its plan Waves; done → the plan Overview summaries', () => {
    expect(taskClickOf('needs-you', task('a', { sessionId: 's1' }), 'j', open)).toEqual({ kind: 'inbox', filter: 'a' })
    expect(taskClickOf('planned', task('a'), 'j', open)).toEqual({ kind: 'plan', jobId: 'j', section: 'waves' })
    expect(taskClickOf('done', task('a'), 'j', open)).toEqual({ kind: 'plan', jobId: 'j', section: 'overview' })
  })
})

describe('planSectionOf (openPlan sections)', () => {
  it('keeps a known section, maps the old views, defaults to overview', () => {
    for (const s of ['overview', 'waves', 'files', 'changes', 'journal']) expect(planSectionOf(s)).toBe(s)
    expect(planSectionOf('board')).toBe('waves')
    expect(planSectionOf('graph')).toBe('waves')
    expect(planSectionOf('tasks')).toBe('waves')
    expect(planSectionOf(undefined)).toBe('overview')
    expect(planSectionOf('nope')).toBe('overview')
  })
  it('T8: keeps the settings and Task anchors, with or without #', () => {
    expect(planSectionOf('#settings')).toBe('settings')
    expect(planSectionOf('task-tsk_1')).toBe('task-tsk_1')
    expect(planSectionOf('#task-tsk_1')).toBe('task-tsk_1')
    expect(planSectionOf('#task-')).toBe('overview')
  })
})

describe('needsYouOf (T8 Needs you)', () => {
  it("lists each Task's open questions and Gate, in the plan's Task order", () => {
    const a = { id: 'a', title: 'A', status: 'blocked', openGates: 1, gate: { id: 'g1', question: 'Go?' } } as JobTask
    const b = { id: 'b', title: 'B', status: 'dispatched', openGates: 0 } as JobTask
    const asked = { id: 'q1', source: 'ask' as const, taskId: 'b', question: 'Which?' }
    expect(needsYouOf([a, b], [asked]).map((x) => [x.task.id, x.q.id])).toEqual([['a', 'g1'], ['b', 'q1']])
    expect(needsYouOf([b], [])).toEqual([])
  })
})

describe('planListOrder (Plans list)', () => {
  it('running, awaiting approval, queued, then finished and archived; stable inside a rank', () => {
    const rows = [
      row('archived', { archivedAt: 'x' }),
      row('done', { outcome: 'completed' }),
      row('queued', { pendingStart: true, after: 'run1' }),
      row('approve', { pendingStart: true }),
      row('run1'),
      row('run2')
    ]
    expect(planListOrder(rows).map((r) => r.id)).toEqual(['run1', 'run2', 'approve', 'queued', 'done', 'archived'])
  })
})

describe('areaGroupsOf / overlapTableOf (Plans views)', () => {
  const a = row('a', { areas: ['auth'], tasks: [task('t1', { title: 'T1', status: 'dispatched', startedAt: 'x', board: { category: 'running' }, affectedPaths: ['src/api/routes.ts'] })] })
  const b = row('b', { areas: ['leaderboard'], tasks: [task('t2', { title: 'T2', affectedPaths: ['src/api/rank.ts', 'docs/x.md'] })] })
  const c = row('c', { tasks: [task('t3', { status: 'completed', board: { category: 'done' }, affectedPaths: ['docs/y.md'] })] })
  it('groups by area with their folders; no area last', () => {
    expect(areaGroupsOf([c, b, a]).map((g) => [g.area, g.folders, g.rows.map((r) => r.id)])).toEqual([
      ['auth', ['src/api'], ['a']],
      ['leaderboard', ['docs', 'src/api'], ['b']],
      ['', ['docs'], ['c']]
    ])
  })
  it('lists a plan in two areas once, under its first', () => {
    const two = row('two', { areas: ['leaderboard', 'auth'] })
    expect(areaGroupsOf([two, a]).map((g) => [g.area, g.rows.map((r) => r.id)])).toEqual([
      ['auth', ['a']],
      ['leaderboard', ['two']]
    ])
  })
  it('says what each plan does per folder and marks the folders two plans still work in', () => {
    const tbl = overlapTableOf([a, b, c])
    expect(tbl.folders).toEqual(['docs', 'src/api'])
    expect(tbl.rows.map((r) => [r.row.id, r.cells])).toEqual([
      ['a', [null, { kind: 'editing', task: 'T1' }]],
      ['b', [{ kind: 'planned' }, { kind: 'planned' }]],
      ['c', [{ kind: 'done' }, null]]
    ])
    expect([...tbl.shared]).toEqual(['src/api'])
  })
  it('topFolderOf: two segments, or the folder of a shallow file', () => {
    expect(topFolderOf('src/api/routes.ts')).toBe('src/api')
    expect(topFolderOf('./docs/x.md')).toBe('docs')
    expect(topFolderOf('README.md')).toBe('README.md')
  })
})

describe('ageOf (Plans list row)', () => {
  it('says the age short', async () => {
    const { ageOf } = await import('./planBoard')
    const now = Date.parse('2026-10-18T12:00:00Z')
    expect(ageOf('2026-10-18T11:59:30Z', now)).toBe('<1m')
    expect(ageOf('2026-10-18T11:55:00Z', now)).toBe('5m')
    expect(ageOf('2026-10-18T09:00:00Z', now)).toBe('3h')
    expect(ageOf('2026-10-14T12:00:00Z', now)).toBe('4d')
  })
})

// T4
describe('collapsedWavesOf', () => {
  it('folds the finished waves; the current and later waves stay open', () => {
    const waves = wavesOf([done('a'), done('b'), task('c'), task('d')], [['a'], ['b'], ['c'], ['d']])
    expect([...collapsedWavesOf(waves)]).toEqual([0, 1])
    expect(currentWaveOf(waves)).toBe(2)
  })
  it('folds a plan whose waves are all done, and nothing while the first is open', () => {
    expect([...collapsedWavesOf(wavesOf([done('a')], [['a']]))]).toEqual([0])
    expect(collapsedWavesOf(wavesOf([task('a')], [['a']])).size).toBe(0)
  })
})

describe('task kinds (T4)', () => {
  const tasks = [task('a', { kind: 'bugfix' }), task('b', { kind: 'ui' }), task('c', { kind: 'bugfix' }), task('d')]
  it('lists the kinds present with counts, in the catalog order', () => {
    expect(kindsOf(tasks)).toEqual([
      { kind: 'bugfix', count: 2 },
      { kind: 'ui', count: 1 }
    ])
    expect(kindsOf([])).toEqual([])
  })
  it('filters by one kind; all lets every Task through, kindless ones included', () => {
    expect(filterByKind(tasks, 'bugfix').map((t) => t.id)).toEqual(['a', 'c'])
    expect(filterByKind(tasks, 'docs')).toEqual([])
    expect(filterByKind(tasks, 'all')).toBe(tasks)
  })
  it('a reuse Task names the one dep it continues in; others and unknown deps say nothing or no title', () => {
    const all = [task('a', { title: 'Schema' }), task('b', { worktree: 'reuse' }), task('c', { worktree: 'new' })]
    expect(reuseOf(all[1], all, { b: ['a'] })).toEqual({ title: 'Schema' })
    expect(reuseOf(all[1], all, undefined)).toEqual({})
    expect(reuseOf(all[1], all, { b: ['a', 'x'] })).toEqual({})
    expect(reuseOf(all[2], all, { c: ['a'] })).toBeNull()
    expect(reuseOf(all[0], all, {})).toBeNull()
  })
})

describe('stepStateOf', () => {
  const done = (id: string): JobTask => task(id, { status: 'completed', board: { category: 'done' } })
  const run = (id: string): JobTask => task(id, { status: 'dispatched', board: { category: 'running' } })
  const queued = (id: string): JobTask => task(id, { board: { category: 'queued', reason: { kind: 'deps', waitingOn: [] } } })
  const steps = (...groups: JobTask[][]) => wavesOf(groups.flat(), groups.map((g) => g.map((t) => t.id)))
  const of = (i: number, ws: ReturnType<typeof steps>, replanning = false) => stepStateOf(ws[i], ws, replanning)

  it('done when every Task is done', () => expect(of(0, steps([done('a')], [queued('b')]))).toEqual({ state: 'done' }))
  it('running when a Task is working', () => expect(of(0, steps([run('a'), queued('b')]))).toEqual({ state: 'running' }))
  it('ready when it can start and nothing runs yet', () => expect(of(1, steps([done('a')], [queued('b')]))).toEqual({ state: 'ready' }))
  it('waiting names the earlier step and its open Tasks', () =>
    expect(of(2, steps([done('a'), run('b'), queued('c')], [queued('d')], [queued('e')]))).toEqual({ state: 'waiting', on: 1, left: 2 }))
  it('blocked when a Task needs the owner', () =>
    expect(of(0, steps([task('a', { openGates: 1 }), run('b')]))).toEqual({ state: 'blocked' }))
  it('failed when a Task failed and nothing else runs', () => {
    const failed = task('a', { status: 'failed', board: { category: 'failed' } })
    expect(of(0, steps([failed, queued('b')]))).toEqual({ state: 'failed' })
    expect(of(0, steps([failed, run('b')]))).toEqual({ state: 'running' })
  })
  it('replanning marks the step being worked on only', () => {
    const ws = steps([queued('a')], [queued('b')])
    expect(of(0, ws, true)).toEqual({ state: 'replanning' })
    expect(of(1, ws, true)).toEqual({ state: 'waiting', on: 1, left: 1 })
  })
})
