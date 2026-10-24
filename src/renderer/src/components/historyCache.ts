// What History last showed, kept in memory per window so a remount draws it at once and the fresh answer replaces
// it in place. The browser accumulates pages (append) and a window of unknown size, which a single-fetch
// useCachedRead key cannot hold, so the accumulated result is stored here under the same key scheme.
import type { HistoryEntry, ProjectSummary } from '../../../core/types'

export interface ProjectsSnap {
  projects: ProjectSummary[]
  total: number
}
export interface PageSnap {
  entries: HistoryEntry[]
  total: number
}

const MAX_PAGES = 100
const projectsSnaps = new Map<string, ProjectsSnap>()
const pageSnaps = new Map<string, PageSnap>()
let expandedMemo = new Set<string>()

export const projectsKey = (accountId: string, scoped: boolean): string => `history:projects:${accountId}:${scoped ? 'scoped' : 'all'}`
export const pageKey = (accountId: string, projectPath: string): string => `history:page:${accountId}:${projectPath}`

export const cachedProjects = (key: string): ProjectsSnap | undefined => projectsSnaps.get(key)
export const rememberProjects = (key: string, snap: ProjectsSnap): void => void projectsSnaps.set(key, snap)

export const cachedPage = (key: string): PageSnap | undefined => pageSnaps.get(key)
export function rememberPage(key: string, snap: PageSnap): void {
  pageSnaps.delete(key) // re-insert: Map order is the recency
  pageSnaps.set(key, snap)
  for (const k of pageSnaps.keys()) {
    if (pageSnaps.size <= MAX_PAGES) break
    pageSnaps.delete(k)
  }
}

export const rememberedExpanded = (): Set<string> => new Set(expandedMemo)
export const rememberExpanded = (s: ReadonlySet<string>): void => {
  expandedMemo = new Set(s)
}

export const mergePage = (before: HistoryEntry[], incoming: HistoryEntry[]): HistoryEntry[] => {
  const seen = new Set(before.map((e) => e.id))
  return [...before, ...incoming.filter((e) => !seen.has(e.id))]
}
export const mergeProjects = (before: ProjectSummary[], incoming: ProjectSummary[]): ProjectSummary[] => {
  const seen = new Set(before.map((x) => x.projectPath))
  return [...before, ...incoming.filter((x) => !seen.has(x.projectPath))]
}

/** For tests. */
export function forgetHistoryCache(): void {
  projectsSnaps.clear()
  pageSnaps.clear()
  expandedMemo = new Set()
}
