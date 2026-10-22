// T2: a push plan's delivery waits while a higher-ranked plan it meets is landing (deliveryWait.ts), and tells the
// owner once after 30 minutes.
import { describe, it, expect } from 'vitest'
import { createJob, createTask, emptyState, startJobRun, type OrchState } from '../state'
import type { Job, TaskStatus } from '../types'
import { DELIVERY_WAIT_ESCALATE_MS, deliveryWaitFor, deliveryWaitStep } from './deliveryWait'

const T0 = '2026-10-22T10:00:00.000Z'
const later = (ms: number): string => new Date(Date.parse(T0) + ms).toISOString()

const ok = <T>(r: { ok: boolean } & Record<string, unknown>): { state: OrchState; value: T } => {
  if (!r.ok) throw new Error(String(r.error))
  return { state: r.state as OrchState, value: r.value as T }
}

/** A push plan in /repo with one Run of one Task in `status`; `at` orders the plans (the older one outranks). */
function plan(s: OrchState, name: string, at: string, status: TaskStatus, o: { cwd?: string; priority?: number } = {}) {
  const j = ok<Job>(createJob(s, { objective: name, cwd: o.cwd ?? '/repo' }, at) as never)
  const r = ok<{ id: string }>(startJobRun(j.state, j.value.id, at) as never)
  const t = ok<{ id: string }>(createTask(r.state, { runId: r.value.id, title: name, spec: 's', deps: [] }, at) as never)
  const state: OrchState = {
    ...t.state,
    jobs: t.state.jobs.map((x) => (x.id === j.value.id ? { ...x, delivery: 'push', ...(o.priority !== undefined ? { priority: o.priority } : {}) } : x)),
    tasks: t.state.tasks.map((x) => (x.id === t.value.id ? { ...x, status } : x))
  }
  return { state, jobId: j.value.id, runId: r.value.id, taskId: t.value.id }
}

/** B meets A: an overlap entry on B naming A. */
const meets = (s: OrchState, b: string, a: string): OrchState => ({
  ...s,
  jobs: s.jobs.map((j) => (j.id === b ? { ...j, overlaps: [{ taskId: 't', jobId: a, otherTaskId: 'u', by: 'path' as const, path: 'src/x.ts' }] } : j))
})

/** A (older, so it outranks) is done and landing; B is done and meets it. */
function pair(o: { overlap?: boolean; aStatus?: TaskStatus; bFirst?: boolean } = {}) {
  const first = o.bFirst ? 'B' : 'A'
  const x = plan(emptyState(), first, T0, first === 'A' ? (o.aStatus ?? 'completed') : 'completed')
  const y = plan(x.state, first === 'A' ? 'B' : 'A', later(1000), first === 'A' ? 'completed' : (o.aStatus ?? 'completed'))
  const [a, b] = first === 'A' ? [x, y] : [y, x]
  const state = o.overlap === false ? y.state : meets(y.state, b.jobId, a.jobId)
  return { state, a, b }
}

const jobB = (s: OrchState, id: string): Job => s.jobs.find((j) => j.id === id)!
const deliveredA = (s: OrchState, runId: string): OrchState => ({
  ...s,
  runs: s.runs.map((r) => (r.id === runId ? { ...r, delivery: { at: later(2000), branch: 'main', sha: 'abc' } } : r))
})

describe('T2 deliveryWaitFor', () => {
  it('B waits for a higher-ranked plan it meets that is landing, and records waitingFor on its Run', () => {
    const { state, a, b } = pair()
    expect(deliveryWaitFor(state, jobB(state, b.jobId))?.id).toBe(a.jobId)
    const w = deliveryWaitStep(state, b.runId, later(5000))
    expect(w.waitingFor?.id).toBe(a.jobId)
    expect(w.state.runs.find((r) => r.id === b.runId)?.deliveryState?.waitingFor).toEqual({ jobId: a.jobId, since: later(5000) })
  })

  it('once A delivered or stopped, B waits no more and its waitingFor is cleared', () => {
    const { state, a, b } = pair()
    const waiting = deliveryWaitStep(state, b.runId, later(5000)).state
    const landed = deliveryWaitStep(deliveredA(waiting, a.runId), b.runId, later(6000))
    expect(landed.waitingFor).toBeNull()
    expect(landed.state.runs.find((r) => r.id === b.runId)?.deliveryState?.waitingFor).toBeUndefined()
    const archived = { ...waiting, jobs: waiting.jobs.map((j) => (j.id === a.jobId ? { ...j, archivedAt: later(6000) } : j)) }
    expect(deliveryWaitStep(archived, b.runId, later(6000)).waitingFor).toBeNull()
  })

  it('a plan that does not meet B, does not outrank it, is still working, or delivers by PR does not make B wait', () => {
    const apart = pair({ overlap: false })
    expect(deliveryWaitFor(apart.state, jobB(apart.state, apart.b.jobId))).toBeNull()
    // B is the older plan here: A meets it but goes after it
    const lower = pair({ bFirst: true })
    expect(deliveryWaitFor(lower.state, jobB(lower.state, lower.b.jobId))).toBeNull()
    const working = pair({ aStatus: 'dispatched' })
    expect(deliveryWaitFor(working.state, jobB(working.state, working.b.jobId))).toBeNull()
    const { state, a, b } = pair()
    const pr = { ...state, jobs: state.jobs.map((j) => (j.id === a.jobId ? { ...j, delivery: 'pr' as const } : j)) }
    expect(deliveryWaitFor(pr, jobB(pr, b.jobId))).toBeNull()
    // Another repository never holds B back
    const other = plan(emptyState(), 'A', T0, 'completed', { cwd: '/elsewhere' })
    const bb = plan(other.state, 'B', later(1000), 'completed')
    const s2 = meets(bb.state, bb.jobId, other.jobId)
    expect(deliveryWaitFor(s2, jobB(s2, bb.jobId))).toBeNull()
  })

  it('a higher priority outranks an older plan', () => {
    const { state, a, b } = pair({ bFirst: true })
    const up = { ...state, jobs: state.jobs.map((j) => (j.id === a.jobId ? { ...j, priority: 5 } : j)) }
    expect(deliveryWaitFor(up, jobB(up, b.jobId))?.id).toBe(a.jobId)
  })

  it('after 30 minutes of waiting the owner is told once, and B keeps waiting', () => {
    const { state, b } = pair()
    let s = deliveryWaitStep(state, b.runId, T0).state
    const before = s.messages.length
    s = deliveryWaitStep(s, b.runId, later(DELIVERY_WAIT_ESCALATE_MS - 1)).state
    expect(s.messages).toHaveLength(before)
    const due = deliveryWaitStep(s, b.runId, later(DELIVERY_WAIT_ESCALATE_MS))
    expect(due.waitingFor).not.toBeNull()
    expect(due.state.messages).toHaveLength(before + 1)
    expect(due.state.messages.at(-1)).toMatchObject({ runId: b.runId, type: 'escalation', answered: false })
    expect(due.state.runs.find((r) => r.id === b.runId)?.deliveryState?.waitingFor?.escalated).toBe(later(DELIVERY_WAIT_ESCALATE_MS))
    const again = deliveryWaitStep(due.state, b.runId, later(3 * DELIVERY_WAIT_ESCALATE_MS))
    expect(again.state.messages).toHaveLength(before + 1)
    expect(again.waitingFor).not.toBeNull()
  })

  it('an unchanged wait leaves the state as it is', () => {
    const { state, b } = pair()
    const s = deliveryWaitStep(state, b.runId, T0).state
    expect(deliveryWaitStep(s, b.runId, later(1000)).state).toBe(s)
  })
})
