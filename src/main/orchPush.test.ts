import { describe, it, expect } from 'vitest'
import { createOrchPush } from './orchPush'
import { emptyState, type OrchState } from '../core/orchestration/state'
import type { OrchSnapshot } from '../core/types'

// Performance audit M1: every orchestration commit pushed the Jobs sidebar, folding and serializing the snapshot
// (and the last one sent, again) each time. A burst of commits in one tick folds once, for the newest state, and the
// last sent snapshot's string is kept rather than made again for every compare.
const rig = () => {
  const queue: (() => void)[] = []
  const folds: { state: OrchState; project: string }[] = []
  const sent: OrchSnapshot[] = []
  const logs: string[] = []
  let throwOnFold = false
  const snap = (state: OrchState): OrchSnapshot => ({ runs: [], projectFolderBusy: state.jobs.length > 0 })
  const p = createOrchPush({
    fold: (state, project) => {
      folds.push({ state, project })
      if (throwOnFold) throw new Error('bad state')
      return snap(state)
    },
    send: (s) => sent.push(s),
    log: (l) => logs.push(l),
    schedule: (fn) => void queue.push(fn)
  })
  const flush = (): void => {
    while (queue.length > 0) queue.shift()!()
  }
  const busy = (): OrchState => ({ ...emptyState(), jobs: [{} as never] })
  return { p, folds, sent, logs, flush, snap, busy, throwing: (v: boolean) => (throwOnFold = v) }
}

describe('createOrchPush', () => {
  it('folds once for a burst of commits, with the newest state', () => {
    const r = rig()
    r.p.watch('P', r.p.stamp('P', r.snap(emptyState())))
    const a = emptyState()
    const b = r.busy()
    r.p.push(a)
    r.p.push(emptyState())
    r.p.push(b)
    expect(r.folds).toHaveLength(0)
    r.flush()
    expect(r.folds).toEqual([{ state: b, project: 'P' }])
    expect(r.sent).toEqual([{ ...r.snap(b), project: 'P', version: 2 }])
  })

  it('does not send a fold the renderer already holds', () => {
    const r = rig()
    r.p.watch('P', r.p.stamp('P', r.snap(emptyState())))
    r.p.push(emptyState())
    r.flush()
    expect(r.sent).toHaveLength(0)
    r.p.push(r.busy())
    r.flush()
    r.p.push(r.busy())
    r.flush()
    expect(r.sent).toHaveLength(1)
  })

  it('folds nothing while nobody watches, and remembers the last state for a later re-push', () => {
    const r = rig()
    const s = r.busy()
    r.p.push(s)
    r.flush()
    expect(r.folds).toHaveLength(0)
    expect(r.p.lastPushed()).toBe(s)
    r.p.watch('P', r.p.stamp('P', r.snap(emptyState())))
    r.p.unwatch()
    r.p.push(s)
    r.flush()
    expect(r.folds).toHaveLength(0)
    expect(r.p.project()).toBeNull()
  })

  it('a push queued before an unwatch sends nothing', () => {
    const r = rig()
    r.p.watch('P', r.p.stamp('P', r.snap(emptyState())))
    r.p.push(r.busy())
    r.p.unwatch()
    r.flush()
    expect(r.sent).toHaveLength(0)
  })

  it('logs a fold that throws, and the next commit still pushes', () => {
    const r = rig()
    r.p.watch('P', r.p.stamp('P', r.snap(emptyState())))
    r.throwing(true)
    r.p.push(r.busy())
    r.flush()
    expect(r.logs.join('\n')).toContain('bad state')
    r.throwing(false)
    r.p.push(r.busy())
    r.flush()
    expect(r.sent).toHaveLength(1)
  })

  it('stamps the project and a version that moves only with the content', () => {
    const r = rig()
    const held = r.p.stamp('/p', r.snap(emptyState()))
    expect(held).toMatchObject({ project: '/p', version: 1 })
    expect(r.p.stamp('/p', r.snap(emptyState())).version).toBe(1)
    r.p.watch('P', held)
    r.p.push(emptyState())
    r.flush()
    r.p.push(emptyState())
    r.flush()
    expect(r.sent).toHaveLength(0)
    r.p.push(r.busy())
    r.flush()
    r.p.push(r.busy())
    r.flush()
    // folded for the repository path, tagged with the path the renderer sent
    expect(r.folds.at(-1)?.project).toBe('P')
    expect(r.sent).toEqual([{ ...r.snap(r.busy()), project: '/p', version: 2 }])
  })

  it('gives another project a version of its own', () => {
    const r = rig()
    const a = r.p.stamp('/a', r.snap(emptyState()))
    const b = r.p.stamp('/b', r.snap(emptyState()))
    expect(b.version).not.toBe(a.version)
  })
})
