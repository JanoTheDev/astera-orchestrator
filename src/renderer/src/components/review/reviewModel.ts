// What the review view draws, read from a ChangeMap: files grouped by area, then each file's changed symbols, then the
// hunks under them. A hunk shows once, under the first symbol that claims it; hunks no symbol claims sit under `null`
// ("other changes"). Pure, so it is tested without a DOM.
import type { ChangeMap, ChangeMapFile, ChangeSymbol, ParsedHunk } from '../../../../core/review/changeMap'

export interface ReviewGroup {
  /** null: the hunks no symbol claims. */
  symbol: ChangeSymbol | null
  hunks: ParsedHunk[]
}

export interface ReviewFile {
  file: ChangeMapFile
  /** Every changed symbol of the file, for the map (a symbol whose hunks sit under another one is listed too). */
  symbols: ChangeSymbol[]
  groups: ReviewGroup[]
}

export interface ReviewArea {
  /** '' for the files at the repository root. */
  area: string
  files: ReviewFile[]
}

export interface ReviewModel {
  areas: ReviewArea[]
  /** Every hunk id in reading order: what `j` and `k` walk. */
  order: string[]
  /** hunk id → the file path it belongs to. */
  fileOf: Map<string, string>
}

const byPath = (a: { path: string }, b: { path: string }): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)

/** Areas by name (the root first), files by path, symbols as the map orders them (new side by line, then removed ones),
 *  hunks in diff order. */
export function reviewModel(map: Pick<ChangeMap, 'files' | 'symbols' | 'hunks'>): ReviewModel {
  const hunksOf = new Map<string, ParsedHunk[]>()
  for (const h of map.hunks) (hunksOf.get(h.path) ?? hunksOf.set(h.path, []).get(h.path)!).push(h)
  const symsOf = new Map<string, ChangeSymbol[]>()
  for (const s of map.symbols) (symsOf.get(s.path) ?? symsOf.set(s.path, []).get(s.path)!).push(s)

  const areas = new Map<string, ReviewFile[]>()
  for (const file of [...map.files].sort(byPath)) {
    const hunks = hunksOf.get(file.path) ?? []
    const symbols = symsOf.get(file.path) ?? []
    const byId = new Map(hunks.map((h) => [h.id, h]))
    const placed = new Set<string>()
    const groups: ReviewGroup[] = []
    for (const symbol of symbols) {
      const own = symbol.hunkIds.filter((id) => byId.has(id) && !placed.has(id))
      if (own.length === 0) continue
      own.forEach((id) => placed.add(id))
      groups.push({ symbol, hunks: hunks.filter((h) => own.includes(h.id)) })
    }
    const rest = hunks.filter((h) => !placed.has(h.id))
    if (rest.length > 0) groups.push({ symbol: null, hunks: rest })
    ;(areas.get(file.area) ?? areas.set(file.area, []).get(file.area)!).push({ file, symbols, groups })
  }

  const sorted = [...areas.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([area, files]) => ({ area, files }))
  const order: string[] = []
  const fileOf = new Map<string, string>()
  for (const a of sorted) for (const f of a.files) for (const g of f.groups) for (const h of g.hunks) (order.push(h.id), fileOf.set(h.id, f.file.path))
  return { areas: sorted, order, fileOf }
}

/** The hunk after (`+1`) or before (`-1`) `current` in reading order; the first or last when nothing is current. */
export function stepHunk(order: readonly string[], current: string | null, dir: 1 | -1): string | null {
  if (order.length === 0) return null
  const i = current === null ? -1 : order.indexOf(current)
  if (i < 0) return dir === 1 ? order[0] : order[order.length - 1]
  return order[Math.min(order.length - 1, Math.max(0, i + dir))]
}

/** The hunk a symbol scrolls to: the first of its hunks in reading order. */
export function anchorOf(symbol: ChangeSymbol, order: readonly string[]): string | null {
  const idx = symbol.hunkIds.map((id) => order.indexOf(id)).filter((i) => i >= 0)
  return idx.length > 0 ? order[Math.min(...idx)] : null
}

/** The new-file line range a hunk covers. A hunk that only removes lines points at the line it removed them after. */
export function hunkRange(h: Pick<ParsedHunk, 'newStart' | 'newLines'>): { start: number; end: number } {
  const start = Math.max(1, h.newStart)
  return { start, end: Math.max(start, h.newStart + h.newLines - 1) }
}

// ── Viewed files, kept per worktree. A file is viewed for the diff it had when it was marked: when its +/− change, the
// mark no longer holds, so new work is never hidden behind an old tick.

export type ViewedState = Readonly<Record<string, string>>
export type ViewedAction = { type: 'toggle'; file: ChangeMapFile } | { type: 'load'; state: ViewedState }

export const viewedSig = (f: Pick<ChangeMapFile, 'additions' | 'deletions' | 'status'>): string => `${f.status}:${f.additions}:${f.deletions}`

export const isViewed = (s: ViewedState, f: ChangeMapFile): boolean => s[f.path] === viewedSig(f)

export function viewedReducer(state: ViewedState, action: ViewedAction): ViewedState {
  if (action.type === 'load') return action.state
  const { [action.file.path]: _drop, ...rest } = state
  return isViewed(state, action.file) ? rest : { ...rest, [action.file.path]: viewedSig(action.file) }
}

export const viewedKey = (worktreePath: string): string => `astera.review.viewed:${worktreePath}`

/** The stored marks; anything unreadable is no marks. */
export function parseViewed(raw: string | null): ViewedState {
  if (!raw) return {}
  try {
    const v = JSON.parse(raw) as unknown
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return {}
    return Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string'))
  } catch {
    return {}
  }
}
