import { describe, expect, it } from 'vitest'
import { t as translate, type MessageKey, type MessageParams } from '../../../../core/i18n'
import type { SessionSummary } from '../../../../core/sessions/summary'
import { durationText, indexSummaries, outcomeText, outcomeTone, summaryFactsLine, summaryOneLine } from './summaryText'

const t = (key: MessageKey, params?: MessageParams): string => translate('en', key, params)

const card = (over: Partial<SessionSummary> = {}): SessionSummary => ({
  sessionId: 's1',
  taskId: 't1',
  at: '2026-10-18T10:00:00Z',
  outcome: 'merged',
  durationMs: 65 * 60_000,
  text: '',
  facts: {
    role: 'worker',
    title: 'Add login',
    files: [
      { path: 'a.ts', added: 30, removed: 2 },
      { path: 'b.ts', added: 10, removed: 10 }
    ],
    checks: [
      { name: 'test', status: 'passed' },
      { name: 'lint', status: 'failed' }
    ],
    review: { rounds: 2, verdict: 'approved' },
    questions: { coordinator: 1, owner: 1 },
    commits: ['feat: login']
  },
  ...over
})

describe('summary card text', () => {
  it('outcome tone and label', () => {
    expect(outcomeTone('merged')).toBe('ok')
    expect(outcomeTone('gave-up')).toBe('danger')
    expect(outcomeTone('stopped')).toBe('warn')
    expect(outcomeTone('done')).toBe('neutral')
    expect(outcomeText(card(), t)).toBe('Merged · 2 rounds')
    expect(outcomeText(card({ outcome: 'gave-up' }), t)).toBe('Gave up')
  })

  it('duration', () => {
    expect(durationText(0, t)).toBe('')
    expect(durationText(40_000, t)).toBe('40s')
    expect(durationText(12 * 60_000, t)).toBe('12m')
    expect(durationText(65 * 60_000, t)).toBe('1h 5m')
  })

  it('facts line, and nothing for no facts', () => {
    expect(summaryFactsLine(card(), t)).toBe('files: 2 +40 −12 · checks 1/2 · review rounds: 2, approved · questions: 2 (lead agent 1, you 1) · commits: 1')
    const bare = card()
    bare.facts = { ...bare.facts, files: [], checks: [], review: { rounds: 0, verdict: 'none' }, questions: { coordinator: 0, owner: 0 }, commits: [] }
    expect(summaryFactsLine(bare, t)).toBe('')
  })

  it('one line: the first sentence of the prose, else the facts', () => {
    expect(summaryOneLine(card({ text: 'Added the login form.  Tests pass.' }), t)).toBe('Added the login form.')
    expect(summaryOneLine(card(), t)).toBe(summaryFactsLine(card(), t))
  })

  it('index: newest card per Task and per session', () => {
    const a = card({ sessionId: 's2', at: '2026-10-18T11:00:00Z' })
    const b = card()
    const i = indexSummaries([a, b])
    expect(i.byTask.get('t1')).toBe(a)
    expect(i.bySession.get('s1')).toBe(b)
  })
})
