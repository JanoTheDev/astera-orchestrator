import { describe, expect, it } from 'vitest'
import type { JobRow, JobTask } from '../../../../core/types'
import { wavesOf } from './planBoard'
import { canManualStartOf, deliveryActionsOf, headCountsOf, waveStatusOf } from './planPage'

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
