import { describe, expect, it, vi } from 'vitest'
import { createReadCache } from '../lib/readCache'
import { orchSnapshotFor, readThrough, startOrchFeed, type OrchFeedDeps } from './orchFeed'
import type { OrchSnapshot } from '../../../core/types'

const snap = (project: string, version: number, title = 'job'): OrchSnapshot =>
  ({ runs: [{ id: `r-${title}` }], projectFolderBusy: false, project, version }) as unknown as OrchSnapshot

function harness(project: string, cache = createReadCache()) {
  const frames: (() => void)[] = []
  let resolveList!: (s: OrchSnapshot) => void
  let push!: (s: OrchSnapshot) => void
  const shown: OrchSnapshot[] = []
  const deps: OrchFeedDeps = {
    project,
    cache,
    list: () => new Promise((r) => (resolveList = r)),
    onState: (cb) => {
      push = cb
      return () => (push = () => {})
    },
    unwatch: vi.fn(),
    show: (s) => shown.push(s),
    schedule: (run) => {
      frames.push(run)
      return () => frames.splice(frames.indexOf(run), 1)
    }
  }
  const flush = (): void => {
    for (const run of frames.splice(0)) run()
  }
  const stop = startOrchFeed(deps)
  return { cache, deps, shown, flush, stop, list: (s: OrchSnapshot) => resolveList(s), push: (s: OrchSnapshot) => push(s) }
}

describe('orchSnapshotFor', () => {
  it('is null for a project never read and an empty snapshot for no project', () => {
    const cache = createReadCache()
    expect(orchSnapshotFor(cache, 'A')).toBeNull()
    expect(orchSnapshotFor(cache, null)).toEqual({ runs: [], projectFolderBusy: false })
  })
})

describe('startOrchFeed', () => {
  it('shows a project switched away from and back to from its cache at once, then the list answer replaces it', async () => {
    const a = harness('A')
    a.list(snap('A', 1))
    await Promise.resolve()
    a.flush()
    a.stop()
    const b = harness('B', a.cache)
    b.stop()

    const cached = orchSnapshotFor(a.cache, 'A')
    expect(cached).toEqual(snap('A', 1))

    const back = harness('A', a.cache)
    back.list(snap('A', 2, 'newer'))
    await Promise.resolve()
    back.flush()
    expect(back.shown).toEqual([snap('A', 2, 'newer')])
    expect(orchSnapshotFor(a.cache, 'A')).toBe(back.shown[0])
  })

  it('applies 30 pushes in one frame once, with the newest', () => {
    const h = harness('A')
    for (let i = 1; i <= 30; i++) h.push(snap('A', i, `v${i}`))
    expect(h.shown).toEqual([])
    h.flush()
    expect(h.shown).toEqual([snap('A', 30, 'v30')])
  })

  it('a push for project A after switching to B does not change what B shows', () => {
    const a = harness('A')
    a.push(snap('A', 1))
    a.stop() // the switch: the pending frame for A is dropped and its watch let go
    expect(a.deps.unwatch).toHaveBeenCalledOnce()
    const b = harness('B', a.cache)
    b.push(snap('B', 1))
    b.flush()
    b.push(snap('A', 2))
    b.flush()
    a.flush()
    expect(a.shown).toEqual([])
    expect(b.shown).toEqual([snap('B', 1)])
    expect(orchSnapshotFor(b.cache, 'B')).toEqual(snap('B', 1))
  })

  it('keeps the held object for a push of the same version', () => {
    const h = harness('A')
    h.push(snap('A', 1))
    h.flush()
    const held = orchSnapshotFor(h.cache, 'A')
    h.push(snap('A', 1))
    h.flush()
    expect(h.shown).toHaveLength(1)
    expect(orchSnapshotFor(h.cache, 'A')).toBe(held)
  })

  it('drops the list answer when it lands after the stop', async () => {
    const h = harness('A')
    h.stop()
    h.list(snap('A', 1))
    await Promise.resolve()
    h.flush()
    expect(h.shown).toEqual([])
  })
})

describe('readThrough', () => {
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

  it('shows each project its own cached run.list at once, then the answer; a failure clears only that project', async () => {
    const cache = createReadCache()
    const shown: [unknown, boolean][] = []
    const show = (v: unknown, fresh: boolean): number => shown.push([v, fresh])

    readThrough(cache, 'run:A', () => Promise.resolve({ configs: ['a'] }), show)
    readThrough(cache, 'run:B', () => Promise.resolve({ configs: ['b'] }), show)
    await tick()
    expect(shown).toEqual([[{ configs: ['a'] }, true], [{ configs: ['b'] }, true]])

    shown.length = 0
    readThrough(cache, 'run:B', () => Promise.reject(new Error('gone')), show)
    expect(shown).toEqual([[{ configs: ['b'] }, false]])
    await tick()
    expect(shown).toEqual([[{ configs: ['b'] }, false], [null, true]])

    shown.length = 0
    readThrough(cache, 'run:A', () => new Promise(() => {}), show)
    expect(shown).toEqual([[{ configs: ['a'] }, false]])
    expect(cache.get('run:B').data).toBeNull()
  })

  it('stores an answer that lands after the cancel without showing it', async () => {
    const cache = createReadCache()
    const show = vi.fn()
    readThrough(cache, 'understanding:A', () => Promise.resolve({ features: 1 }), show)()
    await tick()
    expect(show).not.toHaveBeenCalled()
    expect(cache.get('understanding:A').data).toEqual({ features: 1 })
  })
})
