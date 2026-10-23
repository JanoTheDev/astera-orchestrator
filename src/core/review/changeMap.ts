// The change map of a worktree against its base: files, the symbols that changed, import edges between the changed
// files and the raw hunks, all read from a unified diff and the new file contents. No AI, no git, no node: the main
// process feeds it the text and the renderer imports its types.
// node: import 없음 — 렌더러가 import한다.

export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed'
export type SymbolKind = 'function' | 'class' | 'method' | 'const' | 'type' | 'interface' | 'context'

export interface ParsedHunk {
  /** `h1`, `h2`, … in diff order across the whole diff. */
  id: string
  path: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  /** Text after the closing `@@` (git's guess at the enclosing function). */
  header: string
  /** The hunk as git printed it, `@@` line included. */
  text: string
}

export interface ParsedFile {
  path: string
  oldPath?: string
  status: ChangeStatus
  binary: boolean
  additions: number
  deletions: number
  hunks: ParsedHunk[]
}

export interface ChangeSymbol {
  path: string
  name: string
  kind: SymbolKind
  change: 'added' | 'removed' | 'modified'
  /** `old`: the range is in the old file (a removed symbol). */
  side: 'new' | 'old'
  start: number
  end: number
  hunkIds: string[]
}

export interface ChangeEdge {
  from: string
  to: string
  /** The import line itself was added. */
  new: boolean
}

export interface ChangeMapFile {
  path: string
  oldPath?: string
  status: ChangeStatus
  additions: number
  deletions: number
  /** The first two folders, for grouping; '' for a file at the root. */
  area: string
  /** Not analysed: a binary file, or one past the size limit (its diff, or for imports its content). */
  skipped?: 'binary' | 'large'
}

export interface ChangeMap {
  files: ChangeMapFile[]
  symbols: ChangeSymbol[]
  edges: ChangeEdge[]
  hunks: ParsedHunk[]
  /** How many files changed; `files` holds at most `maxFiles` of them. */
  total: number
}

/** Past this a file's diff or content is not analysed. */
export const CHANGE_MAP_MAX_BYTES = 1024 * 1024
export const CHANGE_MAP_MAX_FILES = 2_000
/** What `readNew` answers for a file it did not read because it is past the size limit: the map then says `large`. */
export const CONTENT_TOO_LARGE = Symbol('content-too-large')
export type ReadNew = (path: string) => string | typeof CONTENT_TOO_LARGE | null | undefined

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/
const stripSide = (p: string): string => p.replace(/^[ab]\//, '')

export function parseUnifiedDiff(text: string): ParsedFile[] {
  const files: ParsedFile[] = []
  const lines = text.split('\n')
  let hunkNo = 0
  let f: ParsedFile | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line)
      f = { path: m ? m[2] : '', status: 'modified', binary: false, additions: 0, deletions: 0, hunks: [] }
      if (m && m[1] !== m[2]) f.oldPath = m[1]
      files.push(f)
      continue
    }
    if (!f) continue
    const h = HUNK_RE.exec(line)
    if (h) {
      const hunk: ParsedHunk = {
        id: `h${++hunkNo}`,
        path: f.path,
        oldStart: Number(h[1]),
        oldLines: h[2] === undefined ? 1 : Number(h[2]),
        newStart: Number(h[3]),
        newLines: h[4] === undefined ? 1 : Number(h[4]),
        header: h[5],
        text: ''
      }
      const body = [line]
      let oldLeft = hunk.oldLines
      let newLeft = hunk.newLines
      while (i + 1 < lines.length && (oldLeft > 0 || newLeft > 0 || lines[i + 1].startsWith('\\'))) {
        const l = lines[++i]
        body.push(l)
        if (l.startsWith('+')) (f.additions++, newLeft--)
        else if (l.startsWith('-')) (f.deletions++, oldLeft--)
        else if (!l.startsWith('\\')) (oldLeft--, newLeft--)
      }
      hunk.text = body.join('\n') + '\n'
      f.hunks.push(hunk)
      continue
    }
    if (line.startsWith('new file mode')) f.status = 'added'
    else if (line.startsWith('deleted file mode')) f.status = 'deleted'
    else if (line.startsWith('rename from ')) (f.status = 'renamed', (f.oldPath = line.slice(12)))
    else if (line.startsWith('rename to ')) f.path = line.slice(10)
    else if (line.startsWith('copy to ')) (f.status = 'added', (f.path = line.slice(8)), delete f.oldPath)
    else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) f.binary = true
    else if (line.startsWith('--- ') && line.slice(4) === '/dev/null') f.status = 'added'
    else if (line.startsWith('+++ ')) {
      const p = line.slice(4)
      if (p === '/dev/null') f.status = 'deleted'
      else f.path = stripSide(p)
    } else if (line.startsWith('--- ') && f.status === 'deleted') f.path = stripSide(line.slice(4))
  }
  for (const file of files) for (const hunk of file.hunks) hunk.path = file.path
  return files
}

