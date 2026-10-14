import { describe, it, expect } from 'vitest'
import { findConsoleLinks, joinWrappedLine, bufferRangeAt, cellsOfJoinedLine, cutCandidates } from './consoleLinks'

const only = (line: string) => {
  const links = findConsoleLinks(line)
  expect(links).toHaveLength(1)
  return links[0]
}

describe('findConsoleLinks — paths', () => {
  it('a relative path with line and column', () => {
    expect(only('  at src/core/run/instances.ts:42:7')).toEqual({
      kind: 'path', start: 5, end: 35, target: 'src/core/run/instances.ts', line: 42, col: 7
    })
  })

  it('a backslash path with a line only', () => {
    expect(only('error in src\\a.ts:12')).toEqual({ kind: 'path', start: 9, end: 20, target: 'src\\a.ts', line: 12 })
  })

  // A drive letter is part of the path, not a `:line` suffix on `D`
  it('a Windows drive path, with and without a position', () => {
    expect(only('D:\\p\\a.ts:12:5')).toEqual({ kind: 'path', start: 0, end: 14, target: 'D:\\p\\a.ts', line: 12, col: 5 })
    expect(only('D:/p/a.ts')).toEqual({ kind: 'path', start: 0, end: 9, target: 'D:/p/a.ts' })
  })

  // Node's stack frame — the parentheses are not part of the link
  it('a stack frame keeps the parentheses out of the range', () => {
    const line = '    at run (D:\\p\\a.ts:12:5)'
    const l = only(line)
    expect(l).toEqual({ kind: 'path', start: 12, end: 26, target: 'D:\\p\\a.ts', line: 12, col: 5 })
    expect(line.slice(l.start, l.end)).toBe('D:\\p\\a.ts:12:5')
  })

  // TypeScript's diagnostic form
  it("TypeScript's path(line,col) form, followed by a colon", () => {
    expect(only('src/a.ts(12,5): error TS2322')).toEqual({ kind: 'path', start: 0, end: 14, target: 'src/a.ts', line: 12, col: 5 })
  })

  it('a file:// URL is a path without the scheme, the range covering the whole token', () => {
    expect(only('see file:///D:/p/a.ts')).toEqual({ kind: 'path', start: 4, end: 21, target: 'D:/p/a.ts' })
  })

  it('a path with an extension and a line but no separator is still a link', () => {
    expect(only('a.ts:12')).toEqual({ kind: 'path', start: 0, end: 7, target: 'a.ts', line: 12 })
  })

  it('trailing punctuation is not part of the link', () => {
    expect(only('failed: src/a.ts:3.')).toEqual({ kind: 'path', start: 8, end: 18, target: 'src/a.ts', line: 3 })
  })
})

