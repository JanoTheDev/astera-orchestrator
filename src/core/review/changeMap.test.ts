import { describe, expect, it } from 'vitest'
import { buildChangeMap, CONTENT_TOO_LARGE, importEdges, parseUnifiedDiff, symbolsOf } from './changeMap'

const diff = (...lines: string[]): string => lines.join('\n') + '\n'

const RENAME = diff(
  'diff --git a/src/a.ts b/src/b.ts',
  'similarity index 90%',
  'rename from src/a.ts',
  'rename to src/b.ts',
  'index 111..222 100644',
  '--- a/src/a.ts',
  '+++ b/src/b.ts',
  '@@ -1,3 +1,3 @@',
  ' one',
  '-old',
  '+new',
  ' three'
)

const DELETED = diff(
  'diff --git a/docs/gone.md b/docs/gone.md',
  'deleted file mode 100644',
  'index 111..000',
  '--- a/docs/gone.md',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  '-hello',
  '-world'
)

const NEW_TEXT = [
  "import { x } from './x'",
  '',
  'export function alpha() {',
  '  const a = 1',
  '  const b = 3',
  '  return a + b',
  '}',
  '',
  'export function beta() {',
  '  return 1',
  '}',
  ''
].join('\n')

const EDIT = diff(
  'diff --git a/src/m.ts b/src/m.ts',
  'index 111..222 100644',
  '--- a/src/m.ts',
  '+++ b/src/m.ts',
  "@@ -2,7 +2,7 @@ import { x } from './x'",
  ' ',
  ' export function alpha() {',
  '   const a = 1',
  '-  const b = 2',
  '+  const b = 3',
  '   return a + b',
  ' }',
  ' '
)

describe('parseUnifiedDiff', () => {
  it('reads a rename with its source, counts and hunk ranges', () => {
    const [f] = parseUnifiedDiff(RENAME)
    expect(f).toMatchObject({ path: 'src/b.ts', oldPath: 'src/a.ts', status: 'renamed', additions: 1, deletions: 1 })
    expect(f.hunks).toHaveLength(1)
    expect(f.hunks[0]).toMatchObject({ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3 })
    expect(f.hunks[0].text.startsWith('@@ -1,3 +1,3 @@')).toBe(true)
  })

  it('reads a pure rename with no hunks', () => {
    const [f] = parseUnifiedDiff(
      diff('diff --git a/x.ts b/y.ts', 'similarity index 100%', 'rename from x.ts', 'rename to y.ts')
    )
    expect(f).toMatchObject({ path: 'y.ts', oldPath: 'x.ts', status: 'renamed', hunks: [] })
  })

  it('reads a deleted file', () => {
    const [f] = parseUnifiedDiff(DELETED)
    expect(f).toMatchObject({ path: 'docs/gone.md', status: 'deleted', additions: 0, deletions: 2 })
  })

  it('numbers hunks across files and defaults a one-line range to 1', () => {
    const files = parseUnifiedDiff(
      DELETED + diff('diff --git a/q b/q', '--- a/q', '+++ b/q', '@@ -3 +3 @@', '-a', '+b')
    )
    expect(files.map((f) => f.hunks.map((h) => h.id))).toEqual([['h1'], ['h2']])
    expect(files[1].hunks[0]).toMatchObject({ oldLines: 1, newLines: 1 })
  })

  it('marks a binary file', () => {
    const [f] = parseUnifiedDiff(
      diff('diff --git a/i.png b/i.png', 'index 1..2 100644', 'Binary files a/i.png and b/i.png differ')
    )
    expect(f).toMatchObject({ path: 'i.png', status: 'modified', binary: true, hunks: [] })
  })
})

