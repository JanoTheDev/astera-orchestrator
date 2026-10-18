// W3-A: the feed's words and list (activityView.ts).
import { describe, expect, it } from 'vitest'
import type { ActivityEvent } from '../../../../core/orchestration/activity'
import { feedOf, lineOf, mergePage, summaryOf, whoOf } from './activityView'

const T0 = '2026-10-17T00:00:00.000Z'
const ev = (n: number, over: Partial<ActivityEvent> = {}): ActivityEvent => ({
  id: `ev_000000000000_${n}`,
  sequence: n,
  occurredAt: T0,
  type: 'task.status',
  jobId: 'j1',
  payload: { title: 'Task A', plan: 'Plan A', category: 'cancelled', status: 'dispatched', model: 'opus', accountId: 'acc_1' },
  ...over
})
const label = (id: string): string => (id === 'acc_1' ? 'Work' : id)

describe('activityView', () => {
  it('a page joins the held lines once each, the newest kept', () => {
    expect(mergePage([ev(1), ev(2)], [ev(2), ev(3)]).map((e) => e.sequence)).toEqual([1, 2, 3])
    expect(mergePage([ev(1), ev(2)], [ev(3)], 2).map((e) => e.sequence)).toEqual([2, 3])
  })

  it('one plan’s lines, or all', () => {
    const lines = [ev(1), ev(2, { jobId: 'j2' })]
    expect(feedOf(lines, 'j2').map((e) => e.sequence)).toEqual([2])
    expect(feedOf(lines, null)).toHaveLength(2)
  })

  it('W6-B: an auto-answer and an escalation', () => {
    expect(lineOf(ev(1, { type: 'question.auto-answered', payload: { title: 'T', question: 'Port?', answer: '8080' } }), label)).toEqual({
      text: 'T: coordinator answered "Port?": 8080',
      tone: 'info'
    })
    expect(lineOf(ev(1, { type: 'task.escalated', payload: { title: 'T', reason: 'Drop it?' } }), label)).toEqual({ text: 'T: needs your decision: Drop it?', tone: 'bad' })
  })

  it('says completed, failed, cancelled and awaiting review apart, and who did it', () => {
    expect(lineOf(ev(1), label)).toEqual({ text: 'Task A: cancelled', tone: 'warn' })
    expect(lineOf(ev(1, { payload: { title: 'T', category: 'awaiting-review' } }), label).text).toBe('T: awaiting review')
    expect(lineOf(ev(1, { payload: { title: 'T', category: 'failed' } }), label).tone).toBe('bad')
    expect(lineOf(ev(1, { type: 'dispatch.rolled', payload: { title: 'T', accountId: 'acc_1', rollReason: 'waiting' } }), label).text).toBe(
      'T: hit a limit on Work, waiting for the reset'
    )
    expect(whoOf(ev(1), label)).toBe('Plan A · opus · Work')
  })

  it('W5-D: a waiting worker says what it waits on; a paired Runtime\'s line says where it ran', () => {
    expect(lineOf(ev(1, { type: 'task.waiting', payload: { title: 'T', waitingFor: 'permission' } }), label)).toEqual({ text: 'T: waiting for your permission', tone: 'warn' })
    expect(lineOf(ev(1, { type: 'task.waiting', payload: { title: 'T', waitingFor: 'question' } }), label).text).toBe('T: waiting for your answer to a question')
    expect(whoOf(ev(1, { runtimeId: 'rt_a' }), label)).toBe('Plan A · opus · Work · on rt_a')
  })

  it('the summary for one plan', () => {
    const s = {
      since: T0,
      completed: [{ title: 'a', jobId: 'j1', at: T0 }, { title: 'b', jobId: 'j2', at: T0 }],
      failed: [],
      cancelled: [],
      awaitingReview: [],
      plansDone: [],
      blocked: [{ title: 'c', jobId: 'j1', at: T0, reason: { kind: 'paused' as const } }]
    }
    expect(summaryOf(s, 'j1').map((b) => [b.label, b.items.length])).toEqual([
      ['completed', 1],
      ['blocked', 1]
    ])
    expect(summaryOf(s, null)[0].items).toHaveLength(2)
  })
})
