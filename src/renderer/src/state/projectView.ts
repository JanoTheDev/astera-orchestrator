// What a view shows of the other projects: nothing, unless the title bar's switcher is on "All projects". The title
// bar's selection (`workspaceProjectId`) is the window's one current project; every view reads what is derived from it
// here. The tree lists workspaces only, so a sub-project's plans are already its root's.
import type { Project } from '../../../core/orchestration/types'
import { OTHER_WORKSPACE, projectOfCwd, type WorkspaceData, type WorkspaceProject } from './workspaceTree'

/** The scope of a window whose project is not known (none open, or a folder no project holds): it matches no
 *  project. Never null, which means every project. */
export const UNKNOWN_PROJECT = ''

/** What the title bar's selection means for every view. */
export interface ProjectScopeView {
  /** The selected id: a project or sub-project id, OTHER_WORKSPACE, or null for All projects. */
  projectId: string | null
  /** The selected project once the project list is read; undefined for All, Other, or an id no project has. */
  project: Project | undefined
  /** The folder views work in: the selected project's root (a sub-project's is its workspace's). Null for All and Other. */
  path: string | null
  isAll: boolean
  /** The workspace id a view is limited to (scopeData, scopeTree, scopeSessions): a sub-project's workspace, null for
   *  All, UNKNOWN_PROJECT for an id no project has. */
  scopeId: string | null
}

/** The scope derived from the title bar's selection. `projects` is null until the project list is read; until then a
 *  selected project's folder is `remembered` (its last path, stickyProject), so the first frame is not empty. */
export function projectScopeOf(projects: readonly Project[] | null, selectedId: string | null, remembered: string | null): ProjectScopeView {
  if (selectedId === null) return { projectId: null, project: undefined, path: null, isAll: true, scopeId: null }
  if (selectedId === OTHER_WORKSPACE) return { projectId: selectedId, project: undefined, path: null, isAll: false, scopeId: UNKNOWN_PROJECT }
  if (projects === null) return { projectId: selectedId, project: undefined, path: remembered, isAll: false, scopeId: selectedId }
  const project = projects.find((p) => p.id === selectedId)
  return { projectId: selectedId, project, path: project?.path ?? null, isAll: false, scopeId: project ? (project.parentId ?? project.id) : UNKNOWN_PROJECT }
}

/** The selection once the active tab names its project (`owner`, null when it names none): the title bar follows a tab
 *  of another project rather than the views drifting from it. All projects stays All. */
export const selectionAfterFocus = (selected: string | null, owner: string | null): string | null =>
  selected === null || owner === null ? selected : owner

export const scopeTree = (tree: readonly WorkspaceProject[], scopeId: string | null): WorkspaceProject[] =>
  scopeId === null ? [...tree] : tree.filter((p) => p.id === scopeId)

/** The data of the scoped projects only: their Jobs, and what hangs off those (Runs, Tasks, Dispatches, Gates,
 *  escalations). Worktrees stay whole: they only resolve a folder to its project. */
export function scopeData(d: WorkspaceData, scopeId: string | null): WorkspaceData {
  if (scopeId === null) return d
  const jobsByProject = Object.fromEntries(Object.entries(d.jobsByProject).filter(([id]) => id === scopeId))
  const jobIds = new Set(Object.values(jobsByProject).flat().map((j) => j.id))
  const runs = d.runs.filter((r) => jobIds.has(r.jobId))
  const runIds = new Set(runs.map((r) => r.id))
  const tasks = d.tasks.filter((t) => (t.runId !== undefined && runIds.has(t.runId)) || (t.jobId !== undefined && jobIds.has(t.jobId)))
  const taskIds = new Set(tasks.map((t) => t.id))
  return {
    ...d,
    projects: d.projects.filter((p) => p.id === scopeId || p.parentId === scopeId),
    jobsByProject,
    runs,
    tasks,
    dispatches: d.dispatches.filter((x) => taskIds.has(x.taskId)),
    gates: d.gates.filter((g) => runIds.has(g.runId)),
    ...(d.escalations ? { escalations: d.escalations.filter((m) => runIds.has(m.runId)) } : {})
  }
}

/** The sessions the status bar counts: those of the scoped project's workspace (workspaceSessionIds), all when unscoped. */
export function scopeSessions<S extends { id: string }>(
  sessions: readonly S[],
  byWorkspace: ReadonlyMap<string, ReadonlySet<string>>,
  scopeId: string | null
): S[] {
  if (scopeId === null) return [...sessions]
  const ids = byWorkspace.get(scopeId === UNKNOWN_PROJECT ? OTHER_WORKSPACE : scopeId)
  return sessions.filter((s) => ids?.has(s.id))
}

/** Whether a worktree of this repo shows: the repo is the scoped project's (or sub-project's workspace root). */
export const repoInScope = (tree: readonly WorkspaceProject[], scopeId: string | null, repoPath: string): boolean =>
  scopeId === null || projectOfCwd(repoPath, tree, []) === scopeId
