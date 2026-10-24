// W9-D: the Inbox's ordering, grouping and filter routing (inboxView.ts).
import { describe, expect, it } from 'vitest'
import type { ActivityEvent } from '../../../../core/orchestration/activity'
import { needsInput, type InboxItem, type IndexedSession } from '../../../../core/orchestration/sessionIndex'
import type { Job, Task } from '../../../../core/orchestration/types'
import { ageOf, byDay, filterNeeds, handledOf, needsOf, orderNeeds, parseFilter, whereOf, type InboxInput, type NeedCard, type QuestionRow } from './inboxView'
import { t } from '../../../../core/i18n'

const en = (k: Parameters<typeof t>[1], p?: Parameters<typeof t>[2]): string => t('en', k, p)

const card = (key: string, at: string | null, over: Partial<NeedCard> = {}): NeedCard => ({
  key,
  kind: 'question',
  at,
  jobId: 'j1',
  projectName: 'gameful',
  planName: 'L4',
  ...over
})

const ev = (n: number, over: Partial<ActivityEvent> = {}): ActivityEvent => ({
  id: `ev_${n}`,
  sequence: n,
  occurredAt: `2026-10-18T10:0${n}:00.000Z`,
  type: 'plan.awaiting-approval',
  jobId: 'j1',
  payload: { title: 'L4', plan: 'L4' },
  ...over
})

const q = (id: string, over: Partial<QuestionRow> = {}): QuestionRow => ({
  id,
  runId: 'r1',
  taskId: 't1',
  question: 'Which db?',
  source: 'ask',
  createdAt: '2026-10-18T09:00:00.000Z',
  ...over
})

const session = (over: Partial<IndexedSession> = {}): IndexedSession => ({
  sessionId: 's1',
  role: 'worker',
  label: 'L4 Worker 1',
  projectName: 'gameful',
  planName: 'L4',
  jobId: 'j1',
  projectId: 'p1',
  attention: 'waiting',
  openGates: 0,
  taskId: 't1',
  taskTitle: 'T1',
  ...over
})

const input = (over: Partial<InboxInput> = {}): InboxInput => ({
  items: [],
  questions: [],
  jobs: [],
  plans: new Map([
    ['j1', { projectName: 'gameful', planName: 'L4' }],
    ['j2', { projectName: 'gameful', planName: 'Auth rework' }]
  ]),
  jobOfRun: new Map([
    ['r1', 'j1'],
    ['r2', 'j2']
  ]),
  taskTitles: new Map([
    ['t1', 'T1'],
    ['t6', 'T6']
  ]),
  events: [],
  ...over
})

