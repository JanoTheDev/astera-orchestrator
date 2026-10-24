import { describe, it, expect } from 'vitest'
import type { Gate, Job, JobRun, Message, Task } from './types'
import {
  buildSessionIndex,
  needsInput,
  searchSessions,
  type SessionIndexInput,
  type TreePlan,
  type TreeProject,
  type TreeSession
} from './sessionIndex'

const at = '2026-10-01T00:00:00Z'
const s = (sessionId: string, role: TreeSession['role'], label: string, project: string, plan: string, over: Partial<TreeSession> = {}): TreeSession => ({
  sessionId, role, label, projectName: project, planName: plan, ...over
})
const plan = (jobId: string, name: string, project: string, over: Partial<TreePlan> = {}): TreePlan => ({
  jobId, projectId: project, name, planner: [], coordinator: [], workers: [], ...over
})
const job = (id: string, over: Partial<Job> = {}): Job => ({ id, objective: id, cwd: '/repos/x', createdAt: at, ...over })
const run = (id: string, jobId: string): JobRun => ({ id, jobId, ordinal: 1, createdAt: at })
const task = (id: string, over: Partial<Task> = {}): Task => ({
  id, runId: 'r1', title: `task ${id}`, spec: '', deps: [], status: 'dispatched', consecutiveFailures: 0, createdAt: at, updatedAt: at, ...over
})
/** A Task of a plan before it runs (no Run yet). */
const planTask = (jobId: string): Task => task(`plan-${jobId}`, { runId: undefined, jobId })
const gate = (id: string, taskId: string, over: Partial<Gate> = {}): Gate => ({
  id, runId: 'r1', taskId, question: `question ${id}`, status: 'open', createdAt: at, ...over
})

/** Two projects: Gameful has the Trading plan (planner, coordinator, two workers), Redis has a plan with one worker. */
const tree: TreeProject[] = [
  {
    id: 'p1', name: 'Gameful', path: '/repos/gameful',
    plans: [
      plan('j1', 'Trading', 'p1', {
        planner: [s('pl', 'planner', 'Trading Planner', 'Gameful', 'Trading')],
        coordinator: [s('co', 'coordinator', 'Trading Coordinator', 'Gameful', 'Trading')],
        workers: [
          s('w1', 'worker', 'Trading Worker 1', 'Gameful', 'Trading', { taskId: 't1', taskTitle: 'Split the order book', model: 'sonnet' }),
          s('w2', 'worker', 'Trading Worker 2', 'Gameful', 'Trading', { taskId: 't2', taskTitle: 'Price feed' })
        ]
      })
    ]
  },
  {
    id: 'p2', name: 'Redis', path: '/repos/redis',
    plans: [plan('j2', 'Perf', 'p2', { workers: [s('w3', 'worker', 'Perf Worker 1', 'Redis', 'Perf', { taskId: 't3', taskTitle: 'Trace the slow path' })] })]
  }
]

const input = (over: Partial<SessionIndexInput> = {}): SessionIndexInput => ({
  tree,
  jobs: [job('j1'), job('j2')],
  runs: [run('r1', 'j1'), run('r2', 'j2')],
  tasks: [task('t1', { links: { branch: 'astera/t1' } }), task('t2'), task('t3', { runId: 'r2' })],
  gates: [],
  attention: {},
  ...over
})

describe('buildSessionIndex', () => {
  it('lists every session of every project with its plan, task, branch, attention and open Gates', () => {
    const index = buildSessionIndex(
      input({ attention: { w1: 'working', w3: 'waiting' }, gates: [gate('g1', 't1'), gate('g2', 't1', { status: 'resolved' })] })
    )
    expect(index.map((x) => x.sessionId)).toEqual(['pl', 'co', 'w1', 'w2', 'w3'])
    const w1 = index.find((x) => x.sessionId === 'w1')!
    expect(w1).toMatchObject({
      jobId: 'j1', projectId: 'p1', projectName: 'Gameful', planName: 'Trading', role: 'worker',
      taskTitle: 'Split the order book', model: 'sonnet', branch: 'astera/t1', attention: 'working', openGates: 1
    })
    // A session with no verdict yet reads idle, as attention.ts answers for an id it never saw
    expect(index.find((x) => x.sessionId === 'co')).toMatchObject({ attention: 'idle', openGates: 0 })
    expect(index.find((x) => x.sessionId === 'co')!.branch).toBeUndefined()
    expect(index.find((x) => x.sessionId === 'w3')).toMatchObject({ projectName: 'Redis', attention: 'waiting' })
  })
})

