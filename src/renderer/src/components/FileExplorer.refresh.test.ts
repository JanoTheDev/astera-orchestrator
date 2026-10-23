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
const styles = readFileSync(path.join(here, 'fileExplorer.css'), 'utf8')
const body = (src: string, start: string, end: string): string => {
  const i = src.indexOf(start)
  expect(i).toBeGreaterThan(-1)
  // A missing end marker would slice to the end of the file and let the checks below pass on the wrong text
  const j = src.indexOf(end, i)
  expect(j).toBeGreaterThan(i)
  return src.slice(i, j)
}

describe("the explorer's refresh keeps the folders the person opened", () => {
  it('refresh() refreshes the tree instead of resetting it', () => {
    const refresh = body(explorer, 'const refresh = (): void => {', 'const menuItemsFor')
    expect(refresh).toMatch(/tree\.refreshTree\(\)/)
    expect(refresh).not.toMatch(/resetTree/)
  })

  // Final review minor 3: with the tree kept, a refresh no longer empties it, so nothing showed it was working; the
  // icon turns while the root is being read (the loading set already waits ROW_SPINNER_DELAY_MS, so a quick one
  // does not flicker).
  it('turns the refresh icon while the root is being read', () => {
    const button = body(explorer, "icon: <Icon name=\"refresh\"", 'onClick: refresh')
    expect(button).toMatch(/<Icon name="refresh"[^>]*className=\{refreshing \? 'fx-refreshing' : undefined\}/)
    expect(explorer).toMatch(/const refreshing = root !== null && tree\.loading\.has\(root\)/)
    expect(styles).toMatch(/\.fx-refreshing\s*\{[^}]*animation:\s*cm-spin/)
  })

  it('refreshTree plans with planRefresh and never touches the expanded set', () => {
    const refreshTree = body(hook, 'const refreshTree = (): void => {', '\n  }\n')
    expect(refreshTree).toMatch(/planRefresh\(/)
    expect(refreshTree).not.toMatch(/setExpanded/)
    expect(refreshTree).toMatch(/loadDir\(/)
  })
})