// Korean, Japanese and Chinese put a particle or a copula right after a word, with no space between: a sentence names a
// file as `...concept_vs_app.png입니다.` (bug report, 2026-10-14: that link did not open while the same path at the end of
// a line did). The token is still the link; the same path without the glued-on run is its `alt`, which the renderer
// tries when the whole names no file, so a file or folder whose own name ends in Hangul still links whole.
describe('findConsoleLinks — a path with a word glued to it', () => {
  it('offers the path without a Korean ending glued to it', () => {
    const line = '마지막 장은 C:\\Users\\a\\concept_vs_app.png입니다.'
    const l = only(line)
    expect(l).toEqual({
      kind: 'path',
      start: 7,
      end: line.length - 1,
      target: 'C:\\Users\\a\\concept_vs_app.png입니다',
      alt: { end: line.length - 4, target: 'C:\\Users\\a\\concept_vs_app.png' }
    })
    if (l.kind !== 'path' || !l.alt) throw new Error('no alt')
    expect(line.slice(l.start, l.alt.end)).toBe('C:\\Users\\a\\concept_vs_app.png')
  })

  it('reads a file and line a Japanese particle follows, which as a whole is no path', () => {
    expect(only('src/a.ts:12を見て')).toEqual({ kind: 'path', start: 0, end: 11, target: 'src/a.ts', line: 12 })
  })

  it('peels a closing parenthesis and full-width punctuation around the glued run', () => {
    expect(only('(C:\\a\\b.png)를 보세요')).toMatchObject({ start: 1, target: 'C:\\a\\b.png)를', alt: { end: 11, target: 'C:\\a\\b.png' } })
    expect(only('看 C:\\a\\b.png。')).toMatchObject({ start: 2, target: 'C:\\a\\b.png。', alt: { end: 12, target: 'C:\\a\\b.png' } })
  })

  // Review m2: an alt that ends in a separator names a folder, which no resolver answers, so none is offered
  it('keeps a Korean folder or file name whole, and offers no alt that names a folder', () => {
    expect(only('C:\\문서\\보고서')).toEqual({ kind: 'path', start: 0, end: 9, target: 'C:\\문서\\보고서' })
    expect(findConsoleLinks('읽기/쓰기를 켜기/끄기로').map((l) => (l.kind === 'path' ? l.alt : 'url'))).toEqual([undefined, undefined])
  })

  // Review m1: kana's prolonged sound mark and the like are Common script, used by Japanese only; and a question, an
  // exclamation, a tilde or an ellipsis can close the sentence after the glued word
  it('takes a Japanese word with a prolonged sound mark, and a sentence that ends in ! ? ~ or …', () => {
    expect(only('D:\\写真\\猫.pngをコピーしました。')).toMatchObject({ alt: { target: 'D:\\写真\\猫.png' } })
    for (const tail of ['인가요?', '입니다!', '예요~', '입니다…', '!'])
      expect(only(`C:\\a\\b.png${tail}`), tail).toMatchObject({ alt: { end: 10, target: 'C:\\a\\b.png' } })
  })

  // Review I1: the glued run is looked for from its first character only. Anchored at the end alone, a long run of
  // letters the class takes followed by one it does not was tried from every position: 2.4 s for 20,000 characters,
  // on every hover of the row.
  it('reads a long run of CJK text with no space in linear time', () => {
    const line = 'あ'.repeat(20_000) + 'x' + '/' + '中'.repeat(20_000) + 'y'
    const t0 = performance.now()
    findConsoleLinks(line)
    expect(performance.now() - t0).toBeLessThan(250)
  })

  it('offers nothing more when no word is glued on, or nothing is left without it', () => {
    expect(only('D:\\p\\a.png')).toEqual({ kind: 'path', start: 0, end: 10, target: 'D:\\p\\a.png' })
    expect(findConsoleLinks('보고서를 확인하세요')).toEqual([])
  })
})

describe('findConsoleLinks — URLs', () => {
  it('an http URL', () => {
    expect(only('  ➜  Local:   http://localhost:5173/')).toEqual({ kind: 'url', start: 14, end: 36, url: 'http://localhost:5173/' })
  })

  it('a URL in parentheses and one followed by a period lose the closing punctuation', () => {
    expect(only('(https://vite.dev/config/)')).toEqual({ kind: 'url', start: 1, end: 25, url: 'https://vite.dev/config/' })
    expect(only('see https://vite.dev.')).toEqual({ kind: 'url', start: 4, end: 20, url: 'https://vite.dev' })
  })

  // A URL contains slashes; it must not also be reported as a path
  it('a URL is reported once, as a URL', () => {
    expect(findConsoleLinks('https://example.com/a/b.ts')).toEqual([
      { kind: 'url', start: 0, end: 26, url: 'https://example.com/a/b.ts' }
    ])
  })

  // The length check rejects a bare scheme, so it has to be measured against the scheme that actually
  // matched: a hardcoded 'https://'.length dropped this valid eight-character URL
  it('a one-character host after http:// is a URL', () => {
    expect(only('see http://a')).toEqual({ kind: 'url', start: 4, end: 12, url: 'http://a' })
  })

  it('a bare scheme is not a URL', () => {
    expect(findConsoleLinks('http://')).toEqual([])
    expect(findConsoleLinks('see https://.')).toEqual([])
  })
})

describe('findConsoleLinks — not links', () => {
  it.each(['12:30', '1:2:3', 'word', '--flag=a:b', 'D:', 'ready in 431 ms', 'exit code 1'])('%s', (line) => {
    expect(findConsoleLinks(line)).toEqual([])
  })
})

