// The tab tree is React state with a mirror ref that handlers read to compute the next tree. The ref moved only on
// render, so a burst of session:created (the Host's sessions taken back after an update, or after a reconnect) placed
// every tab on the same old tree and the last one overwrote the rest: two claude tabs vanished while their processes
// kept running (2026-10-12, 1.4.11). writeThrough moves the ref with every write.
import { describe, it, expect } from 'vitest'
import { writeThrough } from './writeThrough'
import { placeTab } from '../../../core/panes/place'
import { leaves, removeTab, replaceTabId, type PaneNode } from '../../../core/panes/tree'
import { sessionTab } from '../../../core/panes/tabId'

/** A setter whose commits React has not rendered yet: the ref is the only thing that moves. */
const rig = (initial: PaneNode | null = null) => {
  const ref = { current: initial }
  const commits: Array<PaneNode | null> = []
  const set = writeThrough(ref, (v) => commits.push(v))
  const tabs = (): string[] => (ref.current ? leaves(ref.current).flatMap((l) => l.tabIds) : [])
  const lastCommitTabs = (): string[] => {
    const last = commits.at(-1) ?? null
    return last ? leaves(last).flatMap((l) => l.tabIds) : []
  }
  return { ref, set, tabs, lastCommitTabs, commits }
}

const placeBackground = (cur: PaneNode | null, id: string): PaneNode =>
  placeTab(cur, sessionTab(id), { activePaneId: null, background: true }).root

describe('writeThrough', () => {
  it('keeps every tab of a burst placed before a render', () => {
    const h = rig()
    for (const id of ['a', 'b', 'c', 'd']) h.set(placeBackground(h.ref.current, id))
    expect(h.tabs()).toEqual(['a', 'b', 'c', 'd'].map(sessionTab))
    // What React renders is the last commit, and it holds them all.
    expect(h.lastCommitTabs()).toEqual(['a', 'b', 'c', 'd'].map(sessionTab))
  })

  it('runs an updater once, on the latest write', () => {
    const h = rig()
    h.set(placeBackground(h.ref.current, 'old'))
    let calls = 0
    h.set((cur) => {
      calls++
      return cur ? replaceTabId(cur, sessionTab('old'), sessionTab('new')) : cur
    })
    h.set(placeBackground(h.ref.current, 'other'))
    expect(calls).toBe(1)
    expect(h.tabs()).toEqual([sessionTab('new'), sessionTab('other')])
  })

  it('keeps a tab closed when a background tab is placed before the render', () => {
    const h = rig()
    h.set(placeBackground(h.ref.current, 'a'))
    h.set(placeBackground(h.ref.current, 'b'))
    h.set(removeTab(h.ref.current as PaneNode, sessionTab('a')))
    h.set(placeBackground(h.ref.current, 'c'))
    expect(h.tabs()).toEqual([sessionTab('b'), sessionTab('c')])
  })

  // closeSession's shape (final review minor 1): rows added by updaters, then a list made from the ref and written as a
  // value. The value has to carry the rows the updaters added, or the new session's tab is not drawn.
  it('keeps what updaters added when a value is then made from the ref', () => {
    const ref = { current: ['a'] }
    const commits: string[][] = []
    const set = writeThrough(ref, (v) => commits.push(v))
    set((prev) => [...prev, 'b'])
    set((prev) => [...prev, 'c'])
    set(ref.current.filter((id) => id !== 'a'))
    expect(ref.current).toEqual(['b', 'c'])
    expect(commits.at(-1)).toEqual(['b', 'c'])
  })

  it('hands React the same value it keeps, null included', () => {
    const h = rig(placeBackground(null, 'a'))
    h.set(placeBackground(h.ref.current, 'b'))
    expect(h.commits.at(-1)).toBe(h.ref.current)
    h.set(null)
    expect(h.ref.current).toBeNull()
    expect(h.commits.at(-1)).toBeNull()
    expect(h.commits).toHaveLength(2)
  })
})
