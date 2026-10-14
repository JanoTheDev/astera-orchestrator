import { mediaKindOf } from '../files/media'
import { isLoopbackUrl, previewTargetOf } from '../preview/url'

// What in a line of run output is a link, and how xterm's rows relate to that line. All pure — the
// renderer's link provider (RunPanel) calls these with buffer rows and turns the answers into xterm
// ILinks; whether a path really exists is main's call (main/run/resolveLink.ts), not this file's.

/** The first loopback address in a chunk of run output, ready for the preview to open: `0.0.0.0` and
 *  `[::]` become `localhost`, and trailing sentence punctuation is peeled the way a console link is.
 *  null when the output holds none.
 *
 *  This is what lets a dev server be previewed with nothing configured — the run prints its address,
 *  and the run's tab grows a button that opens it. */
export function firstLoopbackUrl(text: string): string | null {
  URL_RE.lastIndex = 0
  for (let m = URL_RE.exec(text); m; m = URL_RE.exec(text)) {
    const url = m[0].replace(URL_TRAIL, '')
    if (isLoopbackUrl(url)) return previewTargetOf(url)
  }
  return null
}

/** The same path read without a word glued to its end (GLUED_WORD), for the renderer to try when the whole names no
 *  file. It starts where the link starts. */
export interface PathAlt {
  end: number
  target: string
  line?: number
  col?: number
}

export type ConsoleLink =
  | { kind: 'path'; start: number; end: number; target: string; line?: number; col?: number; alt?: PathAlt }
  | { kind: 'url'; start: number; end: number; url: string }

// Box Drawing (U+2500–U+257F) ends a URL and a token too: Claude Code's TUI frames its output with
// `│` and `─`, and a URL printed against the right edge would otherwise carry the edge with it.
const URL_RE = /(https?):\/\/[^\s'"<>\u2500-\u257F]+/g
// Tokens are whitespace-separated; quotes and angle brackets also end one (they wrap paths in
// messages). Parentheses stay inside the token so TypeScript's `a.ts(12,5)` survives; a stack frame's
// wrapping parentheses are peeled below.
const TOKEN_RE = /[^\s'"<>\u2500-\u257F]+/g
const LEAD_OPEN = /^[([]+/
const TRAIL_CLOSE = /[)\]]+$/
const TRAIL_PUNCT = /[.,;:]+$/
// URL: whatever the regex took, minus closing punctuation a sentence or a parenthesis left on it
const URL_TRAIL = /[)\].,;:]+$/
const FILE_SCHEME = /^file:\/\/\//
// `path:line[:col]`. The path is an optional drive letter followed by anything but a colon — the
// colon is where the position starts. `D:\p\a.ts:12` therefore reads the drive as part of the path.
// A leading `/`, `./` or `~/` needs no branch of its own: it contains no colon, so `[^:]*?` already
// matches it — only the drive letter earns a branch, being the one prefix that contains the colon
// the rest of the group excludes.
const POSITION_RE = /^((?:[A-Za-z]:[\\/])?[^:]*?)(?::(\d+)(?::(\d+))?)?$/
// TypeScript's `path(line,col)`
const TS_POSITION_RE = /^((?:[A-Za-z]:[\\/])?[^:()]+)\((\d+),(\d+)\)$/
const SEP = /[\\/]/
// Korean, Japanese and Chinese glue a particle or a copula to the word before it, with no space: a sentence names a file
// as `...concept_vs_app.png입니다.` (bug report, 2026-10-14). A run of their letters, and of the full-width punctuation
// that closes their sentences, at the end of a token is such a word. It is not cut away outright, since a file or a
// folder can be named in Hangul too: the path without it is offered as the link's `alt`.
const GLUED_WORD = /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303F\uFF00-\uFFEF]+$/u
const EXT = /\.[A-Za-z0-9]{1,10}$/
// A JVM stack frame: `at [module/]pkg.Class.method(File.ext:line)`. The file inside the parentheses
// carries no directory — the package in front of the class is the directory, so the target is the
// classpath-relative path (`com/anipen/demo/HelloController.java`) and main tries the source roots.
// The optional prefix swallows Java 9+'s module (`java.base/`) and a classloader (`app//`). The
// method may be a constructor (`<init>`), a lambda (`lambda$run$0`) or hold `$`; the class may be an
// inner class (`Outer$Inner`), whose file is the outer class's — which is what the parentheses say.
// The link is the `File.ext:line` inside the parentheses, as IntelliJ underlines it.
const JVM_FRAME_RE = /\bat\s+(?:[\w.]+\/\/?)?((?:[\w$]+\.)*)[\w$]+\.[\w$<>]+\((([\w$]+\.(?:java|kt|kts|scala|groovy)):(\d+))\)/g
// Python's `File "path", line N`, an optional `, in name` tail. The path is quoted, so it carries
// its own separators and spaces; the token pass already finds it (quotes end a token) but loses the
// line, so this rule claims the range to keep the line attached.
const PY_FRAME_RE = /File "([^"]+)", line (\d+)/g