describe('findConsoleLinks — several in one line', () => {
  it('reports every link in order with non-overlapping ranges', () => {
    const line = 'a/b.ts:1 and c/d.ts:2 see http://x.y/'
    const links = findConsoleLinks(line)
    expect(links.map((l) => l.kind)).toEqual(['path', 'path', 'url'])
    for (let i = 1; i < links.length; i++) expect(links[i].start).toBeGreaterThanOrEqual(links[i - 1].end)
    expect(links.map((l) => line.slice(l.start, l.end))).toEqual(['a/b.ts:1', 'c/d.ts:2', 'http://x.y/'])
  })
})

describe('findConsoleLinks — JVM stack frames', () => {
  // The file inside the parentheses carries no directory; the package in front of the class does.
  // The link covers only `File.java:140`, as IntelliJ underlines it, and the target is the
  // classpath-relative path main can try under the source roots.
  it('a plain frame', () => {
    const line = '\tat org.apache.catalina.core.ApplicationFilterChain.doFilter(ApplicationFilterChain.java:140)'
    const start = line.indexOf('ApplicationFilterChain.java:140')
    expect(findConsoleLinks(line)).toEqual([
      { kind: 'path', start, end: start + 'ApplicationFilterChain.java:140'.length, target: 'org/apache/catalina/core/ApplicationFilterChain.java', line: 140 }
    ])
  })

  it.each([
    ['an inner class uses the outer file', '\tat org.apache.coyote.AbstractProtocol$ConnectionHandler.process(AbstractProtocol.java:905)', 'org/apache/coyote/AbstractProtocol.java', 905],
    ['a lambda', '\tat com.anipen.demo.HelloController.lambda$hello$0(HelloController.java:23)', 'com/anipen/demo/HelloController.java', 23],
    ['a constructor', '\tat com.anipen.demo.App.<init>(App.java:7)', 'com/anipen/demo/App.java', 7],
    ['Kotlin', '\tat com.anipen.demo.MainKt.main(Main.kt:12)', 'com/anipen/demo/Main.kt', 12],
    ['the default package', '\tat Main.main(Main.java:5)', 'Main.java', 5],
    ['a Java 9+ module prefix', '\tat java.base/java.lang.Thread.run(Thread.java:1583)', 'java/lang/Thread.java', 1583],
    ['a classloader prefix', '\tat app//com.anipen.demo.App.run(App.java:9)', 'com/anipen/demo/App.java', 9]
  ])('%s', (_name, line, target, lineNo) => {
    const links = findConsoleLinks(line)
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ kind: 'path', target, line: lineNo })
  })

  it.each(['\tat com.x.Foo.bar(Unknown Source)', '\tat com.x.Foo.bar(Native Method)', '\tat com.x.Foo.bar(Foo.java)'])('%s is not a link', (line) => {
    expect(findConsoleLinks(line)).toEqual([])
  })

  // A Node frame has a space before its parenthesis and a real path inside; the JVM rule must not
  // claim it, and the existing token pass must still read it as before
  it('leaves a Node frame to the token pass', () => {
    const line = '    at Object.<anonymous> (/home/u/app/a.js:1:2)'
    expect(findConsoleLinks(line)).toEqual([{ kind: 'path', start: 27, end: 47, target: '/home/u/app/a.js', line: 1, col: 2 }])
  })
})

describe('findConsoleLinks — Python frames', () => {
  it.each([
    ['an absolute path', '  File "/home/u/app/main.py", line 12, in <module>', '/home/u/app/main.py', 12],
    ['a relative path', '  File "main.py", line 3', 'main.py', 3],
    ['a Windows path', '  File "C:\\proj\\app.py", line 9, in run', 'C:\\proj\\app.py', 9]
  ])('%s carries its line', (_name, line, target, lineNo) => {
    const start = line.indexOf(target)
    expect(findConsoleLinks(line)).toEqual([{ kind: 'path', start, end: start + target.length, target, line: lineNo }])
  })
})

describe('findConsoleLinks — URLs against a TUI box', () => {
  // Claude Code draws its frames with Box Drawing characters. A URL printed against the right edge
  // used to swallow the `│` as part of the address.
  it('a box edge ends the URL, with and without a space', () => {
    expect(only('│ http://localhost:5173/│')).toEqual({
      kind: 'url', start: 2, end: 24, url: 'http://localhost:5173/'
    })
    expect(only('│http://localhost:5173/│')).toEqual({
      kind: 'url', start: 1, end: 23, url: 'http://localhost:5173/'
    })
  })
  it('a horizontal rule after a URL is not part of it', () => {
    expect(only('Local: http://localhost:5173/ ──────')).toEqual({
      kind: 'url', start: 7, end: 29, url: 'http://localhost:5173/'
    })
  })
})