const TS_JS_RE = /\.(?:[cm]?[jt]sx?)$/
const isTsJs = (path: string): boolean => TS_JS_RE.test(path)

interface Decl {
  name: string
  kind: SymbolKind
}

const METHOD_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'else', 'with', 'function', 'new', 'typeof', 'await'])

/** A declaration that starts at column 0. shortcut: line regexes, not a parser; a declaration split over lines
 *  before its name is missed — upgrade to a TS parser if that matters. */
function topDecl(line: string): Decl | null {
  let m = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([\w$]+)/.exec(line)
  if (m) return { name: m[1], kind: 'function' }
  m = /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([\w$]+)/.exec(line)
  if (m) return { name: m[1], kind: 'class' }
  m = /^(?:export\s+)?(?:declare\s+)?interface\s+([\w$]+)/.exec(line)
  if (m) return { name: m[1], kind: 'interface' }
  m = /^(?:export\s+)?(?:declare\s+)?(?:const\s+)?(?:type|enum)\s+([\w$]+)(?=[\s<={])/.exec(line)
  if (m) return { name: m[1], kind: 'type' }
  m = /^(export\s+)?(?:const|let|var)\s+([\w$]+)(.*)$/.exec(line)
  if (m) {
    const fn = /=\s*(?:async\s*)?(?:function\b|(?:\([^)]*\)|[\w$]+)\s*(?::[^=]+)?=>)/.test(m[3])
    if (fn) return { name: m[2], kind: 'function' }
    if (m[1]) return { name: m[2], kind: 'const' }
  }
  return null
}

