// The Sessions tree's rows (DESIGN-W13 §4, History): Project › session, newest first. Pure, so the grouping and the
// "still loading" / "none" states are testable without the data fetching HistoryBrowser does.
import type { HistoryEntry, ProjectSummary } from '../../../../core/types'

/** One project's sessions as the pages have delivered them so far. */
export type SessionSlice = { entries: HistoryEntry[]; total: number; loaded: boolean }

export type SessionRow =
  | { kind: 'project'; id: string; depth: 0; project: ProjectSummary; expanded: boolean }
  | { kind: 'session'; id: string; depth: 1; entry: HistoryEntry }
  /** The project's first page is in flight: not "none yet", which is a different row. */
  | { kind: 'loading'; id: string; depth: 1; projectPath: string }
  | { kind: 'empty'; id: string; depth: 1; projectPath: string }
  /** More sessions of the project (`depth` 1) or more projects (`depth` 0) than the pages so far. */
  | { kind: 'more'; id: string; depth: 0 | 1; projectPath?: string }

export const projectRowId = (projectPath: string): string => `p:${projectPath}`
export const sessionRowId = (entryId: string): string => `s:${entryId}`

const newestFirst = <T extends { updatedAt: string }>(a: T, b: T): number => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0)

export function sessionRows(
  projects: ProjectSummary[],
  slices: Record<string, SessionSlice | undefined>,
  expanded: ReadonlySet<string>,
  moreProjects: boolean
): SessionRow[] {
  const rows: SessionRow[] = []
  for (const project of [...projects].sort(newestFirst)) {
    const open = expanded.has(project.projectPath)
    rows.push({ kind: 'project', id: projectRowId(project.projectPath), depth: 0, project, expanded: open })
    if (!open) continue
    const slice = slices[project.projectPath]
    if (!slice?.loaded) {
      rows.push({ kind: 'loading', id: `l:${project.projectPath}`, depth: 1, projectPath: project.projectPath })
      continue
    }
    if (slice.entries.length === 0) rows.push({ kind: 'empty', id: `e:${project.projectPath}`, depth: 1, projectPath: project.projectPath })
    for (const entry of [...slice.entries].sort(newestFirst)) rows.push({ kind: 'session', id: sessionRowId(entry.id), depth: 1, entry })
    if (slice.entries.length < slice.total) rows.push({ kind: 'more', id: `m:${project.projectPath}`, depth: 1, projectPath: project.projectPath })
  }
  if (moreProjects) rows.push({ kind: 'more', id: 'm:', depth: 0 })
  return rows
}