describe('joinWrappedLine', () => {
  // Row 1 and 2 are continuations of row 0; row 3 starts a new logical line
  const rows = [
    { text: 'AAAA', isWrapped: false },
    { text: 'BBBB', isWrapped: true },
    { text: 'CC  ', isWrapped: true },
    { text: 'DDDD', isWrapped: false }
  ]
  const getLine = (y: number) => rows[y]

  it.each([0, 1, 2])('asked about row %i of a wrapped line, returns the whole line from its first row', (y) => {
    expect(joinWrappedLine(getLine, y)).toEqual({ text: 'AAAABBBBCC  ', startY: 0 })
  })

  it('an unwrapped line is itself', () => {
    expect(joinWrappedLine(getLine, 3)).toEqual({ text: 'DDDD', startY: 3 })
  })

  it("the buffer's edge ends the walk", () => {
    expect(joinWrappedLine(() => undefined, 5)).toEqual({ text: '', startY: 5 })
  })
})

describe('bufferRangeAt', () => {
  // One entry per character of the joined text — the provider builds it from the real cells, so a
  // wide glyph occupies one entry and two columns
  const cells = [
    { x: 1, y: 11 },
    { x: 2, y: 11 },
    { x: 4, y: 11 }, // the character at index 1 was two columns wide
    { x: 1, y: 12 }, // the line wrapped here
    { x: 2, y: 12 }
  ]

  it('maps a range inside one row', () => {
    expect(bufferRangeAt(cells, 0, 2)).toEqual({ start: { x: 1, y: 11 }, end: { x: 2, y: 11 } })
  })

  it('maps a range that wraps onto the next row', () => {
    expect(bufferRangeAt(cells, 2, 5)).toEqual({ start: { x: 4, y: 11 }, end: { x: 2, y: 12 } })
  })

  it('a single character is one cell', () => {
    expect(bufferRangeAt(cells, 2, 3)).toEqual({ start: { x: 4, y: 11 }, end: { x: 4, y: 11 } })
  })

  // Defensive: the text and the table should never disagree, but a dead provider would be worse
  it('an out-of-range offset clamps to the last cell', () => {
    expect(bufferRangeAt(cells, 9, 12)).toEqual({ start: { x: 2, y: 12 }, end: { x: 2, y: 12 } })
  })

  it('an empty table is the first cell', () => {
    expect(bufferRangeAt([], 0, 3)).toEqual({ start: { x: 1, y: 1 }, end: { x: 1, y: 1 } })
  })
})

