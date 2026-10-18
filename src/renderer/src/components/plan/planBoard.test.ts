import { describe, expect, it } from 'vitest'
import type { JobTask, TaskBlockedReason } from '../../../../core/types'
import { ko } from '../../../../core/i18n/messages/ko'
import { categoryOf, planProgressOf, reasonText } from './planBoard'

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
      { kind: 'paused' },
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
      { kind: 'global-cap', used: 4, limit: 4, priority: 1 },
      { kind: 'next' },
      // W6-G
      { kind: 'usage-paused', accountId: 'a', window: 'five_hour', percent: 93, resetsAt: '2026-10-17T14:20:00.000Z' },
      { kind: 'usage-paused', accountId: 'a', window: 'seven_day', percent: 95, resetsAt: '2026-10-20T14:20:00.000Z' },
      { kind: 'usage-paused', accountId: 'a', window: 'five_hour', percent: 93, resetsAt: null }
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
