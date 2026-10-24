// W2-B workspace sidebar: Project → Plan → that plan's sessions, folded from orchestration data alone.
//
// **Everything here is derived, nothing is stored.** The pane tree is in memory only, but orchestration.json
// survives a restart, so a tree built from its Projects, Jobs, Runs, Tasks and Dispatches is the same tree after
// one. Pure, so it is tested in vitest's node environment like the rest of the renderer's judgements.
import type { Dispatch, Gate, Job, JobRun, Message, Project, Task } from '../../../core/orchestration/types'
import { jobNameOf } from '../../../core/orchestration/jobName'
import { isJobActive } from '../../../core/orchestration/lifecycle'
import { isTerminal } from '../../../core/orchestration/running'
import type { ProjectGitStatus } from '../../../core/types'
// W8-C plan after plan
import { afterNameOf, afterQueued, afterStandOf } from '../../../core/orchestration/after'
import { leaves, removeTab, type PaneNode } from '../../../core/panes/tree'
import { parseTab } from '../../../core/panes/tabId'

/** What the reads return (useWorkspaceData). Jobs come per project because the Host matches a Job to its project
 *  (`jobs-list --project`, jobInProject), which the renderer cannot (node:path). */
export interface WorkspaceData {
  projects: Project[]
  jobsByProject: Record<string, Job[]>
  runs: JobRun[]
  tasks: Task[]
  dispatches: Dispatch[]
  /** W3-C: the open Gates of every project (`questions-list --status open`), for the "needs my input" list. */
  gates: Gate[]
  /** W6-B: every `escalation` message (`inbox --type escalation`), for the same list. */
  escalations?: Message[]
  /** W6-F: the app's worktrees (worktrees.list), so a tab in one belongs to its repo's project workspace. */
  worktrees?: WorktreeRef[]
}

/** The tree lists workspaces only. A sub-project shares its workspace's path, so `jobs-list --project <path>` answers
 *  the root, whose list already holds the sub-project's plans (jobInProject); a row of its own would repeat them. */
export const workspacesOf = (projects: Project[]): Project[] => projects.filter((p) => p.parentId === undefined)

export type SessionRole = 'planner' | 'coordinator' | 'worker'

export interface WorkspaceSession {
  sessionId: string
  role: SessionRole
  /** "Trading Worker 2", "Trading Coordinator". */
  label: string
  projectName: string
  planName: string
  /** W3-C: a worker's Task, so search and the inbox can read its branch and Gates (sessionIndex.ts). */
  taskId?: string
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
  // W8-C plan after plan
  /** "Queued after <plan>": it waits for that plan to be delivered (after.ts); `stopped` when that plan stopped. */
  queuedAfter?: { name: string; stopped: boolean }
  // T11 project switcher
  /** The sub-project the plan is filed under (its Job's projectId), when that is not the workspace itself. */
  subProjectId?: string
  /** Its latest Run still has work: an active, unpaused plan with a Task not finished. */
  live?: boolean
  /** The open Gates (questions to the owner) of its Runs. */
  questions?: number
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
      taskId: task.id,
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
  const paused = job.paused === true || run?.paused === true
  const runIds = new Set(d.runs.filter((r) => r.jobId === job.id).map((r) => r.id))
  return {
    jobId: job.id,
    projectId: project.id,
    name,
    archived: !isJobActive(job),
    paused,
    ...(run ? { runId: run.id } : {}),
    planner,
    coordinator,
    workers: run ? workersOf(run, d.tasks, d.dispatches, project.name, name) : [],
    ...queuedAfterOf(d, job),
    ...(job.projectId !== undefined && job.projectId !== project.id ? { subProjectId: job.projectId } : {}),
    live: run !== undefined && isJobActive(job) && !paused && d.tasks.some((t) => t.runId === run.id && !isTerminal(t)),
    questions: d.gates.filter((g) => g.status === 'open' && runIds.has(g.runId)).length
  }
}