describe('cellsOfJoinedLine', () => {
  // A cell's `chars` is what it contributes to the joined text: one unit for ASCII, two for an
  // astral glyph, none for the trailing half of a wide one, and one space for a blank.
  const cell = (chars: string, width = 1) => ({ chars, width })
  const rows = [
    { cells: [cell('a'), cell('가', 2), cell('', 0), cell('🚀'), cell(' '), cell('')], isWrapped: false },
    { cells: [cell('b'), cell('c')], isWrapped: true },
    { cells: [cell('z')], isWrapped: false }
  ]
  const getRow = (y: number) => rows[y]

  it('gives one entry per code unit, at the cell that holds it', () => {
    // 'a'(1) + '가'(1) + trailing half(0) + '🚀'(2, one cell) + ' '(1) + never-written(1) = 6 entries on row 0
    expect(cellsOfJoinedLine(getRow, 0)).toEqual([
      { x: 1, y: 1 }, // a
      { x: 2, y: 1 }, // 가 — two columns, one code unit
      { x: 4, y: 1 }, // 🚀 high surrogate (column 4: the wide glyph's second column was skipped)
      { x: 4, y: 1 }, // 🚀 low surrogate — the same cell
      { x: 5, y: 1 }, // the blank (a literal space)
      { x: 6, y: 1 }, // a never-written cell (chars: '') — translateToString renders it as one space too
      { x: 1, y: 2 }, // b, on the continuation row
      { x: 2, y: 2 } // c
    ])
  })

  // The invariant bufferRangeAt's offsets rely on. Asserted here rather than only stated in prose,
  // because this is the seam that has been wrong twice.
  it('has exactly one entry per character of the text joinWrappedLine produces', () => {
    const { text } = joinWrappedLine(
      (y) => {
        const row = rows[y]
        return row
          ? { text: row.cells.map((c) => (c.width === 0 ? '' : c.chars || ' ')).join(''), isWrapped: row.isWrapped }
          : undefined
      },
      0
    )
    expect(cellsOfJoinedLine(getRow, 0)).toHaveLength(text.length)
  })

  it('an unwrapped row stands alone', () => {
    expect(cellsOfJoinedLine(getRow, 2)).toEqual([{ x: 1, y: 3 }])
  })

  it("the buffer's edge ends the walk", () => {
    expect(cellsOfJoinedLine(() => undefined, 5)).toEqual([])
  })

  // xterm's translateToString renders a never-written cell as one space while the cell API reports its
  // chars as '' — so a blank cell contributes one character, not none. Without that compensation the
  // table would run short of the text and every link after a blank cell would shift.
  it('a never-written cell contributes one entry, like the space translateToString renders', () => {
    expect(cellsOfJoinedLine((y) => (y === 0 ? { cells: [{ chars: '', width: 1 }], isWrapped: false } : undefined), 0)).toEqual([
      { x: 1, y: 1 }
    ])
  })
})

// Claude Code's TUI line for a SendUserFile, measured from a real session: the path is relative to
// the agent's own current directory (not the session's cwd), with backslashes, and the file's size
// follows in parentheses.
describe('findConsoleLinks — the SendUserFile line of the Claude TUI', () => {
  it('extracts the relative backslash path and leaves the size out', () => {
    const line = '  › [file] clips\\chk\\preview_c26_c27.mp4 (1.2MB)'
    const paths = findConsoleLinks(line).filter((l) => l.kind === 'path')
    expect(paths).toHaveLength(1)
    expect(paths[0]).toMatchObject({ kind: 'path', target: 'clips\\chk\\preview_c26_c27.mp4' })
    expect(line.slice(paths[0].start, paths[0].end)).toBe('clips\\chk\\preview_c26_c27.mp4')
  })
})

// The same TUI, when the file sits in the agent's own folder: a bare name with no separator. Measured
// from a real session where the line above it (with a separator) was a link and this one was not.
describe('findConsoleLinks — bare media names', () => {
  it('links a bare video or image name, as the SendUserFile line prints it', () => {
    const line = '  › [file] seg31.mp4 (888.9KB)'
    const paths = findConsoleLinks(line).filter((l) => l.kind === 'path')
    expect(paths).toHaveLength(1)
    expect(line.slice(paths[0].start, paths[0].end)).toBe('seg31.mp4')
    expect(findConsoleLinks('saved cover.PNG').filter((l) => l.kind === 'path')).toHaveLength(1)
  })

  it('still leaves a bare non-media word alone', () => {
    expect(findConsoleLinks('edit index.ts and README.md').filter((l) => l.kind === 'path')).toEqual([])
  })
})

