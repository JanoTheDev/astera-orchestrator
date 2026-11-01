import { describe, it, expect } from 'vitest'
import { afterAttempt, beginAttempt, deliveryBranchOf, deliveryDue, deliveryOf, parseDelivery, setJobDelivery, setJobDeliveryBranch, setProjectDelivery } from './delivery'
import { emptyState, type OrchState } from './state'
import type { DeliveryProgress, Job } from './types'

const NOW = '2026-10-23T00:00:00.000Z'
const state = (): OrchState => ({
  ...emptyState(),
  projects: [{ id: 'p1', path: '/repo', name: 'r', addedAt: NOW }],
  jobs: [{ id: 'job_1', objective: 'o', cwd: '/repo', projectId: 'p1', createdAt: NOW }]
})
const job = (s: OrchState): Job => s.jobs[0]

describe('manual delivery', () => {
  it('parseDelivery accepts manual', () => {
    expect(parseDelivery('manual')).toBe('manual')
    expect(parseDelivery('nope')).toBeNull()
  })

  it("deliveryOf reads a project's manual, and a Job's own setting wins", () => {
    let s = state()
    expect(deliveryOf(s, job(s))).toBe('pr')
    const p = setProjectDelivery(s, 'p1', { delivery: 'manual' })
    if (!p.ok) throw new Error(p.error)
    s = p.state
    expect(deliveryOf(s, job(s))).toBe('manual')
    const j = setJobDelivery(s, 'job_1', 'push')
    if (!j.ok) throw new Error(j.error)
    expect(deliveryOf(j.state, job(j.state))).toBe('push')
    const m = setJobDelivery(state(), 'job_1', 'manual')
    if (!m.ok) throw new Error(m.error)
    expect(deliveryOf(m.state, job(m.state))).toBe('manual')
  })
})

describe("a plan's target branch", () => {
  it("deliveryBranchOf reads the plan's own branch over its project's, and neither reads undefined", () => {
    let s = state()
    expect(deliveryBranchOf(s, job(s))).toBeUndefined()
    const p = setProjectDelivery(s, 'p1', { branch: 'develop' })
    if (!p.ok) throw new Error(p.error)
    s = p.state
    expect(deliveryBranchOf(s, job(s))).toBe('develop')
    const j = setJobDeliveryBranch(s, 'job_1', ' release/2 ')
    if (!j.ok) throw new Error(j.error)
    expect(job(j.state).deliveryBranch).toBe('release/2')
    expect(deliveryBranchOf(j.state, job(j.state))).toBe('release/2')
    const cleared = setJobDeliveryBranch(j.state, 'job_1', null)
    if (!cleared.ok) throw new Error(cleared.error)
    expect('deliveryBranch' in job(cleared.state)).toBe(false)
    expect(deliveryBranchOf(cleared.state, job(cleared.state))).toBe('develop')
  })

  it('refuses a value that cannot name a branch, and an unknown plan', () => {
    for (const bad of ['', '  ', 'a b', '-x']) expect(setJobDeliveryBranch(state(), 'job_1', bad).ok).toBe(false)
    expect(setJobDeliveryBranch(state(), 'job_9', 'main').ok).toBe(false)
  })
})

describe('a delivery retried when the plan branch moves', () => {
  const at = '2026-10-23T00:00:00.000Z'
  const nowMs = Date.parse(at)
  const failed = (over: Partial<DeliveryProgress> = {}): DeliveryProgress => ({
    ...afterAttempt(undefined, at, 'push refused', { heads: { head: 'h1', origin: 'o1' } }),
    ...over
  })

  it('afterAttempt records the heads of a failure only', () => {
    expect(failed()).toMatchObject({ state: 'retrying', headAtAttempt: 'h1', originAtAttempt: 'o1' })
    expect(afterAttempt(undefined, at, undefined, { heads: { head: 'h1' } })).not.toHaveProperty('headAtAttempt')
  })

  it('is due at once when the head or origin moved, whatever the backoff', () => {
    const p = failed()
    expect(deliveryDue(p, nowMs)).toBe(false)
    expect(deliveryDue(p, nowMs, { head: 'h1', origin: 'o1' })).toBe(false)
    expect(deliveryDue(p, nowMs, { head: 'h2', origin: 'o1' })).toBe(true)
    expect(deliveryDue(p, nowMs, { head: 'h1', origin: 'o2' })).toBe(true)
    expect(deliveryDue({ ...p, state: 'needs-owner' }, nowMs, { head: 'h2' })).toBe(true)
  })

  it('an unknown head on either side is no move, and a dismissed or owner-pushed delivery never retries', () => {
    expect(deliveryDue(failed({ headAtAttempt: undefined }), nowMs, { head: 'h2' })).toBe(false)
    expect(deliveryDue(failed(), nowMs, {})).toBe(false)
    expect(deliveryDue({ ...failed(), state: 'dismissed' }, nowMs, { head: 'h2' })).toBe(false)
    expect(deliveryDue({ ...failed(), state: 'needs-owner', ownerPushes: true }, nowMs, { head: 'h2' })).toBe(false)
  })

  it('beginAttempt moves the error to previousError, clears the stored ones, and restarts the count on a moved head', () => {
    const base = state()
    const run = { id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: at, delivery: { at, error: 'push refused' }, deliveryState: failed({ attempts: 4 }) }
    const s = { ...base, runs: [run] }
    const same = beginAttempt(s, 'run_1', { head: 'h1' }, at).runs[0]
    expect(same.deliveryState).toMatchObject({ state: 'delivering', attempts: 4, previousError: 'push refused' })
    expect(same.deliveryState).not.toHaveProperty('lastError')
    expect(same.delivery?.error).toBeUndefined()
    expect(beginAttempt(s, 'run_1', { head: 'h2' }, at).runs[0].deliveryState).toMatchObject({ attempts: 0, headAtAttempt: 'h2' })
  })
})
