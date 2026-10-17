// W2-B workspace sidebar: Project → Plan → that plan's sessions, folded from orchestration data alone.
//
// **Everything here is derived, nothing is stored.** The pane tree is in memory only, but orchestration.json
// survives a restart, so a tree built from its Projects, Jobs, Runs, Tasks and Dispatches is the same tree after
// one. Pure, so it is tested in vitest's node environment like the rest of the renderer's judgements.
import type { Dispatch, Job, JobRun, Project, Task } from '../../../../core/orchestration/types'
import { jobNameOf } from '../../../../core/orchestration/jobName'
import { isJobActive } from '../../../../core/orchestration/lifecycle'
import { leaves, removeTab, type PaneNode } from '../../../../core/panes/tree'
import { parseTab } from '../../../../core/panes/tabId'

/** What the reads return (useWorkspaceData). Jobs come per project because the Host matches a Job to its project
 *  (`jobs-list --project`, jobInProject), which the renderer cannot (node:path). */
export interface WorkspaceData {
  projects: Project[]
  jobsByProject: Record<string, Job[]>
  runs: JobRun[]
  tasks: Task[]
  dispatches: Dispatch[]
}

export type SessionRole = 'planner' | 'coordinator' | 'worker'

export interface WorkspaceSession {
  sessionId: string
  role: SessionRole
  /** "Trading Worker 2", "Trading Coordinator". */
  label: string
  projectName: string
  planName: string
  taskTitle?: string
  /** The Dispatch's model (W1-A), else the Task's. Absent for a coordinator: its session carries it. */
  model?: string
  accountId?: string
  cwd?: string
}

export interface WorkspacePlan {
  jobId: string
  projectId: string
  name: string
  archived: boolean
  paused: boolean
  /** The latest Run, whose sessions are listed. Absent before the plan has run. */
  runId?: string
  planner: WorkspaceSession[]
  coordinator: WorkspaceSession[]
  workers: WorkspaceSession[]
}

export interface WorkspaceProject {
  id: string
  name: string
  path: string
  plans: WorkspacePlan[]
}

const latestRun = (runs: JobRun[], jobId: string): JobRun | undefined =>
  runs.filter((r) => r.jobId === jobId).sort((a, b) => a.ordinal - b.ordinal).at(-1)

/** Workers are one per Task: its latest Dispatch is the live session (a retry, repair or review replaces the one
 *  before it). They are numbered by each Task's first Dispatch, so a number never moves once given. */
function workersOf(run: JobRun, tasks: Task[], dispatches: Dispatch[], projectName: string, planName: string): WorkspaceSession[] {
  const byTask = new Map<string, Dispatch[]>()
  for (const t of tasks) if (t.runId === run.id) byTask.set(t.id, [])
  for (const d of dispatches) byTask.get(d.taskId)?.push(d)
  const taskOf = new Map(tasks.map((t) => [t.id, t]))
  return [...byTask.entries()]
    .filter(([, ds]) => ds.length > 0)
    .map(([taskId, ds]) => {
      const sorted = [...ds].sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      return { task: taskOf.get(taskId)!, first: sorted[0], last: sorted.at(-1)! }
    })
    .sort((a, b) => a.first.startedAt.localeCompare(b.first.startedAt))
    .map(({ task, last }, i) => ({
      sessionId: last.sessionId,
      role: 'worker' as const,
      label: `${planName} Worker ${i + 1}`,
      projectName,
      planName,
      taskTitle: task.title,
      ...((last.model ?? task.model) !== undefined ? { model: last.model ?? task.model } : {}),
      accountId: last.accountId,
      cwd: last.cwd
    }))
}

function planOf(d: WorkspaceData, project: Project, job: Job): WorkspacePlan {
  const name = jobNameOf(job)
  const run = latestRun(d.runs, job.id)
  const lead = run?.coordinatorSessionId ?? run?.externalCoordinatorSessionId
  const coordinator: WorkspaceSession[] = lead
    ? [{ sessionId: lead, role: 'coordinator', label: `${name} Coordinator`, projectName: project.name, planName: name, cwd: run?.worktree ?? job.cwd }]
    : []
  // W2-A: the planners `jobs plan` started are recorded on the Job (Job.plannerSessionIds), latest last. They run
  // in the Job's folder, before any Run exists, and stay listed after the plan is approved.
  const ids = job.plannerSessionIds ?? []
  const planner: WorkspaceSession[] = ids.map((sessionId, i) => ({
    sessionId,
    role: 'planner' as const,
    label: `${name} Planner${ids.length > 1 ? ` ${i + 1}` : ''}`,
    projectName: project.name,
    planName: name,
    cwd: job.cwd
  }))
  return {
    jobId: job.id,
    projectId: project.id,
    name,
    archived: !isJobActive(job),
    paused: job.paused === true || run?.paused === true,
    ...(run ? { runId: run.id } : {}),
    planner,
    coordinator,
    workers: run ? workersOf(run, d.tasks, d.dispatches, project.name, name) : []
  }
}

/** The sidebar's tree. Archived plans are left out unless `showArchived`. */
export function buildWorkspaceTree(d: WorkspaceData, opts: { showArchived: boolean }): WorkspaceProject[] {
  return d.projects.map((p) => ({
    id: p.id,
    name: p.name,
    path: p.path,
    plans: (d.jobsByProject[p.id] ?? [])
      .filter((j) => opts.showArchived || isJobActive(j))
      .map((j) => planOf(d, p, j))
  }))
}

export const planSessions = (p: WorkspacePlan): WorkspaceSession[] => [...p.planner, ...p.coordinator, ...p.workers]

export function findPlan(tree: WorkspaceProject[], jobId: string): WorkspacePlan | undefined {
  for (const p of tree) for (const plan of p.plans) if (plan.jobId === jobId) return plan
  return undefined
}

/**
 * The pane tree as a plan's workspace shows it: every session tab (and agent-app mirror tab) of another session
 * taken out, so only `keep` remain. A view, never written back as the layout.
 *
 * **This is what makes switching plans safe.** PaneGrid mounts one TerminalView per session from the session
 * list, whatever the layout says, and the layout only decides which slot is shown. So a tab dropped here is a
 * terminal hidden with display:none, still mounted: its process, cwd, xterm scrollback (5000 lines) and input
 * routing are untouched, and a hidden terminal is never `active`, so typing cannot reach it.
 */
export function scopeLayout(layout: PaneNode | null, keep: ReadonlySet<string>): PaneNode | null {
  if (!layout) return null
  let out: PaneNode | null = layout
  for (const leaf of leaves(layout))
    for (const tabId of leaf.tabIds) {
      const ref = parseTab(tabId)
      if (out && (ref?.kind === 'session' || ref?.kind === 'app') && !keep.has(ref.id)) out = removeTab(out, tabId)
    }
  return out
}