describe('symbolsOf', () => {
  it('finds a TS function edited in the middle, by its whole range', () => {
    const [f] = parseUnifiedDiff(EDIT)
    expect(symbolsOf(f, NEW_TEXT)).toEqual([
      { path: 'src/m.ts', name: 'alpha', kind: 'function', change: 'modified', side: 'new', start: 3, end: 7, hunkIds: ['h1'] }
    ])
  })

  it('finds an exported const added in a new file', () => {
    const [f] = parseUnifiedDiff(
      diff('diff --git a/k.ts b/k.ts', 'new file mode 100644', '--- /dev/null', '+++ b/k.ts', '@@ -0,0 +1,2 @@', '+export const LIMIT = 5', '+const hidden = 1')
    )
    expect(f.status).toBe('added')
    expect(symbolsOf(f, 'export const LIMIT = 5\nconst hidden = 1\n')).toEqual([
      { path: 'k.ts', name: 'LIMIT', kind: 'const', change: 'added', side: 'new', start: 1, end: 1, hunkIds: ['h1'] }
    ])
  })

  it('reports a removed declaration against the old file', () => {
    const [f] = parseUnifiedDiff(
      diff('diff --git a/r.ts b/r.ts', '--- a/r.ts', '+++ b/r.ts', '@@ -4,3 +4,0 @@', '-export function dead() {', '-  return 0', '-}')
    )
    expect(symbolsOf(f, 'const keep = 1\n')).toEqual([
      { path: 'r.ts', name: 'dead', kind: 'function', change: 'removed', side: 'old', start: 4, end: 6, hunkIds: ['h1'] }
    ])
  })

  it('attributes a class method edit to the method, not the class', () => {
    const text = ['export class Box {', '  open() {', '    return 2', '  }', '  close() {', '    return 0', '  }', '}', ''].join('\n')
    const [f] = parseUnifiedDiff(
      diff('diff --git a/b.ts b/b.ts', '--- a/b.ts', '+++ b/b.ts', '@@ -1,5 +1,5 @@ export class Box {', ' export class Box {', '   open() {', '-    return 1', '+    return 2', '   }', '   close() {')
    )
    expect(symbolsOf(f, text).map((s) => [s.name, s.kind, s.change])).toEqual([['open', 'method', 'modified']])
  })

  it('falls back to the hunk header for a non-TS file', () => {
    const [f] = parseUnifiedDiff(
      diff('diff --git a/t.py b/t.py', '--- a/t.py', '+++ b/t.py', '@@ -1,3 +1,4 @@ def run():', '     a = 1', '+    b = 2', '     return a')
    )
    expect(symbolsOf(f)).toEqual([
      { path: 't.py', name: 'def run():', kind: 'context', change: 'modified', side: 'new', start: 1, end: 4, hunkIds: ['h1'] }
    ])
  })

  it('without the new text, reads declarations off the added lines', () => {
    const [f] = parseUnifiedDiff(
      diff('diff --git a/n.ts b/n.ts', '--- a/n.ts', '+++ b/n.ts', '@@ -1,1 +1,3 @@', ' x', '+export interface Opts {', '+}')
    )
    expect(symbolsOf(f).map((s) => [s.name, s.kind, s.change, s.start, s.end])).toEqual([['Opts', 'interface', 'added', 2, 3]])
  })
})

describe('importEdges', () => {
  const files = parseUnifiedDiff(
    diff(
      'diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1,1 +1,3 @@',
      " import { c } from './c'", "+import { b } from './b'", '+import { z } from "./untouched"',
      'diff --git a/src/b.ts b/src/b.ts', '--- a/src/b.ts', '+++ b/src/b.ts', '@@ -1,1 +1,1 @@', '-1', '+2',
      'diff --git a/src/c/index.ts b/src/c/index.ts', '--- a/src/c/index.ts', '+++ b/src/c/index.ts', '@@ -1,1 +1,1 @@', '-1', '+2'
    )
  )
  const texts: Record<string, string> = {
    'src/a.ts': "import { c } from './c'\nimport { b } from './b'\nimport { z } from \"./untouched\"\n",
    'src/b.ts': '2\n',
    'src/c/index.ts': '2\n'
  }

  it('links changed files, resolving index files, and marks only added import lines new', () => {
    expect(importEdges(files, (p) => texts[p])).toEqual([
      { from: 'src/a.ts', to: 'src/c/index.ts', new: false },
      { from: 'src/a.ts', to: 'src/b.ts', new: true }
    ])
  })

  it('resolves a .js specifier to the TS file and ignores packages', () => {
    const edges = importEdges(files, (p) => (p === 'src/b.ts' ? "2\nimport './a.js'\nimport fs from 'node:fs'\nconst z = require('./c')\n" : texts[p]))
    expect(edges.filter((e) => e.from === 'src/b.ts')).toEqual([
      { from: 'src/b.ts', to: 'src/a.ts', new: false },
      { from: 'src/b.ts', to: 'src/c/index.ts', new: false }
    ])
  })

  it('does not call an edge new when the same import was only reworded', () => {
    const both = parseUnifiedDiff(
      diff('diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1,1 +1,1 @@', "-import { b } from './b'", "+import { b, b2 } from './b'",
        'diff --git a/src/b.ts b/src/b.ts', '--- a/src/b.ts', '+++ b/src/b.ts', '@@ -1 +1 @@', '-1', '+2')
    )
    expect(importEdges(both, (p) => (p === 'src/a.ts' ? "import { b, b2 } from './b'\n" : '2\n'))).toEqual([
      { from: 'src/a.ts', to: 'src/b.ts', new: false }
    ])
  })
})

