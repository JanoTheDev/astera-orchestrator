import type { ILink, Terminal } from '@xterm/xterm'
import { bufferRangeAt, cellsOfJoinedLine, cutCandidates, findConsoleLinks, joinWrappedLine, type CharCell, type ConsoleLink } from '../../core/run/consoleLinks'
import { mediaKindOf } from '../../core/files/media'

/** How long a target that did not resolve is believed. Long enough to absorb the stream of hover
 *  questions about one row (xterm re-asks on every mouse move across it); short enough that a path
 *  printed before its file was written — an agent's tool call naming the clip it is about to render —
 *  becomes a link the next time the pointer comes back. */
const MISS_TTL_MS = 5000

/** How soon after a miss a pointer coming back onto a media name asks for it again (`fresh`): the hover that follows the
 *  miss which made the link, and a hover per repaint of a row a TUI keeps redrawing, answer from that miss instead of
 *  asking main each time. */
export const LATE_RECHECK_MS = 500

/** The ways a path link can read, in the order they are tried: the whole token, then the same path without a word a
 *  sentence glued to it (`...png입니다.`, consoleLinks.ts GLUED_WORD), over its own cells. */
const readingsOf = (l: ConsoleLink): Array<{ target: string; end: number; line?: number; col?: number }> =>
  l.kind === 'path' ? [{ target: l.target, end: l.end, line: l.line, col: l.col }, ...(l.alt ? [l.alt] : [])] : []

/** `resolve`, cached per target. A hit is kept for the terminal's life (a file that existed stays a
 *  link; following it to a deleted file is the opener's error to report). A miss — null or a
 *  rejection — is kept for `missTtlMs` only. A request still in flight is shared. `fresh` asks again
 *  sooner, for a pointer that came back onto a media name: once a miss is `freshFloorMs` old. What it
 *  finds is kept like any hit. Exported for the test; `now` is a parameter for the same reason. */
export function cachedResolver(
  resolve: (target: string) => Promise<string | null>,
  now: () => number = Date.now,
  missTtlMs: number = MISS_TTL_MS,
  freshFloorMs: number = LATE_RECHECK_MS
): ((target: string) => Promise<string | null>) & { fresh(target: string): Promise<string | null> } {
  const cache = new Map<string, { p: Promise<string | null>; missAt?: number }>()
  const ask = (target: string, afresh: boolean): Promise<string | null> => {
    const hit = cache.get(target)
    const keepFor = afresh ? freshFloorMs : missTtlMs
    if (hit && (hit.missAt === undefined || now() - hit.missAt < keepFor)) return hit.p
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
 *  a link that cannot be followed is worse than no link. One exception keeps that promise in what it
 *  shows: a media name not found yet is a link with no underline and no pointer, which marks itself
 *  when the pointer comes back and the file is there (lateLink). The run console resolves through
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
  /** A media name the resolver cannot find yet: an agent prints the name of an image or a video, then writes or copies
   *  the file. xterm keeps a row's links while the pointer stays on that row, so a name that was no link at its first
   *  hover stayed none after the file appeared (bug report, 2026-10-13). It is a link with no underline and no pointer,
   *  so it reads as text; each time the pointer comes onto it the file is looked for again (no sooner than
   *  LATE_RECHECK_MS after the last miss), and once found it is marked. It opens only once marked: nothing opens that
   *  was never shown as a link (late-link review M2). Media names only (review I1): xterm's double-click selects its
   *  current link whole, so a path that is no file must stay plain text. */
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
        if (found !== null) opts.onOpenFile?.(found, at)
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
      // Each reading of a link (readingsOf) is a candidate of its own; the longest one found wins below.
      const across = (resolvePath ? cutCandidates(rowCells, y - 1, term.cols) : []).flatMap((c) =>
        findConsoleLinks(c.text)
          .flatMap((l) => readingsOf(l).map((r) => ({ l, r })))
          .filter(({ l, r }) => l.start < c.head.text.length && r.end > c.head.text.length)
          .map(({ l, r }) => ({ r, range: bufferRangeAt(c.cells, l.start, r.end), head: findConsoleLinks(c.head.text).find((h) => h.kind === 'path' && h.start === l.start) }))
          .filter(({ range }) => range.start.y <= y && y <= range.end.y)
      )
      if (found.length === 0 && across.length === 0) {
        callback(undefined)
        return
      }
      const cells = cellsOfJoinedLine(rowCells, startY)
      const acrossLinks = Promise.all(
        across.map(async ({ r, range, head }): Promise<{ link: ILink; length: number } | null> => {
          if (head && head.kind === 'path' && (await resolve(head.target))) return null
          const path = await resolve(r.target)
          return path ? { link: { range, text: r.target, activate: () => opts.onOpenFile?.(path, { line: r.line, col: r.col }) }, length: r.target.length } : null
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
            // The whole token first, then the path without a word glued to it, each over its own cells
            const readings = readingsOf(l).map((r) => ({ ...r, range: r.end === l.end ? range : bufferRangeAt(cells, l.start, r.end) }))
            for (const r of readings) {
              const path = await resolve(r.target)
              if (path) return { range: r.range, text: r.target, activate: () => opts.onOpenFile?.(path, { line: r.line, col: r.col }) }
            }
            // A media name not there yet (lateLink): the reading that is one, the shorter first, since a word glued to a
            // media name is what keeps the whole from being one
            const media = [...readings].reverse().find((r) => mediaKindOf(r.target) !== null)
            return media ? lateLink(media.range, media.target, { line: media.line, col: media.col }) : null
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