// W8-C plan after plan
function queuedAfterOf(d: WorkspaceData, job: Job): Pick<WorkspacePlan, 'queuedAfter'> {
  if (!afterQueued(job)) return {}
  const s = { jobs: Object.values(d.jobsByProject).flat(), runs: d.runs, tasks: d.tasks }
  return { queuedAfter: { name: afterNameOf(s, job.after!), stopped: afterStandOf(s, job.after!) === 'stopped' } }
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

// ── W6-F: one workspace per project ────────────────────────────────────────────────────────────────────────────
// A project's workspace is every session of it: its plans' planner, coordinator and worker sessions, plus the plain
// tabs whose cwd is in the project folder or in one of its worktrees. Tabs outside every project are OTHER_WORKSPACE.
// Like a plan's workspace it is only a scopeLayout view of the one pane tree, so every terminal stays mounted.

/** The workspace of the tabs that belong to no project. Not a project id (those are UUIDs). */
export const OTHER_WORKSPACE = 'other'

/** A worktree as worktrees.list reports it (WorktreeInfo): where it is and which repo it was made from. */
export type WorktreeRef = { path: string; repoPath: string }

const trimPath = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
/** `p` is `root` or inside it. Plain string work: the renderer has no node:path. */
const isUnder = (p: string, root: string): boolean => {
  const a = trimPath(p)
  const r = trimPath(root)
  return a === r || a.startsWith(`${r}/`)
}
const deepest = <T extends { path: string }>(xs: readonly T[], p: string): T | undefined =>
  xs.filter((x) => isUnder(p, x.path)).sort((a, b) => b.path.length - a.path.length)[0]

const parentDir = (p: string): string => trimPath(p).replace(/\/[^/]*$/, '')

/** The repo of a folder in a worktree that is not (or no longer) in the registry: worktrees sit one folder each
 *  under `<worktreesRoot>/<Project>/`, so a folder under the parent of a registered worktree is of that worktree's
 *  repo, provided every registered worktree under that parent agrees (a root shared by several repos says nothing). */
function repoOfUnlistedWorktree(cwd: string, worktrees: readonly WorktreeRef[]): string | undefined {
  const parents = new Map<string, Set<string>>()
  for (const w of worktrees) {
    const dir = parentDir(w.path)
    if (isUnder(cwd, dir) && trimPath(cwd) !== dir) parents.set(dir, (parents.get(dir) ?? new Set()).add(w.repoPath))
  }
  const best = [...parents.entries()].sort((a, b) => b[0].length - a[0].length)[0]
  return best && best[1].size === 1 ? [...best[1]][0] : undefined
}

/** The project a folder belongs to: the deepest project holding it, directly or through a worktree of it. */
export function projectOfCwd(
  cwd: string,
  projects: readonly { id: string; path: string }[],
  worktrees: readonly WorktreeRef[]
): string | null {
  const direct = deepest(projects, deepest(worktrees, cwd)?.repoPath ?? cwd)?.id
  if (direct !== undefined) return direct
  const repo = repoOfUnlistedWorktree(cwd, worktrees)
  return repo === undefined ? null : (deepest(projects, repo)?.id ?? null)
}

/** Every workspace's session ids, keyed by project id, plus OTHER_WORKSPACE for the open tabs of no project. A plan's
 *  session belongs to its plan's project wherever its cwd is. */
export function workspaceSessionIds(
  tree: readonly WorkspaceProject[],
  sessions: readonly { id: string; cwd: string }[],
  worktrees: readonly WorktreeRef[]
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>(
    tree.map((p) => [p.id, new Set(p.plans.flatMap((plan) => planSessions(plan).map((s) => s.sessionId)))])
  )
  const claimed = new Set([...out.values()].flatMap((ids) => [...ids]))
  out.set(OTHER_WORKSPACE, new Set())
  for (const s of sessions) {
    if (claimed.has(s.id)) continue
    out.get(projectOfCwd(s.cwd, tree, worktrees) ?? OTHER_WORKSPACE)!.add(s.id)
  }
  return out
}

/** The session ids the pane grid shows: the open plan's, else the open project's, else null for every tab. */
export function scopeIds(
  tree: readonly WorkspaceProject[],
  byWorkspace: ReadonlyMap<string, ReadonlySet<string>>,
  projectId: string | null,
  planId: string | null
): Set<string> | null {
  const plan = planId ? findPlan([...tree], planId) : undefined
  if (plan) return new Set(planSessions(plan).map((s) => s.sessionId))
  return projectId ? new Set(byWorkspace.get(projectId) ?? []) : null
}

/** The tab to focus on entering a workspace: the one it had when it was left, while still shown there, else its first
 *  session tab shown. Undefined when it shows none. `keep` null is the unscoped view. */
export function entryTab(layout: PaneNode | null, keep: ReadonlySet<string> | null, remembered?: string): string | undefined {
  const shown = keep ? scopeLayout(layout, keep) : layout
  if (!shown) return undefined
  const tabs = leaves(shown).flatMap((l) => l.tabIds)
  if (remembered && tabs.includes(remembered)) return remembered
  return tabs.find((t) => {
    const ref = parseTab(t)
    return ref?.kind === 'session' && (!keep || keep.has(ref.id))
  })
}

/** Where a new tab opened in a workspace starts: its project's folder. Null for "Other" and every tab (the dialog's own
 *  default). */
export const workspaceFolderOf = (tree: readonly WorkspaceProject[], projectId: string | null): string | null =>
  tree.find((p) => p.id === projectId)?.path ?? null

export interface WorkspaceSummary {
  /** A project id or OTHER_WORKSPACE. */
  id: string
  name: string
  /** T11: a sub-project's workspace (root) id; the row is listed under that workspace's. */
  parentId?: string
  /** T11: the workspace's checked-out branch (projects.status); absent for a sub-project, "Other", or before git answers. */
  branch?: string
  /** Its sessions whose process is running. */
  running: number
  /** T11: of them, the agents at work right now (attention 'working'). */
  working: number
  /** One of them waits for the owner (attention 'waiting'). */
  waiting: boolean
  /** T11: its plans still running (WorkspacePlan.live) and their open questions. */
  plans: number
  questions: number
  /** T11: changed paths, commits not pushed and commits behind the upstream; 0 when git could not say. */
  dirty: number
  unpushed: number
  behind: number
}

/** A sub-project as projects-list names it: the tree lists workspaces only. */
export type SubProjectRef = { id: string; name: string; parentId: string }

/** The project switcher's rows: every project in tree order, each followed by its sub-projects, then "Other" while it
 *  holds a tab. A workspace counts all of its plans and sessions, its sub-projects' too (opening it shows them all); a
 *  sub-project counts only the plans filed under it, and has no git line of its own (it shares its workspace's folder). */
export function workspaceSummaries(
  tree: readonly WorkspaceProject[],
  byWorkspace: ReadonlyMap<string, ReadonlySet<string>>,
  sessions: readonly { id: string; status: string }[],
  attention: Readonly<Record<string, string>>,
  extra: { subProjects?: readonly SubProjectRef[]; git?: Readonly<Record<string, ProjectGitStatus>> } = {}
): WorkspaceSummary[] {
  const running = new Set(sessions.filter((s) => s.status === 'running').map((s) => s.id))
  const row = (id: string, name: string, ids: Iterable<string>, plans: readonly WorkspacePlan[], git?: ProjectGitStatus): WorkspaceSummary => {
    const live = [...ids].filter((s) => running.has(s))
    return {
      id,
      name,
      ...(git?.branch ? { branch: git.branch } : {}),
      running: live.length,
      working: live.filter((s) => attention[s] === 'working').length,
      waiting: live.some((s) => attention[s] === 'waiting'),
      plans: plans.filter((p) => p.live).length,
      questions: plans.reduce((n, p) => n + (p.questions ?? 0), 0),
      dirty: git?.dirty ?? 0,
      unpushed: git?.unpushed ?? 0,
      behind: git?.behind ?? 0
    }
  }
  const rows = tree.flatMap((p) => [
    row(p.id, p.name, byWorkspace.get(p.id) ?? [], p.plans, extra.git?.[p.path]),
    ...(extra.subProjects ?? [])
      .filter((s) => s.parentId === p.id)
      .map((s) => {
        const plans = p.plans.filter((plan) => plan.subProjectId === s.id)
        return { ...row(s.id, s.name, plans.flatMap((plan) => planSessions(plan).map((x) => x.sessionId)), plans), parentId: p.id }
      })
  ])
  return (byWorkspace.get(OTHER_WORKSPACE)?.size ?? 0) > 0 ? [...rows, row(OTHER_WORKSPACE, 'Other', byWorkspace.get(OTHER_WORKSPACE)!, [])] : rows
}

export type ProjectDot = 'working' | 'needsYou' | 'idle'

/** T11: the switcher row's dot. Needs you (amber) while a session waits for the owner or a plan asks a question; else
 *  working (green) while an agent works or a plan runs; else idle (grey). */
export const projectStatusDot = (s: Pick<WorkspaceSummary, 'waiting' | 'questions' | 'working' | 'plans'>): ProjectDot =>
  s.waiting || s.questions > 0 ? 'needsYou' : s.working > 0 || s.plans > 0 ? 'working' : 'idle'
