import { describe, it, expect } from 'vitest'
import { shellSource } from './shellSource'

// App.tsx is a component that cannot run without a full React + Electron harness, so its wiring is pinned by its text
// (App.spawnUnattended.test.ts does the same). The tab tree and the active pane are written only through the
// write-through setters (lib/writeThrough.ts): the burst of session:created after the 1.4.11 update lost two claude
// tabs because each placement read a ref that moved only on render. Mutation: put `layoutRef.current = layout` back,
// or call React's own setter anywhere, and this fails.
// W9-A: App's body now lives in state/* and components/shell/*; the setters are built in useLayout.ts, and the
// counts below hold across App.tsx and every file it was cut into.
const src = shellSource()
const count = (re: RegExp): number => src.match(re)?.length ?? 0

describe('App.tsx writes the tab tree and the active pane through writeThrough', () => {
  it('builds setLayout and setActivePaneId from writeThrough over their refs', () => {
    expect(src).toMatch(/const setLayout = useMemo\(\(\) => writeThrough\(layoutRef, setLayoutState\), \[\]\)/)
    expect(src).toMatch(/const setActivePaneId = useMemo\(\(\) => writeThrough\(activePaneIdRef, setActivePaneIdState\), \[\]\)/)
  })

  it("calls React's own setters nowhere else", () => {
    expect(count(/setLayoutState\b/g)).toBe(2) // the useState pair and the writeThrough line
    expect(count(/setActivePaneIdState\b/g)).toBe(2)
  })

  it('moves the refs nowhere by hand, at render least of all', () => {
    expect(count(/layoutRef\.current\s*=[^=]/g)).toBe(0)
    expect(count(/activePaneIdRef\.current\s*=[^=]/g)).toBe(0)
  })

  // Final review minor 1: the session rows had the same render-only mirror. Closing a tab during a burst wrote a list
  // made from the old rows over the ones the burst had just added (a tab with no row is not drawn), and an exit and a
  // re-adoption in one batch left a live session 'exited'.
  it('writes the session rows through writeThrough as well', () => {
    expect(src).toMatch(/const setSessions = useMemo\(\(\) => writeThrough\(sessionsRef, setSessionsState\), \[\]\)/)
    expect(count(/setSessionsState\b/g)).toBe(2)
    expect(count(/sessionsRef\.current\s*=[^=]/g)).toBe(0)
  })

  // Final review minor 2: the tab menu's Split computed from the rendered tree, so a tab placed in the background since
  // that render (a session taken back, an agent's tab) was dropped by the split.
  it("splits from the tree as written, not the menu's rendered copy", () => {
    const start = src.indexOf('const split = (dir: PaneDir): void => {')
    expect(start).toBeGreaterThan(-1)
    expect(src.indexOf('const split = (dir: PaneDir): void => {', start + 1)).toBe(-1)
    const body = src.slice(start, src.indexOf('setActivePaneId(res.paneId)', start))
    expect(body).toMatch(/layoutRef\.current/)
    expect(body).not.toMatch(/splitAndMove\(cur\b/)
  })
})