describe('orderNeeds', () => {
  it('oldest first, a card with no time last, ties keep their order', () => {
    const out = orderNeeds([card('c', null), card('b', '2026-10-18T10:00:00Z'), card('a', '2026-10-18T09:00:00Z'), card('d', null)])
    expect(out.map((c) => c.key)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('needsOf', () => {
  it('lists questions, approvals and permission waits together, oldest first, each as its own kind', () => {
    const items: InboxItem[] = [
      { kind: 'approval', jobId: 'j2', projectName: 'gameful', planName: 'Auth rework', sessionId: 'pl1' },
      { kind: 'session', session: session({ sessionId: 's9', waitingFor: 'permission', taskId: 't6', taskTitle: 'T6' }) }
    ]
    const events = [ev(1, { jobId: 'j2' }), ev(2, { type: 'task.waiting', sessionId: 's9' })]
    const cards = needsOf(
      input({
        items,
        events,
        questions: [q('q1', { createdAt: '2026-10-18T10:05:00.000Z' }), q('g1', { source: undefined, taskId: 't6', runId: 'r2', createdAt: '2026-10-18T08:00:00.000Z' })]
      })
    )
    expect(cards.map((c) => [c.key, c.kind])).toEqual([
      ['q:g1', 'gate'],
      ['a:j2', 'approval'],
      ['s:s9', 'permission'],
      ['q:q1', 'question']
    ])
  })

  it('an escalation takes the place of the worker’s ask for the same Task', () => {
    const cards = needsOf(input({ questions: [q('ask1'), q('esc1', { source: 'escalation', createdAt: '2026-10-18T09:30:00.000Z' })] }))
    expect(cards.map((c) => c.key)).toEqual(['q:esc1'])
  })

  it('a question wait is not listed again beside the ask that explains it; a permission wait always is', () => {
    const items: InboxItem[] = [
      { kind: 'session', session: session({ waitingFor: 'question' }) },
      { kind: 'session', session: session({ sessionId: 's2', waitingFor: 'permission' }) }
    ]
    const cards = needsOf(input({ items, questions: [q('q1')] }))
    expect(cards.map((c) => c.key).sort()).toEqual(['q:q1', 's:s2'])
  })

  it('a question for a plan the tree no longer shows is dropped', () => {
    expect(needsOf(input({ questions: [q('q1', { runId: 'gone' })] }))).toEqual([])
  })

  it('an approval card for a waiting plan with a Task, ready mark or not', () => {
    const job = { id: 'j1', objective: 'o', cwd: '/g', createdAt: '2026-10-18T07:00:00.000Z', pendingStart: true, plannerSessionIds: ['pl1'] } as Job
    const planTask = { id: 't1', jobId: 'j1', title: 'T1', spec: '', deps: [], status: 'ready', consecutiveFailures: 0, createdAt: job.createdAt, updatedAt: job.createdAt } as Task
    const tree = [{ id: 'p1', name: 'gameful', path: '/g', plans: [{ jobId: 'j1', projectId: 'p1', name: 'L4', planner: [], coordinator: [], workers: [] }] }]
    const kinds = (j: Job): string[] => {
      const items = needsInput({ tree, jobs: [j], runs: [], tasks: [planTask], gates: [], attention: {} })
      return needsOf(input({ jobs: [j], items })).map((c) => c.kind)
    }
    expect(kinds(job)).toEqual(['approval'])
    expect(kinds({ ...job, planReadyAt: '2026-10-18T08:00:00.000Z' })).toEqual(['approval'])
  })

  it('an approval carries its overlaps and the plan it already waits for', () => {
    const job = {
      id: 'j1',
      createdAt: '2026-10-18T07:00:00.000Z',
      after: 'j2',
      overlaps: [{ taskId: 't1', jobId: 'j2', otherTaskId: 't6', by: 'path', path: 'src/api/routes.ts' }]
    } as unknown as Job
    const [c] = needsOf(input({ jobs: [job], items: [{ kind: 'approval', jobId: 'j1', projectName: 'gameful', planName: 'L4' }] }))
    expect(c.waitsOn).toBe('Auth rework')
    expect(c.overlaps?.map(({ line, ...o }) => ({ ...o, line: en(line.key, line.params) }))).toEqual([
      { taskId: 't1', taskTitle: 'T1', otherJobId: 'j2', otherPlanName: 'Auth rework', otherTaskTitle: 'T6', line: "T1 and Auth rework's T6 both edit src/api/routes.ts" }
    ])
    expect(c.at).toBe('2026-10-18T07:00:00.000Z') // no feed line yet: the plan's own time
  })
})

describe('filter routing', () => {
  const cards = [
    card('q', '1', { kind: 'question' }),
    card('e', '2', { kind: 'escalation' }),
    card('g', '3', { kind: 'gate', jobId: 'j2' }),
    card('a', '4', { kind: 'approval' }),
    card('p', '5', { kind: 'permission' }),
    card('w', '6', { kind: 'waiting', jobId: 'j2' })
  ]
  it('parses the strings openInbox takes', () => {
    expect(parseFilter(undefined)).toEqual({ group: 'all' })
    expect(parseFilter('approvals')).toEqual({ group: 'approvals' })
    expect(parseFilter('plan:j2')).toEqual({ group: 'all', planId: 'j2' })
    expect(parseFilter('nonsense')).toEqual({ group: 'all' })
    expect(parseFilter('plan:')).toEqual({ group: 'all' })
  })
  it('each group keeps its kinds; handled keeps no card', () => {
    const keys = (raw: string | undefined): string[] => filterNeeds(cards, parseFilter(raw)).map((c) => c.key)
    expect(keys(undefined)).toEqual(['q', 'e', 'g', 'a', 'p', 'w'])
    expect(keys('approvals')).toEqual(['a'])
    expect(keys('questions')).toEqual(['q', 'e', 'g'])
    expect(keys('permissions')).toEqual(['p', 'w'])
    expect(keys('handled')).toEqual([])
    expect(keys('plan:j2')).toEqual(['g', 'w'])
  })
})

describe('handledOf', () => {
  it('newest first, one plan’s lines under a plan filter', () => {
    const events = [ev(1), ev(2, { jobId: 'j2' }), ev(3)]
    expect(handledOf(events, { group: 'all' }, (id) => id).map((l) => l.id)).toEqual(['ev_3', 'ev_2', 'ev_1'])
    expect(handledOf(events, { group: 'all', planId: 'j2' }, (id) => id).map((l) => l.id)).toEqual(['ev_2'])
  })

  it('names the plan of every line and the Task of a Task line', () => {
    const [task, plan] = handledOf([ev(1), ev(2, { taskId: 't1', payload: { title: 'Fix login', plan: 'L4' } })], { group: 'all' }, (id) => id)
    expect([task.plan, task.task]).toEqual(['L4', 'Fix login'])
    expect([plan.plan, plan.task]).toEqual(['L4', undefined])
  })
})

describe('byDay', () => {
  it('groups newest-first lines under today, yesterday and the date', () => {
    const now = new Date(2026, 9, 18, 15, 0).getTime()
    const at = (d: number, h: number): string => new Date(2026, 9, d, h).toISOString()
    const tr = ((k: string) => k) as never
    const groups = byDay([{ at: at(18, 9) }, { at: at(18, 8) }, { at: at(17, 23) }, { at: at(12, 10) }], now, tr, 'en-US')
    expect(groups.map((g) => [g.label, g.lines.length])).toEqual([['inbox.day.today', 2], ['inbox.day.yesterday', 1], ['Oct 12', 1]])
  })
})

describe('ageOf / whereOf', () => {
  const now = Date.parse('2026-10-18T12:00:00Z')
  it('says how long a card has waited', () => {
    expect(ageOf(null, now, en)).toBe('')
    expect(ageOf('2026-10-18T11:59:50Z', now, en)).toBe('just now')
    expect(ageOf('2026-10-18T11:48:00Z', now, en)).toBe('12 min')
    expect(ageOf('2026-10-18T09:00:00Z', now, en)).toBe('3 h')
    expect(ageOf('2026-10-15T12:00:00Z', now, en)).toBe('3 d')
  })
  it('writes the place as project › plan · task', () => {
    expect(whereOf('gameful', 'L4', 'T1')).toBe('gameful › L4 · T1')
    expect(whereOf('gameful', 'L4')).toBe('gameful › L4')
  })
})

describe("T4: a worker's request to run an owner-only command", () => {
  it('is a command card of its own, in the approvals group, and covers its Task\'s question wait', () => {
    const asked = q('msg_a', { source: 'approval', question: 'The worker asks to run `astera jobs archive --id j9`. Approve or deny.', command: 'astera jobs archive --id j9', options: ['approve', 'deny'] })
    const items: InboxItem[] = [{ kind: 'session', session: session({ waitingFor: 'question' }) }]
    const cards = needsOf(input({ items, questions: [asked] }))
    expect(cards).toEqual([expect.objectContaining({ key: 'q:msg_a', kind: 'command', taskId: 't1', taskTitle: 'T1', q: asked })])
    expect(filterNeeds(cards, parseFilter('approvals')).map((c) => c.kind)).toEqual(['command'])
    expect(filterNeeds(cards, parseFilter('questions'))).toEqual([])
  })
})
