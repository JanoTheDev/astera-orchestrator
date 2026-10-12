// The explorer's refresh closed every folder: refresh() called resetTree(), which empties the expanded set and the
// cache (2026-10-12, the user's report). FileExplorer and useFileTree are a component and a hook that cannot run
// without a React harness, so the wiring is pinned by text; the plan itself is tested in core/files/dirReload.test.ts.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const explorer = readFileSync(path.join(here, 'FileExplorer.tsx'), 'utf8')
const hook = readFileSync(path.join(here, '..', 'hooks', 'useFileTree.ts'), 'utf8')
const body = (src: string, start: string, end: string): string => {
  const i = src.indexOf(start)
  expect(i).toBeGreaterThan(-1)
  return src.slice(i, src.indexOf(end, i))
}

describe("the explorer's refresh keeps the folders the person opened", () => {
  it('refresh() refreshes the tree instead of resetting it', () => {
    const refresh = body(explorer, 'const refresh = (): void => {', 'const menuItemsFor')
    expect(refresh).toMatch(/tree\.refreshTree\(\)/)
    expect(refresh).not.toMatch(/resetTree/)
  })

  it('refreshTree plans with planRefresh and never touches the expanded set', () => {
    const refreshTree = body(hook, 'const refreshTree = (): void => {', '\n  }\n')
    expect(refreshTree).toMatch(/planRefresh\(/)
    expect(refreshTree).not.toMatch(/setExpanded/)
    expect(refreshTree).toMatch(/loadDir\(/)
  })
})
