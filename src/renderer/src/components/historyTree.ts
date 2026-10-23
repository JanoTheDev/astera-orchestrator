// The Sessions tree's rows (DESIGN-W13 §4): Project › session, newest first. Pure, so the grouping is testable without
// a renderer; HistoryBrowser keeps the fetching and maps these rows onto Tree items.
import type { HistoryEntry, ProjectSummary } from '../../../core/types'

export type SessionRow =
  | { kind: 'project'; id: string; project: ProjectSummary; expanded: boolean }
  | { kind: 'session'; id: string; entry: HistoryEntry }
  /** a project whose first session page has not arrived: a placeholder, so "not loaded" never reads as "none" */
  | { kind: 'loading'; id: string }
  | { kind: 'empty'; id: string }
  /** the next page of a project's sessions (`projectPath` set) or of the projects themselves (unset) */
  | { kind: 'more'; id: string; projectPath?: string }

/** The row id of a project; sessions use their entry id, which cannot collide with a path. */
export const projectRowId = (projectPath: string): string => `project:${projectPath}`

const newestFirst = <T>(items: readonly T[], at: (x: T) => string): T[] => [...items].sort((a, b) => at(b).localeCompare(at(a)))

export type SessionPage = { entries: readonly HistoryEntry[]; total: number }

/** Projects newest first, each followed by its sessions (newest first) when expanded. `sessionsOf` returns undefined
 *  while a project's first page is in flight. A trailing `more` row stands for each page not yet fetched. */
export function sessionTreeRows(
  projects: readonly ProjectSummary[],
  expanded: ReadonlySet<string>,
  sessionsOf: (projectPath: string) => SessionPage | undefined,
  moreProjects = false
): SessionRow[] {
  const rows: SessionRow[] = []
  for (const project of newestFirst(projects, (p) => p.updatedAt)) {
    const open = expanded.has(project.projectPath)
    rows.push({ kind: 'project', id: projectRowId(project.projectPath), project, expanded: open })
    if (!open) continue
    const page = sessionsOf(project.projectPath)
    if (!page) rows.push({ kind: 'loading', id: `loading:${project.projectPath}` })
    else if (page.entries.length === 0) rows.push({ kind: 'empty', id: `empty:${project.projectPath}` })
    else {
      for (const entry of newestFirst(page.entries, (e) => e.updatedAt)) rows.push({ kind: 'session', id: entry.id, entry })
      if (page.entries.length < page.total) rows.push({ kind: 'more', id: `more:${project.projectPath}`, projectPath: project.projectPath })
    }
  }
  if (moreProjects) rows.push({ kind: 'more', id: 'more:' })
  return rows
}