// Claude Code wraps a long line itself and indents what follows, so a path longer than the room left is cut at the
// right edge and goes on, after spaces, on the next row: the terminal never marks that row as wrapped, and joining it
// as one would put the spaces inside the path. Only one path in six opened from such a list, and none in a split
// pane, where the rows are half as wide. The ways a cut word can read joined are offered word by word (the last word
// of one row, whole one-word rows, the first word of a later row); the resolver says which names a file.
describe('cutCandidates', () => {
  const row = (text: string, isWrapped = false) => ({ cells: [...text].map((c) => ({ width: 1, chars: c === ' ' ? '' : c })), isWrapped })
  const PATH = 'C:\\Users\\anipen\\AppData\\Roaming\\astera-dev\\preview\\shots\\app-226bd0e8.png'
  const targets = (rows: ReturnType<typeof row>[], y: number, cols: number): string[] =>
    cutCandidates((r) => rows[r], y, cols).flatMap((c) => findConsoleLinks(c.text).filter((l) => l.kind === 'path').map((l) => (l.kind === 'path' ? l.target : '')))
  /** The joined texts themselves: a candidate that is exactly the path, not one a link pass can dig it out of. */
  const texts = (rows: ReturnType<typeof row>[], y: number, cols: number): string[] => cutCandidates((r) => rows[r], y, cols).map((c) => c.text)
  const at = (y: number, cols: number, rows: ReturnType<typeof row>[]) => {
    const c = cutCandidates((r) => rows[r], y, cols).find((x) => x.text.includes(PATH))!
    const i = c.text.indexOf(PATH)
    return { start: c.cells[i], end: c.cells[i + PATH.length - 1] }
  }

  // 30 columns, as a split pane narrows them: the 73-character path takes three rows.
  it('joins a quoted path cut across three rows, from any of them, with where it sits', () => {
    const cols = 30
    const rows = ['  "' + PATH.slice(0, 27), '    ' + PATH.slice(27, 53), '    ' + PATH.slice(53) + '",'].map((l) => row(l.padEnd(cols)))
    for (const y of [0, 1, 2]) {
      expect(targets(rows, y, cols), String(y)).toContain(PATH)
      expect(at(y, cols, rows)).toEqual({ start: { x: 4, y: 1 }, end: { x: 24, y: 3 } })
    }
  })

  // Final review I3: the next list item, a bullet or prose around the path do not join it.
  it('offers the path alone when the next row starts another item, or prose ends near the edge above it', () => {
    const cols = 30
    const next = [row(('  ' + PATH.slice(0, 28)).padEnd(cols)), row(('    ' + PATH.slice(28, 54)).padEnd(cols)), row(('    ' + PATH.slice(54)).padEnd(cols)), row('  D:\\next\\item.png'.padEnd(cols))]
    expect(texts(next, 1, cols)).toContain(PATH)
    const prose = [row('  the screenshot is saved at'.padEnd(cols)), row(('  ' + PATH.slice(0, 28)).padEnd(cols)), row(('    ' + PATH.slice(28, 54)).padEnd(cols)), row(('    ' + PATH.slice(54)).padEnd(cols))]
    expect(texts(prose, 2, cols)).toContain(PATH)
  })

  // Final review I4: rows above do not use up the rows below.
  it('follows the path below the pointer whatever is above it', () => {
    const cols = 30
    const rows = [
      row('  aaaaaaaaaaaaaaaaaaaaaaaaaa'.padEnd(cols)),
      row('  bbbbbbbbbbbbbbbbbbbbbbbbbbbb'.padEnd(cols)),
      row('  cccccccccccccccccccccccccc'.padEnd(cols)),
      row(('  ' + PATH.slice(0, 28)).padEnd(cols)),
      row(('    ' + PATH.slice(28, 54)).padEnd(cols)),
      row(('    ' + PATH.slice(54)).padEnd(cols))
    ]
    for (const y of [3, 4, 5]) expect(texts(rows, y, cols), String(y)).toContain(PATH)
  })

  it('follows a path across five rows', () => {
    const cols = 20
    const pieces = [PATH.slice(0, 18), PATH.slice(18, 34), PATH.slice(34, 50), PATH.slice(50, 66), PATH.slice(66)]
    const rows = pieces.map((p, i) => row(((i === 0 ? '  ' : '    ') + p).padEnd(cols)))
    expect(texts(rows, 2, cols)).toContain(PATH)
  })

  it('offers nothing for a row whose content stops short of the right edge, or before a blank row', () => {
    expect(cutCandidates((r) => [row('  C:\\a\\b.png'.padEnd(40)), row('    next line'.padEnd(40))][r], 0, 40)).toEqual([])
    expect(cutCandidates((r) => [row('aaaaaaaaaa'), row(' '.repeat(10))][r], 0, 10)).toEqual([])
  })

  it("keeps the first row's word apart, for a link it may name by itself", () => {
    const rows = [row('  see lib/app.py:125'), row('  4. next')]
    const c = cutCandidates((r) => rows[r], 0, 20)
    expect(c.map((x) => x.text)).toEqual(['lib/app.py:1254.'])
    expect(c[0].head.text).toBe('lib/app.py:125')
  })
})