/** A path candidate is a link when it contains a separator, or has an extension and a line — a bare
 *  word is not a file, and `12:30` is a clock. A bare video or image name is the exception: Claude
 *  Code prints a file it sends from the agent's own folder that way (`› [file] seg31.mp4`), and a
 *  word that happens to end in `.mp4` or `.png` names a file far more often than `index.ts` in
 *  prose does. Main still links it only when the file exists. */
function acceptPath(target: string, line: number | undefined): boolean {
  if (target === '') return false
  if (SEP.test(target)) return true
  if (mediaKindOf(target) !== null) return true
  return EXT.test(target) && line !== undefined
}

export function findConsoleLinks(line: string): ConsoleLink[] {
  const out: ConsoleLink[] = []
  const taken: [number, number][] = []
  // URLs first: a URL has slashes and would otherwise be read as a path by the token pass below
  for (const m of line.matchAll(URL_RE)) {
    const url = m[0].replace(URL_TRAIL, '')
    // Nothing left after the scheme once trailing punctuation was stripped. Measured against the
    // scheme this match actually took, not a fixed 'https://' — that fixed length rejected a valid
    // `http://a` (8 characters) along with a truly empty `http://`.
    if (url.length <= m[1].length + '://'.length) continue
    const start = m.index ?? 0
    out.push({ kind: 'url', start, end: start + url.length, url })
    taken.push([start, start + url.length])
  }
  // JVM frames next: the token pass splits on whitespace and does not treat `(` as a boundary, so
  // without this it would read the whole `pkg.Class.method(File.java` as one nonsense token.
  for (const m of line.matchAll(JVM_FRAME_RE)) {
    const pkg = m[1].slice(0, -1) // drop the trailing dot the group captured, if any
    const fileExt = m[3]
    const target = (pkg === '' ? fileExt : pkg.replace(/\./g, '/') + '/' + fileExt)
    const linkText = m[2]
    const start = (m.index ?? 0) + m[0].indexOf(linkText)
    const end = start + linkText.length
    out.push({ kind: 'path', start, end, target, line: Number(m[4]) })
    taken.push([start, end])
  }
  // Python frames: the token pass already finds the quoted path (quotes end a token) but loses the
  // line that follows it, so this rule claims the range to keep the two together.
  for (const m of line.matchAll(PY_FRAME_RE)) {
    const target = m[1]
    const start = (m.index ?? 0) + 'File "'.length
    const end = start + target.length
    out.push({ kind: 'path', start, end, target, line: Number(m[2]) })
    taken.push([start, end])
  }
  for (const m of line.matchAll(TOKEN_RE)) {
    let start = m.index ?? 0
    let text = m[0]
    const end0 = start + text.length
    if (taken.some(([s, e]) => start < e && end0 > s)) continue
    const lead = text.match(LEAD_OPEN)
    if (lead) {
      start += lead[0].length
      text = text.slice(lead[0].length)
    }
    const whole = readPath(text)
    // The same token without a word glued to its end, when that leaves something to read: the sentence's punctuation
    // and a closing parenthesis after the word come off first (`...png입니다.`, `...png를)`)
    const trimmed = text.replace(TRAIL_PUNCT, '').replace(TRAIL_CLOSE, '').replace(TRAIL_PUNCT, '')
    const bare = GLUED_WORD.test(trimmed) ? trimmed.replace(GLUED_WORD, '') : text
    const cut = bare !== text && bare !== '' ? readPath(bare) : null
    const first = whole ?? cut
    if (first === null) continue
    const link: ConsoleLink = { kind: 'path', start, end: start + first.length, target: first.target }
    if (first.line !== undefined) link.line = first.line
    if (first.col !== undefined) link.col = first.col
    if (whole !== null && cut !== null && cut.target !== whole.target) {
      const alt: PathAlt = { end: start + cut.length, target: cut.target }
      if (cut.line !== undefined) alt.line = cut.line
      if (cut.col !== undefined) alt.col = cut.col
      link.alt = alt
    }
    out.push(link)
  }
  return out.sort((a, b) => a.start - b.start)
}