describe('buildChangeMap', () => {
  it('assembles files, symbols, edges and hunks', () => {
    const d = RENAME + DELETED + EDIT
    const map = buildChangeMap(d, (p) => (p === 'src/m.ts' ? NEW_TEXT : p === 'src/b.ts' ? 'new\n' : undefined))
    expect(map.files.map((f) => [f.path, f.status, f.area, f.additions, f.deletions])).toEqual([
      ['src/b.ts', 'renamed', 'src', 1, 1],
      ['docs/gone.md', 'deleted', 'docs', 0, 2],
      ['src/m.ts', 'modified', 'src', 1, 1]
    ])
    expect(map.files[0].oldPath).toBe('src/a.ts')
    expect(map.hunks.map((h) => [h.id, h.path])).toEqual([['h1', 'src/b.ts'], ['h2', 'docs/gone.md'], ['h3', 'src/m.ts']])
    expect(map.symbols.map((s) => s.name)).toEqual(['alpha'])
    expect(map.symbols[0].hunkIds).toEqual(['h3'])
    expect(map.total).toBe(3)
  })

  it('takes the area from the top two folders', () => {
    const map = buildChangeMap(diff('diff --git a/src/core/x/y.ts b/src/core/x/y.ts', '--- a/src/core/x/y.ts', '+++ b/src/core/x/y.ts', '@@ -1 +1 @@', '-a', '+b', 'diff --git a/README.md b/README.md', '--- a/README.md', '+++ b/README.md', '@@ -1 +1 @@', '-a', '+b'), () => undefined)
    expect(map.files.map((f) => f.area)).toEqual(['src/core', ''])
  })

  it('lists a binary file without hunks and says why', () => {
    const map = buildChangeMap(diff('diff --git a/i.png b/i.png', 'Binary files a/i.png and b/i.png differ'), () => undefined)
    expect(map.files[0]).toMatchObject({ path: 'i.png', skipped: 'binary' })
    expect(map.hunks).toEqual([])
  })

  it('skips the hunks of a file whose diff is past the limit, and its content for imports', () => {
    const big = diff('diff --git a/big.ts b/big.ts', '--- a/big.ts', '+++ b/big.ts', '@@ -1,1 +1,1 @@', '-' + 'a'.repeat(200), '+' + 'b'.repeat(200))
    const map = buildChangeMap(big, () => undefined, { maxBytes: 100 })
    expect(map.files[0]).toMatchObject({ path: 'big.ts', skipped: 'large', additions: 1, deletions: 1 })
    expect(map.hunks).toEqual([])
    expect(map.symbols).toEqual([])
  })

  it('does not read imports from content past the limit', () => {
    const d = diff('diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -1 +1,2 @@', ' x', "+import './b'", 'diff --git a/b.ts b/b.ts', '--- a/b.ts', '+++ b/b.ts', '@@ -1 +1 @@', '-1', '+2')
    const text = "x\nimport './b'\n" + 'y'.repeat(300)
    const map = buildChangeMap(d, (p) => (p === 'a.ts' ? text : '2\n'), { maxBytes: 100 })
    expect(map.edges).toEqual([])
    expect(map.files.find((f) => f.path === 'a.ts')?.skipped).toBe('large')
  })

  it('takes the reader\'s word that a file is too large', () => {
    const d = diff('diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -1 +1 @@', '-1', '+2')
    expect(buildChangeMap(d, () => CONTENT_TOO_LARGE).files[0].skipped).toBe('large')
  })

  it('caps the file list and reports the total', () => {
    const d = diff('diff --git a/1 b/1', '--- a/1', '+++ b/1', '@@ -1 +1 @@', '-a', '+b', 'diff --git a/2 b/2', '--- a/2', '+++ b/2', '@@ -1 +1 @@', '-a', '+b')
    const map = buildChangeMap(d, () => undefined, { maxFiles: 1 })
    expect(map.files).toHaveLength(1)
    expect(map.total).toBe(2)
  })
})