function methodDecl(line: string): Decl | null {
  const m = /^\s+(?:(?:public|private|protected|static|async|readonly|override|abstract|get|set)\s+)*\*?\s*([A-Za-z_$#][\w$]*)\s*(?:<[^>]*>)?\s*\(/.exec(line)
  return m && !METHOD_KEYWORDS.has(m[1]) ? { name: m[1], kind: 'method' } : null
}

/** Brackets counted outside strings and line comments. shortcut: block comments and regex literals are not skipped. */
function bracketBalance(line: string): number {
  const code = line.replace(/\/\/.*$/, '').replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, '')
  let n = 0
  for (const c of code) n += c === '{' || c === '(' || c === '[' ? 1 : c === '}' || c === ')' || c === ']' ? -1 : 0
  return n
}

/** The 0-based line a declaration starting at `from` ends on. */
function endOf(lines: string[], from: number): number {
  let bal = 0
  for (let j = from; j < lines.length; j++) {
    bal += bracketBalance(lines[j])
    if (bal <= 0 && !/(?:=|=>|\||&|\?|\+|,)\s*$/.test(lines[j])) return j
  }
  return lines.length - 1
}

interface Located extends Decl {
  start: number
  end: number
}

/** Every declaration in a TS/JS text with its 1-based line range. A method counts only directly inside a class. */
function declsOf(text: string): Located[] {
  const lines = text.split('\n')
  const out: Located[] = []
  for (let i = 0; i < lines.length; i++) {
    let d = topDecl(lines[i])
    if (!d && /^\s/.test(lines[i])) {
      const parent = [...out].reverse().find((o) => o.end >= i + 1)
      if (parent?.kind === 'class') d = methodDecl(lines[i])
    }
    if (d) out.push({ ...d, start: i + 1, end: endOf(lines, i) + 1 })
  }
  return out
}

interface Entry {
  k: '+' | '-' | ' '
  text: string
  oldLn: number
  newLn: number
  hunkId: string
}

function entriesOf(hunks: ParsedHunk[]): Entry[] {
  const out: Entry[] = []
  for (const h of hunks) {
    let o = h.oldStart
    let n = h.newStart
    for (const l of h.text.split('\n').slice(1)) {
      const c = l[0]
      if (c === '+') out.push({ k: '+', text: l.slice(1), oldLn: o, newLn: n++, hunkId: h.id })
      else if (c === '-') out.push({ k: '-', text: l.slice(1), oldLn: o++, newLn: n, hunkId: h.id })
      else if (c === ' ') (out.push({ k: ' ', text: l.slice(1), oldLn: o++, newLn: n++, hunkId: h.id }))
    }
  }
  return out
}

/** The last line of the run of `k` entries that starts at `i`, as a line number of that side. */
function runEnd(es: Entry[], i: number, k: '+' | '-'): number {
  let j = i
  while (j + 1 < es.length && es[j + 1].k === k && es[j + 1].hunkId === es[i].hunkId) j++
  return k === '+' ? es[j].newLn : es[j].oldLn
}

/** The functions, classes, methods, exported consts, types and interfaces a file's diff added, removed or modified.
 *  With the new text (TS/JS) a changed line belongs to the innermost declaration around it; without it only the hunk
 *  headers and the declarations on added or removed lines are read. Other languages get the header context only. */
export function symbolsOf(file: ParsedFile, newText?: string): ChangeSymbol[] {
  const ts = isTsJs(file.path)
  const es = entriesOf(file.hunks)
  const found = new Map<string, ChangeSymbol>()
  const put = (s: ChangeSymbol): void => {
    const key = `${s.kind}:${s.name}:${s.change}`
    const had = found.get(key)
    if (!had) return void found.set(key, s)
    had.hunkIds = [...new Set([...had.hunkIds, ...s.hunkIds])]
    had.start = Math.min(had.start, s.start)
    had.end = Math.max(had.end, s.end)
  }
  const sym = (d: Decl, change: ChangeSymbol['change'], start: number, end: number, hunkIds: string[]): ChangeSymbol => ({
    path: file.path, name: d.name, kind: d.kind, change, side: change === 'removed' ? 'old' : 'new', start, end, hunkIds
  })

  const removedDecls = ts ? es.flatMap((e, i) => (e.k === '-' && topDecl(e.text) ? [{ i, d: topDecl(e.text)! }] : [])) : []
  const hasNew = (d: Decl, news: Decl[]): boolean => news.some((n) => n.name === d.name && n.kind === d.kind)

  if (ts && newText !== undefined) {
    const decls = declsOf(newText)
    const total = newText.split('\n').length
    const touched = new Map<Located, Set<string>>()
    for (const e of es) {
      if (e.k === ' ') continue
      const line = Math.min(Math.max(e.newLn, 1), total)
      const inner = decls.filter((d) => d.start <= line && line <= d.end).sort((a, b) => b.start - a.start)[0]
      if (inner) (touched.get(inner) ?? touched.set(inner, new Set()).get(inner)!).add(e.hunkId)
    }
    const addedLines = new Set(es.filter((e) => e.k === '+').map((e) => e.newLn))
    for (const [d, ids] of touched) {
      const fresh = addedLines.has(d.start) && !removedDecls.some((r) => r.d.name === d.name && r.d.kind === d.kind)
      put(sym(d, fresh ? 'added' : 'modified', d.start, d.end, [...ids]))
    }
    for (const r of removedDecls) {
      if (hasNew(r.d, decls)) continue
      put(sym(r.d, 'removed', es[r.i].oldLn, runEnd(es, r.i, '-'), [es[r.i].hunkId]))
    }
  } else {
    const added = ts ? es.flatMap((e, i) => (e.k === '+' && topDecl(e.text) ? [{ i, d: topDecl(e.text)! }] : [])) : []
    for (const h of file.hunks) {
      const header = h.header.trim()
      if (!header) continue
      const d = ts ? topDecl(header) : null
      const end = Math.max(h.newStart, h.newStart + h.newLines - 1)
      if (d) {
        if (!hasNew(d, added.map((a) => a.d)) && !hasNew(d, removedDecls.map((r) => r.d))) put(sym(d, 'modified', h.newStart, end, [h.id]))
      } else put(sym({ name: header, kind: 'context' }, 'modified', h.newStart, end, [h.id]))
    }
    for (const a of added) put(sym(a.d, 'added', es[a.i].newLn, runEnd(es, a.i, '+'), [es[a.i].hunkId]))
    for (const r of removedDecls) put(sym(r.d, 'removed', es[r.i].oldLn, runEnd(es, r.i, '-'), [es[r.i].hunkId]))
  }
  return [...found.values()].sort((a, b) => (a.side === b.side ? a.start - b.start : a.side === 'new' ? -1 : 1))
}

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.json']
const JS_TO_TS: Record<string, string[]> = { '.js': ['.ts', '.tsx'], '.jsx': ['.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] }

function dirOf(p: string): string {
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : p.slice(0, i)
}

/** `./x` against `dir`, with `..` and `.` folded. null: it leaves the repo root. */
function joinPath(dir: string, spec: string): string | null {
  const out = dir === '' ? [] : dir.split('/')
  for (const seg of spec.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.pop() === undefined) return null
    } else out.push(seg)
  }
  return out.join('/')
}

/** The changed file a relative specifier points at: as written, with an extension, a `.js` for its `.ts`, or an index. */
function resolveSpec(from: string, spec: string, changed: Set<string>): string | null {
  const base = joinPath(dirOf(from), spec)
  if (base === null) return null
  const ext = /\.[a-z]+$/.exec(base)?.[0] ?? ''
  const swapped = (JS_TO_TS[ext] ?? []).map((e) => base.slice(0, -ext.length) + e)
  const tries = [base, ...swapped, ...EXTENSIONS.map((e) => base + e), ...EXTENSIONS.map((e) => `${base}/index${e}`)]
  return tries.find((t) => changed.has(t)) ?? null
}

const IMPORT_RES = [
  /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[^'"`;]*?\sfrom\s*)?(['"])([^'"\n]+)\1/g,
  /\b(?:require|import)\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g
]