/** One token, its opening brackets already peeled, read as a path: the target, its position, and how many of the
 *  token's characters the link covers. null when it names no file (acceptPath). */
function readPath(token: string): { target: string; line?: number; col?: number; length: number } | null {
  // `a.ts(12,5):` — the colon after the parenthesis is punctuation, the parenthesis is the position
  let text = token.replace(TRAIL_PUNCT, '')
  const ts = text.match(TS_POSITION_RE)
  if (ts) {
    const target = ts[1]
    return acceptPath(target, Number(ts[2])) ? { target, line: Number(ts[2]), col: Number(ts[3]), length: text.length } : null
  }
  // `(D:\p\a.ts:12:5)` — a stack frame's closing parenthesis, then any punctuation before it
  text = text.replace(TRAIL_CLOSE, '').replace(TRAIL_PUNCT, '')
  const scheme = text.match(FILE_SCHEME)
  const body = scheme ? text.slice(scheme[0].length) : text
  const pos = body.match(POSITION_RE)
  if (!pos) return null
  const target = pos[1]
  const lineNo = pos[2] === undefined ? undefined : Number(pos[2])
  if (!acceptPath(target, lineNo)) return null
  return {
    target,
    ...(lineNo !== undefined ? { line: lineNo } : {}),
    ...(pos[3] !== undefined ? { col: Number(pos[3]) } : {}),
    length: text.length
  }
}

/** The logical line a buffer row belongs to. xterm marks a row that continues the previous one
 *  `isWrapped`; this walks up to the row where the line began and down to where it ends. `text` is
 *  the rows joined as given; `startY` is the first row, for building the cell table (see
 *  bufferRangeAt). A getter, not an array, so only the rows touched are read. */
export function joinWrappedLine(
  getLine: (y: number) => { text: string; isWrapped: boolean } | undefined,
  y: number
): { text: string; startY: number } {
  let startY = y
  for (;;) {
    const row = getLine(startY)
    if (!row || !row.isWrapped || startY === 0) break
    startY -= 1
  }
  let text = ''
  for (let cur = startY; ; cur += 1) {
    const row = getLine(cur)
    if (!row) break
    text += row.text
    const next = getLine(cur + 1)
    if (!next || !next.isWrapped) break
  }
  return { text, startY }
}

/** Where each character of a joined line sits on screen — 1-based cells, as xterm's IBufferRange
 *  wants them. The provider builds this by walking the real cells (see RunPanel), because a
 *  character is not a column: xterm's translateToString emits one entry per glyph while the column
 *  cursor advances by the glyph's width, so an 80-column row of CJK yields a 40-character string and
 *  no arithmetic over `cols` can place it. */
