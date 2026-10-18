import { describe, expect, it } from 'vitest'
import type { Dispatch, Task } from '../orchestration/types'
import { outcomeLabel, proseOf, rollupMarkdown, summaryFactsOf, summaryPrompt, type SessionSummary } from './summary'

const task = (over: Partial<Task>): Task =>
  ({ id: 't1', title: 'Add login', spec: '', deps: [], status: 'completed', consecutiveFailures: 0, createdAt: '', updatedAt: '', ...over }) as Task
const dispatch = (id: string, over: Partial<Dispatch>): Dispatch =>
  ({ id, taskId: 't1', sessionId: 's-worker', startedAt: '2026-10-18T10:00:00.000Z', ...over }) as Dispatch

const diff = [{ path: 'src/login.ts', added: 40, removed: 3 }]

describe('summaryFactsOf', () => {
  it('a worker merged after 2 review rounds: outcome, rounds, checks, questions, duration', () => {
    const r = summaryFactsOf({
      session: { id: 's-worker', title: 'Worker 2' },
      endedAt: '2026-10-18T10:30:00.000Z',
      task: task({ checks: [{ configId: 'c', name: 'typecheck', status: 'passed' }, { configId: 'd', name: 'lint', status: 'not-run' }] }),
      dispatches: [
        dispatch('d1', {}),
        dispatch('d2', { sessionId: 's-rev1', review: true }),
        dispatch('d3', { sessionId: 's-rev2', review: true })
      ],
      unitChecks: [{ name: 'vitest', status: 'passed' }],
      activity: [
        { type: 'question.auto-answered', taskId: 't1', payload: {} },
        { type: 'question.auto-answered', taskId: 't1', payload: { answeredBy: 'owner' } },
        { type: 'gate.resolved', taskId: 't1', payload: {} },
        { type: 'question.auto-answered', taskId: 'other', payload: {} }
      ],
      diff,
      commits: ['feat: login'],
      pr: 'https://github.com/o/r/pull/9'
    })
    expect(r.outcome).toBe('merged')
    expect(r.durationMs).toBe(30 * 60_000)
    expect(r.facts).toMatchObject({
      role: 'worker',
      title: 'Add login',
      files: diff,
      review: { rounds: 2, verdict: 'approved' },
      questions: { coordinator: 1, owner: 2 },
      commits: ['feat: login'],
      pr: 'https://github.com/o/r/pull/9'
    })
    expect(r.facts.checks).toEqual([
      { name: 'vitest', status: 'passed' },
      { name: 'typecheck', status: 'passed' },
      { name: 'lint', status: 'skipped' }
    ])
    expect(outcomeLabel(r)).toBe('Merged · 2 rounds')
  })

  it('a worker that gave up keeps its blocking review verdict', () => {
    const r = summaryFactsOf({
      session: { id: 's-worker', title: 'Worker' },
      endedAt: '2026-10-18T10:10:00.000Z',
      task: task({ status: 'failed', reviewIssues: [{ id: 'i', severity: 'high', blocking: true, title: 'x', description: '' }] as Task['reviewIssues'] }),
      dispatches: [dispatch('d1', {}), dispatch('d2', { sessionId: 's-rev', review: true })]
    })
    expect(r.outcome).toBe('gave-up')
    expect(r.facts.review).toEqual({ rounds: 1, verdict: 'changes-requested' })
    expect(outcomeLabel(r)).toBe('Gave up')
  })

  it('a stopped worker of a Task still running is Stopped', () => {
    const r = summaryFactsOf({
      session: { id: 's-worker', title: 'W' },
      endedAt: '2026-10-18T10:05:00.000Z',
      task: task({ status: 'dispatched' }),
      dispatches: [dispatch('d1', { closedBy: 'stop' })]
    })
    expect(r.outcome).toBe('stopped')
  })

  it('a plain session has no Task: Done, its own title, no review, duration from its start', () => {
    const r = summaryFactsOf({
      session: { id: 's-plain', title: 'Fix the readme', startedAt: '2026-10-18T09:00:00.000Z' },
      endedAt: '2026-10-18T09:12:00.000Z',
      diff
    })
    expect(r.outcome).toBe('done')
    expect(r.durationMs).toBe(12 * 60_000)
    expect(r.facts).toMatchObject({ role: 'session', title: 'Fix the readme', review: { rounds: 0, verdict: 'none' }, questions: { coordinator: 0, owner: 0 } })
  })
})

describe('prose', () => {
  it('summaryPrompt carries the facts, the agent summary and the tail', () => {
    const { facts } = summaryFactsOf({ session: { id: 's', title: 'T' }, endedAt: '2026-10-18T10:00:00.000Z', diff })
    const p = summaryPrompt({ facts, outcome: 'done', resultSummary: 'did the thing', tail: 'last words' })
    expect(p).toContain('src/login.ts (+40 -3)')
    expect(p).toContain('did the thing')
    expect(p).toContain('last words')
  })

  it('proseOf takes a text string and nothing else', () => {
    expect(proseOf({ text: '  Added login.  ' })).toBe('Added login.')
    expect(proseOf({ text: '' })).toBeNull()
    expect(proseOf({ text: 3 })).toBeNull()
    expect(proseOf(null)).toBeNull()
  })
})

describe('rollupMarkdown', () => {
  const card = (over: Partial<SessionSummary>): SessionSummary => ({
    sessionId: 's',
    at: '2026-10-18T10:00:00.000Z',
    text: 'Added login.',
    ...summaryFactsOf({
      session: { id: 's', title: 'Add login' },
      endedAt: '2026-10-18T10:00:00.000Z',
      task: task({}),
      diff,
      unitChecks: [{ name: 'vitest', status: 'passed' }]
    }),
    ...over
  })

  it('lists worker cards under "What each task did", facts first and prose after', () => {
    const md = rollupMarkdown([card({}), card({ sessionId: 'p', facts: { ...card({}).facts, role: 'session' } })])
    expect(md).toBe('## What each task did\n\n- **Add login** — Merged. 1 file, checks 1/1. Added login.')
  })

  it('is empty with no worker card, and a card with no prose still reads', () => {
    expect(rollupMarkdown([])).toBe('')
    expect(rollupMarkdown([card({ text: '' })])).toContain('checks 1/1.')
  })
})
