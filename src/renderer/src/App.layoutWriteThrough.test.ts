import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// App.tsx is a component that cannot run without a full React + Electron harness, so its wiring is pinned by its text
// (App.spawnUnattended.test.ts does the same). The tab tree and the active pane are written only through the
// write-through setters (lib/writeThrough.ts): the burst of session:created after the 1.4.11 update lost two claude
// tabs because each placement read a ref that moved only on render. Mutation: put `layoutRef.current = layout` back,
// or call React's own setter anywhere, and this fails.
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'App.tsx'), 'utf8')
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
})