describe('searchSessions', () => {
  const index = buildSessionIndex(input())
  const ids = (q: string): string[] => searchSessions(index, q).map((x) => x.sessionId)

  it('asks for nothing with an empty query', () => {
    expect(ids('')).toEqual([])
    expect(ids('   ')).toEqual([])
  })

  it('finds a session by project, plan, task title or label, keeping its context', () => {
    expect(ids('redis')).toEqual(['w3'])
    expect(ids('order book')).toEqual(['w1'])
    expect(ids('coordinator')).toEqual(['co'])
    expect(searchSessions(index, 'slow')[0]).toMatchObject({ projectName: 'Redis', planName: 'Perf' })
  })

  it('ranks a whole or word-start match ahead of a part of a word, then a fuzzy one', () => {
    // "price" starts w2's task; "trading" is every Trading session's plan, so the label's own word wins only by field
    expect(ids('price')).toEqual(['w2'])
    expect(ids('worker 2')[0]).toBe('w2')
    // the letters of "Trading Worker 1" in order, but not of the other labels
    expect(ids('tw1')).toEqual(['w1'])
    // a word-start in a label beats a part of a word in a task title
    expect(ids('pl')[0]).toBe('pl')
  })

  it('needs every word to match, and keeps the index order on a tie', () => {
    expect(ids('gameful worker')).toEqual(['w1', 'w2'])
    expect(ids('gameful redis')).toEqual([])
  })
})

describe('needsInput', () => {
  it('collects waiting sessions, open Gates and plans awaiting approval across projects', () => {
    const items = needsInput(
      input({
        attention: { w3: 'waiting', w1: 'working' },
        gates: [gate('g1', 't2'), gate('g0', 't1', { status: 'resolved' })],
        jobs: [job('j1'), job('j2', { pendingStart: true, plannerSessionIds: [], planReadyAt: at })],
        tasks: [...input().tasks, planTask('j2')]
      })
    )
    expect(items.map((x) => x.kind)).toEqual(['session', 'gate', 'approval'])
    expect(items[0]).toMatchObject({ kind: 'session', session: { sessionId: 'w3', projectName: 'Redis' } })
    // The Gate's Task has a worker, so selecting it focuses that session
    expect(items[1]).toMatchObject({ kind: 'gate', jobId: 'j1', projectName: 'Gameful', planName: 'Trading', taskTitle: 'task t2', sessionId: 'w2' })
    expect(items[2]).toMatchObject({ kind: 'approval', jobId: 'j2', projectName: 'Redis', planName: 'Perf' })
  })

  it('an approval names the latest planner; a not-started plan with no planner is not awaiting approval', () => {
    const items = needsInput(
      input({ jobs: [job('j1', { pendingStart: true, plannerSessionIds: ['pl'], planReadyAt: at }), job('j2', { pendingStart: true })], tasks: [planTask('j1'), planTask('j2')] })
    )
    expect(items).toEqual([{ kind: 'approval', jobId: 'j1', projectName: 'Gameful', planName: 'Trading', sessionId: 'pl' }])
  })

  it('an approval card for a plan awaiting approval that has a Task, ready mark or not; none without a Task', () => {
    const planning = job('j1', { pendingStart: true, plannerSessionIds: ['pl'] })
    const approvals = (over: Partial<SessionIndexInput>): string[] => needsInput(input({ attention: {}, ...over })).map((i) => i.kind)
    expect(approvals({ jobs: [planning], tasks: [planTask('j1')] })).toEqual(['approval'])
    expect(approvals({ jobs: [{ ...planning, planReadyAt: at }], tasks: [planTask('j1')] })).toEqual(['approval'])
    // No Task of its own (only a run's copies are left)
    expect(approvals({ jobs: [planning], tasks: [task('t1')] })).toEqual([])
  })

  it('leaves out what belongs to a plan the tree does not show (an archived one)', () => {
    const shown = input({ tree: [tree[0]], attention: { w3: 'waiting' }, gates: [gate('g3', 't3', { runId: 'r2' })], jobs: [job('j2', { pendingStart: true, plannerSessionIds: [] })] })
    expect(needsInput(shown)).toEqual([])
  })

  it('W5-D (#42): a session the Host says waits counts with its reason, even when main has not heard of it', () => {
    const items = needsInput(input({ attention: {}, hostWaiting: { w1: 'permission', w3: 'question' } }))
    expect(items.map((i) => (i.kind === 'session' ? [i.session.sessionId, i.session.waitingFor] : i.kind))).toEqual([
      ['w1', 'permission'],
      ['w3', 'question']
    ])
  })

  it('an idle or working session is not waiting on anyone', () => {
    expect(needsInput(input({ attention: { w1: 'idle', w2: 'working' } }))).toEqual([])
  })
})

