import { describe, expect, it } from 'vitest'
import { resolvePlan, resolveProject, resolveScope, resolveSession, type Directory, type DirPlan } from './resolve'

const plan = (o: Partial<DirPlan> & Pick<DirPlan, 'jobId' | 'name' | 'projectId' | 'projectName'>): DirPlan => ({
  projectPath: `/p/${o.projectId}`,
  scheduled: false,
  pendingStart: false,
  sessions: [],
  ...o
})

const dir = (over: Partial<Directory> = {}): Directory => ({
  projects: [
    { id: 'g', name: 'Gameful', path: '/p/g' },
    { id: 'v', name: 'Value List', path: '/p/v' }
  ],
  plans: [
    plan({
      jobId: 'j-trading',
      name: 'Trading',
      projectId: 'g',
      projectName: 'Gameful',
      runId: 'r1',
      sessions: [
        { sessionId: 's-coord', role: 'coordinator', label: 'Trading Coordinator' },
        { sessionId: 's-w1', role: 'worker', label: 'Trading Worker 1', taskTitle: 'API endpoints' },
        { sessionId: 's-w2', role: 'worker', label: 'Trading Worker 2', taskTitle: 'Redis cache' },
        { sessionId: 's-w3', role: 'worker', label: 'Trading Worker 3', taskTitle: 'UI polish' }
      ]
    }),
    plan({ jobId: 'j-refactor', name: 'Refactor', projectId: 'g', projectName: 'Gameful' }),
    plan({
      jobId: 'j-console',
      name: 'Console',
      projectId: 'v',
      projectName: 'Value List',
      sessions: [{ sessionId: 's-v3', role: 'worker', label: 'Console Worker 3', taskTitle: 'API client' }]
    })
  ],
  currentProjectPath: null,
  currentPlanId: null,
  ...over
})

describe('resolvePlan', () => {
  it('finds a plan by its own name and by "project plan"', () => {
    expect(resolvePlan(dir(), 'the Console plan')).toMatchObject({ ok: true, value: { jobId: 'j-console' } })
    expect(resolvePlan(dir(), 'Gameful Trading')).toMatchObject({ ok: true, value: { jobId: 'j-trading' } })
  })

  it('asks which plan when a project with several plans is named, listing exactly those', () => {
    const r = resolvePlan(dir(), 'Gameful')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.why).toBe('ambiguous')
    expect(r.candidates.map((c) => c.pin.planId).sort()).toEqual(['j-refactor', 'j-trading'])
  })

  it('takes a project with a single plan as that plan', () => {
    expect(resolvePlan(dir(), 'Value List')).toMatchObject({ ok: true, value: { jobId: 'j-console' } })
  })

  it('says not found, never the nearest plan, and offers the plans there are', () => {
    const r = resolvePlan(dir(), 'Redis rewrite')
    expect(r).toMatchObject({ ok: false, why: 'not-found', name: 'Redis rewrite' })
    if (!r.ok) expect(r.candidates).toHaveLength(3)
  })

  it('reads no name as the open plan, and with none open asks', () => {
    expect(resolvePlan(dir({ currentPlanId: 'j-refactor' }), undefined)).toMatchObject({ ok: true, value: { jobId: 'j-refactor' } })
    expect(resolvePlan(dir(), undefined)).toMatchObject({ ok: false, why: 'unnamed' })
  })

  it('takes a clicked candidate by its exact id', () => {
    expect(resolvePlan(dir(), 'Gameful', { planId: 'j-refactor' })).toMatchObject({ ok: true, value: { jobId: 'j-refactor' } })
  })
})

describe('resolveSession', () => {
  it('maps "worker three" to the one Worker 3 in the named plan', () => {
    const trading = dir().plans[0]
    expect(resolveSession(dir(), 'worker three', trading)).toMatchObject({ ok: true, value: { session: { sessionId: 's-w3' } } })
  })

  it('asks which "worker three" when two plans have one and neither is open', () => {
    const r = resolveSession(dir(), 'worker three', undefined)
    expect(r).toMatchObject({ ok: false, why: 'ambiguous' })
    if (!r.ok) expect(r.candidates.map((c) => c.pin.sessionId).sort()).toEqual(['s-v3', 's-w3'])
  })

  it('prefers the open plan among equal matches', () => {
    expect(resolveSession(dir({ currentPlanId: 'j-console' }), 'worker 3', undefined)).toMatchObject({
      ok: true,
      value: { session: { sessionId: 's-v3' } }
    })
  })

  it('finds "the API worker" by its task title, and asks when two tasks say API', () => {
    const trading = dir().plans[0]
    expect(resolveSession(dir(), 'the API worker', trading)).toMatchObject({ ok: true, value: { session: { sessionId: 's-w1' } } })
    expect(resolveSession(dir(), 'the API worker', undefined)).toMatchObject({ ok: false, why: 'ambiguous' })
  })

  it('says not found for a session nobody has', () => {
    expect(resolveSession(dir(), 'worker nine', undefined)).toMatchObject({ ok: false, why: 'not-found' })
  })
})

describe('resolveProject', () => {
  it('takes the one project the objective names, else the open one, else asks', () => {
    expect(resolveProject(dir(), undefined, 'the next Gameful refactor')).toMatchObject({ ok: true, value: { id: 'g' } })
    expect(resolveProject(dir({ currentProjectPath: '/p/v' }), undefined, 'a new parser')).toMatchObject({ ok: true, value: { id: 'v' } })
    expect(resolveProject(dir(), undefined, 'a new parser')).toMatchObject({ ok: false, why: 'unnamed' })
  })
})

describe('resolveScope', () => {
  it('is every plan with no name, all of a project for a project, one plan for a plan', () => {
    expect(resolveScope(dir(), undefined)).toMatchObject({ ok: true })
    const all = resolveScope(dir(), undefined)
    if (all.ok) expect(all.value).toHaveLength(3)
    const g = resolveScope(dir(), 'Gameful')
    if (g.ok) expect(g.value.map((p) => p.jobId).sort()).toEqual(['j-refactor', 'j-trading'])
    else throw new Error('expected the Gameful plans')
    expect(resolveScope(dir(), 'Trading')).toMatchObject({ ok: true, value: [{ jobId: 'j-trading' }] })
  })
})
