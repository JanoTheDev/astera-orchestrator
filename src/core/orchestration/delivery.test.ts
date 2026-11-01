import { describe, it, expect } from 'vitest'
import { afterAttempt, deliveryBranchOf, deliveryDue, deliveryOf, parseDelivery, setJobDelivery, setJobDeliveryBranch, setProjectDelivery } from './delivery'
import { emptyState, type OrchState } from './state'
import type { Job } from './types'

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

describe('T19: a merge-failed delivery is retried once the plan branch moves', () => {
  const AT = '2026-10-23T00:00:00.000Z'
  const now = Date.parse(AT)

  it('is due at once when the plan branch head changed, not while it stays, and its retry delivers with no owner', () => {
    const failed = afterAttempt(undefined, AT, 'git merge-tree says x does not merge cleanly', { code: 'merge-failed', head: 'h1' })
    expect(failed).toMatchObject({ state: 'retrying', lastCode: 'merge-failed', judgedOn: { branch: 'h1' } })
    expect(deliveryDue(failed, now, 'h1')).toBe(false)
    expect(deliveryDue(failed, now)).toBe(false)
    expect(deliveryDue(failed, now, 'h2')).toBe(true)
    // after every automatic attempt (needs-owner) too, and the retry that merges ends delivered
    let p = failed
    for (let i = 0; i < 4; i++) p = afterAttempt(p, AT, 'still', { code: 'merge-failed', head: 'h1' })
    expect(p.state).toBe('needs-owner')
    expect(deliveryDue(p, now, 'h2')).toBe(true)
    expect(afterAttempt(p, AT).state).toBe('delivered')
  })

  it('is due at once when the target tip moved while the plan branch stayed, not while both stay', () => {
    const failed = afterAttempt(undefined, AT, 'git merge-tree says x does not merge cleanly', { code: 'merge-failed', head: 'h1', target: 'm1' })
    expect(failed.judgedOn).toEqual({ branch: 'h1', target: 'm1' })
    expect(deliveryDue(failed, now, 'h1', 'm1')).toBe(false)
    expect(deliveryDue(failed, now, 'h1')).toBe(false)
    expect(deliveryDue(failed, now, 'h1', 'm2')).toBe(true)
    // no plan branch head recorded: the target alone is watched
    expect(deliveryDue(afterAttempt(undefined, AT, 'x', { code: 'merge-failed', target: 'm1' }), now, undefined, 'm2')).toBe(true)
  })

  it('only a merge failure keeps the head it was judged on, and an owner who pushes it is left alone', () => {
    const other = afterAttempt(undefined, AT, 'offline', { code: 'fetch-failed', head: 'h1' })
    expect(other.judgedOn).toBeUndefined()
    expect(deliveryDue(other, now, 'h2')).toBe(false)
    const mine = { ...afterAttempt(undefined, AT, 'x', { code: 'merge-failed', head: 'h1' }), ownerPushes: true as const }
    expect(deliveryDue(mine, now, 'h2')).toBe(false)
  })
})
