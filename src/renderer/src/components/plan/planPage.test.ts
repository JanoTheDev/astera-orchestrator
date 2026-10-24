import { describe, expect, it } from 'vitest'
import type { JobRow, JobTask } from '../../../../core/types'
import { planSectionOf, wavesOf } from './planBoard'
import { planAccountsKey, planCheckPluginsKey, planRunConfigsKey } from './planReadKeys'
import { approveViewOf, canManualStartOf, deliveryActionsOf, headCountsOf, planAnchorId, planAnchorOf, waveStatusOf } from './planPage'

const task = (id: string, status: JobTask['status']): JobTask => ({ id, title: id, status }) as unknown as JobTask
const tasks = [task('a', 'completed'), task('b', 'dispatched'), task('c', 'ready'), task('d', 'pending')]
const waves = wavesOf(tasks, [['a', 'b', 'c'], ['d']])

describe('waveStatusOf', () => {
  it('is null without Tasks', () => {
    expect(waveStatusOf(undefined, [])).toBeNull()
  })
  it('counts the open Tasks of the current wave', () => {
    expect(waveStatusOf(undefined, waves)).toEqual({ at: 1, of: 2, next: { kind: 'opens', n: 2, left: 2 } })
  })
  it("prefers the row's wave and says a replan instead", () => {
    expect(waveStatusOf({ wave: { at: 2, of: 3 } }, waves)).toEqual({ at: 2, of: 3, next: { kind: 'opens', n: 3, left: 1 } })
    expect(waveStatusOf({ replanWave: 1 }, waves)?.next).toEqual({ kind: 'replan', n: 2 })
  })
  it('says the last wave and all done', () => {
    expect(waveStatusOf({ wave: { at: 2, of: 2 } }, waves)?.next).toEqual({ kind: 'last', left: 1 })
    const done = wavesOf([task('a', 'completed')], [['a']])
    expect(waveStatusOf(undefined, done)?.next).toEqual({ kind: 'done' })
  })
  it('has no next line while the layers are missing', () => {
    expect(waveStatusOf({ wave: { at: 1, of: 2 } }, [])).toEqual({ at: 1, of: 2, next: null })
  })
})

describe('head counts and manual start', () => {
  it('lists non-zero counts in head order', () => {
    expect(headCountsOf(tasks)).toEqual([['completed', 1], ['ready', 1], ['pending', 1]])
  })
  it('starts by hand only on a started one-worker plan that is no template', () => {
    const row = (o: Partial<JobRow>): JobRow => ({ id: 'j', tasks: [], ...o }) as unknown as JobRow
    expect(canManualStartOf(undefined)).toBe(false)
    expect(canManualStartOf(row({ concurrency: 1 }))).toBe(true)
    expect(canManualStartOf(row({}))).toBe(false)
    expect(canManualStartOf(row({ concurrency: 1, pendingStart: true }))).toBe(false)
  })
})

describe('deliveryActionsOf', () => {
  const of = (state: NonNullable<JobRow['delivery']>['state'] | undefined) =>
    deliveryActionsOf({ delivery: state ? { runId: 'r', state } : undefined } as unknown as JobRow)
  it('offers retry, already-pushed and dismiss on a failed delivery', () => {
    expect(of('failed')).toEqual({ retry: true, alreadyPushed: true, dismiss: true })
  })
  it('lets the owner settle a delivery that waits on them, but not dismiss it', () => {
    expect(of('needs-owner')).toEqual({ retry: true, alreadyPushed: true, dismiss: false })
  })
  it('only retries one that retries by itself or runs now; nothing for pending or no delivery', () => {
    expect(of('retrying')).toEqual({ retry: true, alreadyPushed: false, dismiss: false })
    expect(of('delivering')).toEqual({ retry: true, alreadyPushed: false, dismiss: false })
    expect(of('pending')).toEqual({ retry: false, alreadyPushed: false, dismiss: false })
    expect(of(undefined)).toEqual({ retry: false, alreadyPushed: false, dismiss: false })
  })
})

describe('plan tab anchors (T8)', () => {
  it('resolves #task-<id> and #settings, as openPlan carries them', () => {
    expect(planAnchorOf(planSectionOf('#task-tsk_1'))).toEqual({ kind: 'task', taskId: 'tsk_1' })
    expect(planAnchorOf(planSectionOf('task-tsk_1'))).toEqual({ kind: 'task', taskId: 'tsk_1' })
    expect(planAnchorOf(planSectionOf('#settings'))).toEqual({ kind: 'settings' })
    expect(planAnchorId({ kind: 'task', taskId: 'tsk_1' })).toBe('plan-task-tsk_1')
    expect(planAnchorId({ kind: 'settings' })).toBe('plan-settings')
  })
  it('maps the old sections onto the document, the overview to the top', () => {
    expect(planAnchorOf('waves')).toEqual({ kind: 'steps' })
    expect(planAnchorOf('journal')).toEqual({ kind: 'activity' })
    expect(planAnchorOf('overview')).toBeNull()
    expect(planAnchorOf(planSectionOf('task-'))).toBeNull()
  })
})

describe('approveViewOf', () => {
  const plan = (o: Partial<JobRow>): JobRow => ({ id: 'j', tasks: [{}, {}], pendingStart: true, planned: true, ...o }) as unknown as JobRow
  it('shows an enabled Approve for a ready plan with Tasks', () => {
    expect(approveViewOf(plan({ planReady: true }))).toEqual({ show: true, ready: true, problems: [] })
  })
  it('keeps Approve visible but disabled, with the problems, when a plan with Tasks does not hold', () => {
    expect(approveViewOf(plan({ planProblems: ['T1 has no files'] }))).toEqual({ show: true, ready: false, problems: ['T1 has no files'] })
    expect(approveViewOf(plan({ planReady: true, planProblems: ['cycle'] }))).toMatchObject({ show: true, ready: false, problems: ['cycle'] })
  })
  it('shows a disabled Approve for a waiting plan with Tasks that is not marked ready, or starts by itself', () => {
    expect(approveViewOf(plan({}))).toEqual({ show: true, ready: false, problems: [] })
    expect(approveViewOf(plan({ autoApprove: true }))).toMatchObject({ show: true, ready: false })
  })
  it('a plan with no Tasks or not waiting shows no button', () => {
    expect(approveViewOf(plan({ tasks: [], planProblems: ['no tasks'] })).show).toBe(false)
    expect(approveViewOf(plan({ pendingStart: false, planProblems: ['x'] })).show).toBe(false)
    expect(approveViewOf(plan({ archivedAt: 'x', planProblems: ['x'] })).show).toBe(false)
  })
})

describe('plan read cache keys', () => {
  const local = { projectKey: '/p' }
  const remote = { runtimeId: 'rt-1', projectKey: '/p' }
  it('a Runtime door and this computer never share a key', () => {
    expect(planAccountsKey(local)).not.toBe(planAccountsKey(remote))
    expect(planRunConfigsKey(local, 'r1')).not.toBe(planRunConfigsKey(remote, 'r1'))
    expect(planCheckPluginsKey(local)).not.toBe(planCheckPluginsKey(remote))
  })
  it('run configs are kept per run', () => {
    expect(planRunConfigsKey(local, 'r1')).not.toBe(planRunConfigsKey(local, 'r2'))
  })
})
