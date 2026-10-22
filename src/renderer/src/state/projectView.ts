// What a view shows of the other projects: nothing, unless "All projects" is on. The window's open project is the
// one `currentProject` names; the tree lists workspaces only, so a sub-project's plans are already its root's.
import { OTHER_WORKSPACE, projectOfCwd, type WorkspaceData, type WorkspaceProject, type WorktreeRef } from './workspaceTree'

/** The scope of a window whose project is not known (none open, or a folder no project holds): it matches no
 *  project. Never null, which means every project. */
export const UNKNOWN_PROJECT = ''

/** The project id a view is limited to, null only for "All projects". The window's own project (the switcher's
 *  pick, or the one bound to the window) wins; else the active tab's folder resolves to its project through
 *  `projectOfCwd` (a worktree or subfolder of a project is that project's). Never an exact path match. */
export function scopeIdOf(
  tree: readonly WorkspaceProject[],
  worktrees: readonly WorktreeRef[],
  windowProjectId: string | null,
  currentProject: string | null,
  allProjects: boolean
): string | null {
  if (allProjects) return null
  if (windowProjectId !== null && tree.some((p) => p.id === windowProjectId)) return windowProjectId
  return (currentProject === null ? null : projectOfCwd(currentProject, tree, worktrees)) ?? UNKNOWN_PROJECT
}

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