// W6-B: an escalation waits on the owner like a Gate, until its Task or its plan ends
describe('needsInput — escalations', () => {
  const esc = (id: string, over: Partial<Message> = {}): Message => ({
    id, runId: 'r1', type: 'escalation', taskId: 't2', subject: `decide ${id}`, body: '', answered: false, createdAt: at, ...over
  })

  it('lists an open one after the Gates, at its Task\'s worker, or else the coordinator', () => {
    const items = needsInput(input({ gates: [gate('g1', 't1')], escalations: [esc('e1'), esc('e2', { taskId: undefined })] }))
    expect(items.map((x) => x.kind)).toEqual(['gate', 'escalation', 'escalation'])
    expect(items[1]).toMatchObject({ kind: 'escalation', jobId: 'j1', projectName: 'Gameful', planName: 'Trading', taskTitle: 'task t2', sessionId: 'w2' })
    expect(items[2]).toMatchObject({ kind: 'escalation', sessionId: 'co' })
  })

  it('is gone once its Task completed, or its plan ended', () => {
    expect(needsInput(input({ tasks: [task('t1'), task('t2', { status: 'completed' })], escalations: [esc('e1')] }))).toEqual([])
    const allDone = [task('t1', { status: 'completed' }), task('t2', { status: 'completed' })]
    expect(needsInput(input({ tasks: allDone, escalations: [esc('e1', { taskId: undefined })] }))).toEqual([])
    // A failed Task with retries left still waits on the owner
    expect(needsInput(input({ tasks: [task('t1'), task('t2', { status: 'failed', consecutiveFailures: 1 })], escalations: [esc('e1')] }))).toHaveLength(1)
  })
})

// #117: a hands-off plan decides its Gates, escalations and approval itself
describe('needsInput — hands-off plans', () => {
  const esc: Message = { id: 'e1', runId: 'r1', type: 'escalation', taskId: 't2', subject: 'decide', body: '', answered: false, createdAt: at }
  const waiting = { attention: {}, gates: [gate('g1', 't2')], escalations: [esc], tasks: [...input().tasks, planTask('j2')] }
  const ready = job('j2', { pendingStart: true, plannerSessionIds: ['pl'], planReadyAt: at })

  it('lists no Gate, escalation or approval of a plan that runs hands-off, by its own setting or its project\'s', () => {
    expect(needsInput(input({ ...waiting, jobs: [job('j1'), ready] })).map((i) => i.kind)).toEqual(['gate', 'escalation', 'approval'])
    expect(needsInput(input({ ...waiting, jobs: [job('j1', { handsOff: true }), { ...ready, handsOff: true }] }))).toEqual([])
    expect(needsInput(input({ ...waiting, jobs: [job('j1'), ready], projects: [{ id: 'p1', handsOff: true }, { id: 'p2', handsOff: true }] }))).toEqual([])
    // The plan's own "off" wins over its project's "on"
    expect(needsInput(input({ ...waiting, jobs: [job('j1', { handsOff: false }), ready], projects: [{ id: 'p1', handsOff: true }] })).map((i) => i.kind)).toEqual(['gate', 'escalation', 'approval'])
  })

  it('still lists its sessions at a prompt', () => {
    expect(needsInput(input({ attention: { w1: 'waiting' }, jobs: [job('j1', { handsOff: true }), job('j2')] })).map((i) => i.kind)).toEqual(['session'])
  })
})