export interface CharCell {
  x: number
  y: number
}

/** Where each character of a joined line sits, one entry per **UTF-16 code unit** of the text
 *  `joinWrappedLine` produced — `cells.length === text.length`, which is what bufferRangeAt's offsets
 *  index into. A cell is not a character in either direction: a wide glyph is two columns and one
 *  character, while an emoji or a combining sequence is one cell and two or more code units. xterm's
 *  own translateToString keeps the same books (it pushes one column per code unit into its optional
 *  out-parameter, which the public typings do not expose), so mirroring it here is what keeps the
 *  table and the text in step.
 *
 *  `getRow` reports a row's cells in column order: `width` 0 marks the trailing half of a wide glyph,
 *  which holds no characters, and `chars` is what that cell contributes ('' for a blank cell, which
 *  translateToString renders as one space — so an empty string counts as one character here). The walk
 *  stops where joinWrappedLine's does, on the row whose successor is not a continuation. */
export function cellsOfJoinedLine(
  getRow: (y: number) => { cells: readonly { width: number; chars: string }[]; isWrapped: boolean } | undefined,
  startY: number
): CharCell[] {
  const out: CharCell[] = []
  for (let row = startY; ; row += 1) {
    const line = getRow(row)
    if (!line) break
    for (let x = 0; x < line.cells.length; x += 1) {
      const cell = line.cells[x]
      if (cell.width === 0) continue // the trailing half of a wide glyph — no characters of its own
      const n = Math.max(cell.chars.length, 1) // a blank cell contributes one space
      for (let k = 0; k < n; k += 1) out.push({ x: x + 1, y: row + 1 })
    }
    const next = getRow(row + 1)
    if (!next || !next.isWrapped) break
  }
  return out
}

/** The buffer range covering `[start, end)` of the joined text, as an xterm IBufferRange (1-based,
 *  `end` inclusive). `cells` is one entry per character of that same text. A range whose start is
 *  past the table's end — the text and the table disagreeing, which should not happen — collapses to
 *  the last cell rather than throwing: a misplaced underline is better than a dead provider. */
export function bufferRangeAt(
  cells: readonly CharCell[],
  start: number,
  end: number
): { start: CharCell; end: CharCell } {
  if (cells.length === 0) return { start: { x: 1, y: 1 }, end: { x: 1, y: 1 } }
  const at = (i: number): CharCell => cells[Math.min(Math.max(i, 0), cells.length - 1)]
  return { start: at(start), end: at(Math.max(start, end - 1)) }
}

/** How near the right edge a row's content must reach for its last word to be read as cut there. A TUI wraps at the
 *  width of its own box, a few columns inside the terminal's (a border, a margin). */
const CUT_EDGE = 8
/** How many rows above and below the one under the pointer a cut word is followed across, each way on its own (final
 *  review I4): a path in a narrow split pane takes four or five rows. */
const CUT_ROWS_EACH_WAY = 5

type CutRow = { cells: readonly { width: number; chars: string }[]; isWrapped: boolean }

/** One way a word cut across rows reads joined: the text, where each of its characters sits (1-based, as
 *  bufferRangeAt wants), and the part on its first row, which a link of its own may already name whole. */
export interface CutCandidate {
  text: string
  cells: CharCell[]
  head: { text: string; cells: CharCell[] }
}

/**
 * The ways a word cut by a TUI across rows can read, for the row under the pointer.
 *
 * Claude Code wraps a long line itself and indents what follows (Ink's wrap, not the terminal's), so a path longer than
 * the room left is cut at its box's right edge and goes on, after spaces, on the next row; the terminal never marks
 * that row wrapped. A row whose content reaches within CUT_EDGE of the right edge and is followed by a row with
 * content is read as cut there. A candidate is the last word of one row, every row between taken whole (each a single
 * word, nothing else on it), and the first word of a later row, joined with no space; it covers the row under the
 * pointer. Words, not rows (final review I3): the prose before a path and the next list item after it stay out. Which
 * candidate names a file is the resolver's to say; the caller takes the longest that does, and prefers a link the
 * first row names by itself (final review I2).
 */
