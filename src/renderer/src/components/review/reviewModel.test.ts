import { describe, expect, it } from 'vitest'
import type { ChangeMapFile, ChangeSymbol, ParsedHunk } from '../../../../core/review/changeMap'
import { anchorOf, hunkRange, isViewed, parseViewed, reviewModel, stepHunk, viewedReducer, viewedSig } from './reviewModel'

const file = (path: string, area: string, extra: Partial<ChangeMapFile> = {}): ChangeMapFile => ({
  path, area, status: 'modified', additions: 1, deletions: 1, ...extra
})
const hunk = (id: string, path: string, newStart = 1, newLines = 3): ParsedHunk => ({
  id, path, oldStart: newStart, oldLines: 3, newStart, newLines, header: '', text: `@@ -${newStart},3 +${newStart},${newLines} @@\n`
})
const sym = (path: string, name: string, hunkIds: string[]): ChangeSymbol => ({
  path, name, kind: 'function', change: 'modified', side: 'new', start: 1, end: 5, hunkIds
})

describe('reviewModel', () => {
  const map = {
    files: [file('src/b/z.ts', 'src/b'), file('README.md', ''), file('src/a/y.ts', 'src/a'), file('src/a/x.ts', 'src/a')],
    hunks: [hunk('h1', 'src/b/z.ts'), hunk('h2', 'README.md'), hunk('h3', 'src/a/y.ts', 1), hunk('h4', 'src/a/y.ts', 40), hunk('h5', 'src/a/y.ts', 80), hunk('h6', 'src/a/x.ts')],
    symbols: [sym('src/a/y.ts', 'second', ['h5', 'h3']), sym('src/a/y.ts', 'first', ['h3']), sym('src/b/z.ts', 'z', ['h1'])]
  }
  const m = reviewModel(map)

  it('orders areas by name with the root first, and files by path inside an area', () => {
    expect(m.areas.map((a) => a.area)).toEqual(['', 'src/a', 'src/b'])
    expect(m.areas[1].files.map((f) => f.file.path)).toEqual(['src/a/x.ts', 'src/a/y.ts'])
  })

  it('puts each hunk once, under the first symbol that claims it, and the rest under null', () => {
    const y = m.areas[1].files[1]
    expect(y.groups.map((g) => [g.symbol?.name ?? null, g.hunks.map((h) => h.id)])).toEqual([
      ['second', ['h3', 'h5']],
      [null, ['h4']]
    ])
    // the map still lists both symbols
    expect(y.symbols.map((s) => s.name)).toEqual(['second', 'first'])
  })

  it('walks hunks in reading order and knows each hunk file', () => {
    expect(m.order).toEqual(['h2', 'h6', 'h3', 'h5', 'h4', 'h1'])
    expect(m.fileOf.get('h4')).toBe('src/a/y.ts')
  })

  it('anchors a symbol at its first hunk in reading order', () => {
    expect(anchorOf(map.symbols[1], m.order)).toBe('h3')
    expect(anchorOf(sym('x', 'gone', ['h99']), m.order)).toBeNull()
  })

  it('gives a file with no hunks (binary, too large) no groups', () => {
    const r = reviewModel({ files: [file('img.png', '', { skipped: 'binary' })], hunks: [], symbols: [] })
    expect(r.areas[0].files[0].groups).toEqual([])
    expect(r.order).toEqual([])
  })
})

describe('stepHunk', () => {
  const order = ['a', 'b', 'c']
  it('starts at the first or the last, moves by one and stops at the ends', () => {
    expect(stepHunk(order, null, 1)).toBe('a')
    expect(stepHunk(order, null, -1)).toBe('c')
    expect(stepHunk(order, 'a', 1)).toBe('b')
    expect(stepHunk(order, 'c', 1)).toBe('c')
    expect(stepHunk(order, 'a', -1)).toBe('a')
    expect(stepHunk([], null, 1)).toBeNull()
  })
})

describe('hunkRange', () => {
  it('is the new-side range, and a removal-only hunk points at the line before', () => {
    expect(hunkRange({ newStart: 10, newLines: 4 })).toEqual({ start: 10, end: 13 })
    expect(hunkRange({ newStart: 7, newLines: 0 })).toEqual({ start: 7, end: 7 })
    expect(hunkRange({ newStart: 0, newLines: 0 })).toEqual({ start: 1, end: 1 })
  })
})

describe('viewedReducer', () => {
  const f = file('a.ts', '')
  it('toggles a file on and off', () => {
    const on = viewedReducer({}, { type: 'toggle', file: f })
    expect(on).toEqual({ 'a.ts': viewedSig(f) })
    expect(isViewed(on, f)).toBe(true)
    expect(viewedReducer(on, { type: 'toggle', file: f })).toEqual({})
  })

  it('drops the mark when the file changed since it was marked, and a toggle marks it again', () => {
    const on = viewedReducer({}, { type: 'toggle', file: f })
    const changed = { ...f, additions: 9 }
    expect(isViewed(on, changed)).toBe(false)
    expect(viewedReducer(on, { type: 'toggle', file: changed })).toEqual({ 'a.ts': viewedSig(changed) })
  })

  it('loads a stored state as it is', () => {
    expect(viewedReducer({ x: '1' }, { type: 'load', state: { y: '2' } })).toEqual({ y: '2' })
  })
})

describe('parseViewed', () => {
  it('reads an object of strings and treats anything else as no marks', () => {
    expect(parseViewed('{"a.ts":"modified:1:1","b":3}')).toEqual({ 'a.ts': 'modified:1:1' })
    expect(parseViewed(null)).toEqual({})
    expect(parseViewed('not json')).toEqual({})
    expect(parseViewed('[1]')).toEqual({})
  })
})
