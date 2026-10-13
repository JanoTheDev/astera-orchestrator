import type { ILink, Terminal } from '@xterm/xterm'
import { bufferRangeAt, cellsOfJoinedLine, cutCandidates, findConsoleLinks, joinWrappedLine, type CharCell } from '../../core/run/consoleLinks'

/** How long a target that did not resolve is believed. Long enough to absorb the stream of hover
 *  questions about one row (xterm re-asks on every mouse move across it); short enough that a path
 *  printed before its file was written — an agent's tool call naming the clip it is about to render —
 *  becomes a link the next time the pointer comes back. */
const MISS_TTL_MS = 5000

/** `resolve`, cached per target. A hit is kept for the terminal's life (a file that existed stays a
 *  link; following it to a deleted file is the opener's error to report). A miss — null or a
 *  rejection — is kept for `missTtlMs` only. A request still in flight is shared. `fresh` asks again
 *  whatever a miss said, for a pointer that came back to the name, and keeps what it finds. Exported for
 *  the test; `now` is a parameter for the same reason. */
export function cachedResolver(
  resolve: (target: string) => Promise<string | null>,
  now: () => number = Date.now,
  missTtlMs: number = MISS_TTL_MS
): ((target: string) => Promise<string | null>) & { fresh(target: string): Promise<string | null> } {
  const cache = new Map<string, { p: Promise<string | null>; missAt?: number }>()
  const ask = (target: string, afresh: boolean): Promise<string | null> => {
    const hit = cache.get(target)
    if (hit && (hit.missAt === undefined || (!afresh && now() - hit.missAt < missTtlMs))) return hit.p
    const entry: { p: Promise<string | null>; missAt?: number } = { p: Promise.resolve(null) }
    entry.p = resolve(target)
      .catch(() => null)
      .then((r) => {
        if (r === null) entry.missAt = now()
        return r
      })
    cache.set(target, entry)
    return entry.p
  }
  return Object.assign((target: string) => ask(target, false), { fresh: (target: string) => ask(target, true) })
}

/** The xterm link provider the run console, the project terminals and the session terminals share.
 *  Moved here from RunPanel unchanged in what it does; the one addition is that a URL's activation
 *  hands the mouse event on, so the caller can read Ctrl/Cmd (the link rule in core/preview/url.ts).
 *
 *  Path links exist only when `resolvePath` is given, and a target is a link only when it resolves —
 *  a link that cannot be followed is worse than no link. The run console resolves through
 *  run.resolveLink (its run's cwd, guarded, source roots tried); the session and project terminals
 *  through files.resolveLink (a session's agent directory then its cwd, or a project terminal's cwd;
 *  any regular file). Returns the dispose function. */