export function cutCandidates(getRow: (y: number) => CutRow | undefined, y: number, cols: number): CutCandidate[] {
  type Row = { cells: readonly { width: number; chars: string }[]; first: number; last: number; single: boolean }
  const memo = new Map<number, Row | null>()
  const blank = (c: { chars: string }): boolean => c.chars === '' || c.chars === ' '
  const rowAt = (r: number): Row | null => {
    if (memo.has(r)) return memo.get(r)!
    const raw = r >= 0 ? getRow(r) : undefined
    let row: Row | null = null
    if (raw) {
      const first = raw.cells.findIndex((c) => !blank(c))
      let last = -1
      for (let i = 0; i < raw.cells.length; i += 1) if (!blank(raw.cells[i])) last = i
      let single = first >= 0
      for (let i = first; single && i <= last; i += 1) if (blank(raw.cells[i]) && raw.cells[i].width !== 0) single = false
      row = { cells: raw.cells, first, last, single }
    }
    memo.set(r, row)
    return row
  }
  const cutAfter = (r: number): boolean => {
    const a = rowAt(r)
    const b = rowAt(r + 1)
    return !!a && !!b && a.last >= 0 && b.first >= 0 && a.last + 1 >= cols - CUT_EDGE
  }
  /** Characters of row `r` from cell `from` to `to` (inclusive), with where each sits. */
  const piece = (r: number, from: number, to: number): { text: string; cells: CharCell[] } => {
    const row = rowAt(r)!
    let text = ''
    const cells: CharCell[] = []
    for (let x = from; x <= to; x += 1) {
      const c = row.cells[x]
      if (c.width === 0) continue
      const chars = c.chars === '' ? ' ' : c.chars
      text += chars
      for (let k = 0; k < chars.length; k += 1) cells.push({ x: x + 1, y: r + 1 })
    }
    return { text, cells }
  }
  /** The last word of a row: from after its last blank to its last filled cell. */
  const lastWord = (r: number): { text: string; cells: CharCell[] } => {
    const row = rowAt(r)!
    let from = row.last
    while (from > 0 && !blank(row.cells[from - 1])) from -= 1
    return piece(r, from, row.last)
  }
  /** The first word of a row: from its first filled cell to before its next blank. */
  const firstWord = (r: number): { text: string; cells: CharCell[] } => {
    const row = rowAt(r)!
    let to = row.first
    while (to + 1 < row.cells.length && !blank(row.cells[to + 1])) to += 1
    return piece(r, row.first, to)
  }
  const out: CutCandidate[] = []
  // a: the row the word starts on (its last word); b: the row it ends on (its first word). Every row strictly between
  // is one word, and every row from a to b is cut into the next.
  for (let a = y; a >= Math.max(0, y - CUT_ROWS_EACH_WAY); a -= 1) {
    if (a < y && (!cutAfter(a) || (a + 1 < y && !rowAt(a + 1)!.single))) break
    for (let b = Math.max(y, a + 1); b <= y + CUT_ROWS_EACH_WAY; b += 1) {
      if (!cutAfter(b - 1)) break
      if (b - 1 > a && b - 1 >= y && !rowAt(b - 1)!.single) break
      const head = lastWord(a)
      let text = head.text
      const cells = [...head.cells]
      for (let r = a + 1; r < b; r += 1) {
        const whole = piece(r, rowAt(r)!.first, rowAt(r)!.last)
        text += whole.text
        cells.push(...whole.cells)
      }
      const tail = firstWord(b)
      text += tail.text
      cells.push(...tail.cells)
      out.push({ text, cells, head })
    }
  }
  return out
}
