// W3-A: the feed's words and list (activityView.ts).
import { describe, expect, it } from 'vitest'
import type { ActivityEvent } from '../../../../core/orchestration/activity'
import { feedOf, filterLines, lineOf, mergePage, summaryOf, whoOf } from './activityView'

describe('plan.deliveryDismissed (T34)', () => {
  it("reads in the app's language", () => {
    const e = ev(10, { type: 'plan.deliveryDismissed', payload: { title: 'Plan A', plan: 'Plan A' } })
    expect(lineOf(e, label)).toEqual({ text: 'Plan A: delivery dismissed by you; it is not tried again', tone: 'warn' })
    for (const lang of ['ko', 'ja', 'es'] as const) expect(lineOf(e, label, lang).text).toContain('Plan A')
    expect(lineOf(e, label, 'es').text).toBe('Plan A: entrega descartada por ti; no se vuelve a intentar')
  })
})

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


describe('merging', () => {
  it('reads as running with a merging note', () => {
    expect(lineOf(ev(1, { payload: { title: 'Task A', category: 'running', status: 'merging' } } as never), label).text).toBe('Task A: running (merging)')
  })
})

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

  // W6-G: an account's usage pause holds every plan, so it is in each plan's feed, named by the account.
  it('a usage pause is a line in every plan’s feed, naming the account and when it resumes', () => {
    const paused = ev(3, {
      type: 'usage.paused',
      jobId: undefined,
      payload: { title: 'acc_1', accountId: 'acc_1', usageWindow: 'five_hour', percent: 93, resetsAt: '2026-10-17T14:20:00.000Z' }
    })
    expect(feedOf([ev(1), paused], 'j1').map((e) => e.sequence)).toEqual([1, 3])
    const line = lineOf(paused, label)
    expect(line.tone).toBe('warn')
    expect(line.text).toMatch(/^Work: new agents paused, at 93% of its 5-hour limit, resumes ~/)
    expect(lineOf({ ...paused, type: 'usage.resumed' }, label).text).toBe('Work: new agents resumed, under the usage threshold again')
  })

  it('W6-B: an auto-answer and an escalation', () => {
    expect(lineOf(ev(1, { type: 'question.auto-answered', payload: { title: 'T', question: 'Port?', answer: '8080' } }), label)).toEqual({
      text: 'T: lead agent answered "Port?": 8080',
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

  // #111: the owner's rejection is a bad line on the plan, with the reason when given
  it('#111: a rejected plan says so, with the reason', () => {
    expect(lineOf(ev(1, { type: 'plan.rejected', payload: { title: 'Plan A', reason: 'too broad' } }), label)).toEqual({ text: 'Plan A: plan rejected: too broad', tone: 'bad' })
    expect(lineOf(ev(1, { type: 'plan.rejected', payload: { title: 'Plan A' } }), label).text).toBe('Plan A: plan rejected')
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

  // #117: what a hands-off plan decided for the owner, and what it refused
  it('a decision is a "Decided for you" line, a refusal a "Refused" warning', () => {
    const decided = ev(4, { type: 'plan.decided', payload: { title: 'Task A', plan: 'Plan A', reason: 'Decided for you: retry-once — Task A: attempts ran out' } })
    const refused = ev(5, { type: 'plan.refused', payload: { title: 'Plan A', plan: 'Plan A', reason: 'Refused: drop the table? (destructive)' } })
    expect(lineOf(decided, label)).toEqual({ text: 'Task A: Decided for you: retry-once — Task A: attempts ran out', tone: 'info' })
    expect(lineOf(refused, label)).toEqual({ text: 'Plan A: Refused: drop the table? (destructive)', tone: 'warn' })
  })
})

describe('task.edited (T7)', () => {
  it("reads in the app's language, the edited fields named as their flags", () => {
    const edited = ev(9, { type: 'task.edited', payload: { title: 'Task A', plan: 'Plan A', edited: ['deps', 'spec'] } })
    expect(lineOf(edited, label)).toEqual({ text: 'Task A: edited by you — deps, spec', tone: 'info' })
    expect(lineOf(edited, label, 'ko').text).toBe('Task A: 직접 수정함 — deps, spec')
    expect(lineOf(edited, label, 'ja').text).toBe('Task A: あなたが編集 — deps, spec')
    expect(lineOf(edited, label, 'es').text).toBe('Task A: editado por ti — deps, spec')
  })
})

describe('plain words (no worker, coordinator, wave, watchdog)', () => {
  it('agent, lead agent, step N, stuck-plan check', () => {
    expect(lineOf(ev(1, { type: 'dispatch.started', payload: { title: 'T' } }), label).text).toBe('T: agent started')
    expect(lineOf(ev(1, { type: 'dispatch.exited', payload: { title: 'T', outcome: 'failed' } }), label).text).toBe('T: agent failed')
    expect(lineOf(ev(1, { type: 'plan.replanning', payload: { title: 'P', wave: 1 } }), label).text).toBe('P: replanning before step 2')
    expect(lineOf(ev(1, { type: 'coordinator.refreshed', payload: { title: 'P' } }), label).text).toBe('P: lead agent refreshed (on request)')
    expect(lineOf(ev(1, { type: 'watchdog', payload: { title: 'P', reason: 'no progress' } }), label).text).toBe('P: stuck-plan check: no progress')
  })
  it('a delivery that fell back says how it landed and why, in the owner\'s language, not as a stuck-plan check', () => {
    const merged = ev(1, { type: 'watchdog', payload: { title: 'P', reason: 'Plan P: Merged into main on this computer: no GitHub remote', deliveryFallback: { mode: 'merge', reason: 'notGitHub', branch: 'main' } } })
    expect(lineOf(merged, label)).toEqual({ text: 'P: merged into main on this computer. No GitHub remote, so pull requests are off', tone: 'info' })
    expect(lineOf(merged, label, 'ko').text).toBe('P: 이 컴퓨터에서 main에 병합했습니다. GitHub 원격 저장소가 없어서 풀 리퀘스트는 꺼져 있습니다')
    const review = ev(1, { type: 'watchdog', payload: { title: 'P', reason: 'Plan P: Left for your review: not a git repository', deliveryFallback: { mode: 'manual', reason: 'notGit' } } })
    expect(lineOf(review, label).text).toBe('P: This folder is not a git repository, so the work is left for you to review')
    expect(lineOf(ev(1, { type: 'watchdog', payload: { title: 'P', deliveryFallback: { mode: 'merge', reason: 'noRemote' } } }), label).text).toBe('P: merged into its branch on this computer. No remote, so pushing is off')
  })
  it('reads in es, ja and ko', () => {
    const e = ev(1, { type: 'dispatch.started', payload: { title: 'T' } })
    expect(lineOf(e, label, 'es').text).toBe('T: agente iniciado')
    expect(lineOf(e, label, 'ja').text).toContain('エージェント')
    expect(lineOf(e, label, 'ko').text).toContain('에이전트')
  })
})

describe('filterLines', () => {
  const lines = [
    { text: 'T1 delivered', plan: 'Auth rework' },
    { text: 'T2 failed', plan: 'Docs', who: 'Account A' }
  ]
  it('keeps every line for a blank query', () => {
    expect(filterLines(lines, '  ')).toHaveLength(2)
  })
  it('matches text, plan and actor, ignoring case', () => {
    expect(filterLines(lines, 'DELIVERED')).toEqual([lines[0]])
    expect(filterLines(lines, 'docs')).toEqual([lines[1]])
    expect(filterLines(lines, 'account a')).toEqual([lines[1]])
    expect(filterLines(lines, 'nope')).toEqual([])
  })
})