export function attachConsoleLinks(
  term: Terminal,
  opts: {
    onUrl: (url: string, event: MouseEvent) => void
    resolvePath?: (target: string) => Promise<string | null>
    onOpenFile?: (path: string, at: { line?: number; col?: number }) => void
  }
): () => void {
  const resolvePath = opts.resolvePath
  const resolve = resolvePath
    ? cachedResolver(resolvePath)
    : Object.assign((): Promise<string | null> => Promise.resolve(null), { fresh: (): Promise<string | null> => Promise.resolve(null) })
  /** A name the resolver cannot find yet: an agent prints a file's name, then writes or copies the file. xterm keeps a
   *  row's links while the pointer stays on that row, so a name that was no link at its first hover stayed none after
   *  the file appeared (bug report, 2026-10-13). It is a link with no underline and no pointer, so it reads as text;
   *  each time the pointer comes onto it the file is looked for again, and once found it is marked and opens. A link
   *  that cannot be followed still shows nothing and opens nothing. */
  const lateLink = (range: ILink['range'], target: string, at: { line?: number; col?: number }): ILink => {
    let found: string | null = null
    let hovered = false
    const link: ILink = {
      range,
      text: target,
      decorations: { underline: false, pointerCursor: false },
      hover: () => {
        hovered = true
        void (found !== null ? Promise.resolve(found) : resolve.fresh(target)).then((p) => {
          if (p === null) return
          found = p
          // xterm's setters act on its current link, so only while the pointer is still on this one.
          if (hovered && link.decorations) {
            link.decorations.underline = true
            link.decorations.pointerCursor = true
          }
        })
      },
      leave: () => {
        hovered = false
      },
      activate: () => {
        void (found !== null ? Promise.resolve(found) : resolve.fresh(target)).then((p) => {
          if (p !== null) opts.onOpenFile?.(p, at)
        })
      }
    }
    return link
  }
  const provider = term.registerLinkProvider({
    provideLinks: (y, callback) => {
      const buf = term.buffer.active
      // Untrimmed rows, so `text`'s length matches the cell table built below (which also doesn't trim)
      const getLine = (row: number): { text: string; isWrapped: boolean } | undefined => {
        const l = buf.getLine(row)
        return l ? { text: l.translateToString(false), isWrapped: l.isWrapped } : undefined
      }
      const { text, startY } = joinWrappedLine(getLine, y - 1) // y is 1-based, getLine 0-based
      const found = findConsoleLinks(text).filter((l) => l.kind === 'url' || opts.resolvePath)
      // One entry per code unit of `text`, from the real cells — see cellsOfJoinedLine for why a cell
      // is not a character in either direction. getNullCell gives the loop one object to reuse, which
      // is what IBufferLine.getCell's second parameter is for: this runs on every hover over the row.
      const cellBuf = buf.getNullCell()
      // Each row read once per hover, however many of the passes below ask for it (final review minor 7).
      const rowMemo = new Map<number, { cells: { width: number; chars: string }[]; isWrapped: boolean } | undefined>()
      const rowCells = (row: number): { cells: { width: number; chars: string }[]; isWrapped: boolean } | undefined => {
        if (rowMemo.has(row)) return rowMemo.get(row)
        const read = readRow(row)
        rowMemo.set(row, read)
        return read
      }
      const readRow = (row: number): { cells: { width: number; chars: string }[]; isWrapped: boolean } | undefined => {
        const line = buf.getLine(row)
        if (!line) return undefined
        const out: { width: number; chars: string }[] = []
        for (let x = 0; x < line.length; x += 1) {
          const c = line.getCell(x, cellBuf)
          if (!c) break
          out.push({ width: c.getWidth(), chars: c.getChars() })
        }
        return { cells: out, isWrapped: line.isWrapped }
      }
      // A path a TUI cut at the right edge and went on with after its indentation (cutCandidates): the ways it can read
      // joined, word by word. Only a link that crosses a cut and covers the row under the pointer (final review I1: xterm
      // drops a row's links that another row's link overlaps), only one the resolver finds, the longest of those, and
      // none where the first row's word names a file by itself (final review I2: a file and its line, then the next row's list number, is not a longer line number).
      const across = (resolvePath ? cutCandidates(rowCells, y - 1, term.cols) : []).flatMap((c) =>
        findConsoleLinks(c.text)
          .filter((l) => l.kind === 'path' && l.start < c.head.text.length && l.end > c.head.text.length)
          .map((l) => ({ l, range: bufferRangeAt(c.cells, l.start, l.end), head: findConsoleLinks(c.head.text).find((h) => h.kind === 'path' && h.start === l.start) }))
          .filter(({ range }) => range.start.y <= y && y <= range.end.y)
      )
      if (found.length === 0 && across.length === 0) {
        callback(undefined)
        return
      }
      const cells = cellsOfJoinedLine(rowCells, startY)
      const acrossLinks = Promise.all(
        across.map(async ({ l, range, head }): Promise<{ link: ILink; length: number } | null> => {
          if (l.kind !== 'path') return null
          if (head && head.kind === 'path' && (await resolve(head.target))) return null
          const path = await resolve(l.target)
          return path ? { link: { range, text: l.target, activate: () => opts.onOpenFile?.(path, { line: l.line, col: l.col }) }, length: l.target.length } : null
        })
      )
      void Promise.all([
        acrossLinks,
        Promise.all(
          found.map(async (l): Promise<ILink | null> => {
            const range = bufferRangeAt(cells, l.start, l.end)
            if (l.kind === 'url') {
              return { range, text: l.url, activate: (event) => opts.onUrl(l.url, event) }
            }
            const path = await resolve(l.target)
            if (!path) return lateLink(range, l.target, { line: l.line, col: l.col })
            return {
              range,
              text: l.target,
              activate: () => opts.onOpenFile?.(path, { line: l.line, col: l.col })
            }
          })
        )
      ])
        .then(([cutLinks, links]) => {
          const before = (a: CharCell, b: CharCell): boolean => a.y < b.y || (a.y === b.y && a.x <= b.x)
          const overlaps = (p: ILink, q: ILink): boolean => before(p.range.start, q.range.end) && before(q.range.start, p.range.end)
          // The longest whole path first; a shorter reading of the same cells (a prefix, a path plus the next word) goes.
          const whole: ILink[] = []
          for (const c of cutLinks.filter((x): x is { link: ILink; length: number } => x !== null).sort((p, q) => q.length - p.length))
            if (!whole.some((w) => overlaps(w, c.link))) whole.push(c.link)
          // A piece of a path that is linked whole is not a link of its own (it names a file only by chance).
          const rest = links.filter((l): l is ILink => l !== null && !whole.some((w) => overlaps(w, l)))
          const real = [...whole, ...rest]
          callback(real.length > 0 ? real : undefined)
        })
        .catch(() => callback(undefined))
    }
  })
  return () => provider.dispose()
}