/** Import and require links between the changed files, from the new text of each. `new`: the import line was added
 *  and the old file did not import the same specifier. shortcut: relative specifiers only; tsconfig path aliases are
 *  not resolved, so an `@/x` import draws no edge. */
export function importEdges(files: ParsedFile[], readNew: (path: string) => string | null | undefined): ChangeEdge[] {
  const changed = new Set(files.filter((f) => f.status !== 'deleted').map((f) => f.path))
  const edges: ChangeEdge[] = []
  for (const f of files) {
    if (f.status === 'deleted' || !isTsJs(f.path)) continue
    const text = readNew(f.path)
    if (text == null) continue
    const es = entriesOf(f.hunks)
    const addedLines = new Set(es.filter((e) => e.k === '+').map((e) => e.newLn))
    const removedSpecs = new Set<string>()
    for (const e of es) {
      if (e.k !== '-') continue
      for (const re of IMPORT_RES) for (const m of e.text.matchAll(new RegExp(re.source, 'g'))) removedSpecs.add(m[2])
    }
    const lineAt = (idx: number): number => text.slice(0, idx).split('\n').length
    const seen = new Set<string>()
    for (const re of IMPORT_RES) {
      for (const m of text.matchAll(new RegExp(re.source, 'g'))) {
        const spec = m[2]
        if (!spec.startsWith('.')) continue
        const to = resolveSpec(f.path, spec, changed)
        if (to === null || to === f.path || seen.has(to)) continue
        seen.add(to)
        const first = lineAt(m.index + (m[0].length - m[0].trimStart().length))
        const specLine = lineAt(m.index + m[0].lastIndexOf(spec))
        const isNew = (addedLines.has(first) || addedLines.has(specLine)) && !removedSpecs.has(spec)
        edges.push({ from: f.path, to, new: isNew })
      }
    }
  }
  return edges
}

/** The first two folders of a path: what the map groups files by. */
const areaOf = (path: string): string => dirOf(path).split('/').filter(Boolean).slice(0, 2).join('/')

const diffBytes = (f: ParsedFile): number => f.hunks.reduce((n, h) => n + h.text.length, 0)

export function buildChangeMap(
  diffText: string,
  readNew: ReadNew,
  opts: { maxBytes?: number; maxFiles?: number } = {}
): ChangeMap {
  const maxBytes = opts.maxBytes ?? CHANGE_MAP_MAX_BYTES
  const all = parseUnifiedDiff(diffText)
  const parsed = all.slice(0, opts.maxFiles ?? CHANGE_MAP_MAX_FILES)
  const bigContent = new Set<string>()
  const read = (path: string): string | undefined => {
    const t = readNew(path)
    if (t == null) return undefined
    if (t === CONTENT_TOO_LARGE || t.length > maxBytes) return void bigContent.add(path)
    return t
  }
  const symbols: ChangeSymbol[] = []
  const hunks: ParsedHunk[] = []
  const skipped = new Map<string, 'binary' | 'large'>()
  const kept: ParsedFile[] = []
  for (const f of parsed) {
    if (f.binary) skipped.set(f.path, 'binary')
    else if (diffBytes(f) > maxBytes) skipped.set(f.path, 'large')
    const analysable = !skipped.has(f.path)
    kept.push(analysable ? f : { ...f, hunks: [] })
    if (!analysable) continue
    hunks.push(...f.hunks)
    symbols.push(...symbolsOf(f, f.status !== 'deleted' && isTsJs(f.path) ? read(f.path) : undefined))
  }
  const edges = importEdges(kept, read)
  for (const p of bigContent) if (!skipped.has(p)) skipped.set(p, 'large')
  const files = parsed.map((f): ChangeMapFile => {
    const s = skipped.get(f.path)
    return {
      path: f.path,
      ...(f.oldPath !== undefined ? { oldPath: f.oldPath } : {}),
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      area: areaOf(f.path),
      ...(s ? { skipped: s } : {})
    }
  })
  return { files, symbols, edges, hunks, total: all.length }
}
