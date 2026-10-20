// The registered repositories (design §6).
//
// **Not in state.ts, for one reason:** every question here is a question about paths, and paths mean
// `isSamePath` — case folding where the filesystem ignores case and separator normalisation, which pull `node:path`
// in. `state.ts` is listed in tsconfig.web.json and the renderer imports it, so it cannot have that.
// The state operations that need a path live here instead; `OrchState.projects` is still just an
// array on the state those functions return.
import { comparablePath, isPathWithin, isSamePath } from '../files/tree'
import { jobFinished } from './after'
import { MAX_CONCURRENT_WORKERS, newId, type Job, type Project } from './types'
import { MODEL_ID } from './roleModels'
import { projectWithWorkspace, type OrchState, type Res } from './state'

/** The last segment of a path, whatever separator it arrived with. Not `path.basename`: that reads
 *  the platform's separator, and a path stored on one machine is read on another (the file travels
 *  with a settings sync). A trailing separator is dropped first so `D:\work\proj\` is `proj` and not
 *  the empty string, which would leave a project with a blank name in the list. */
export function nameFromPath(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return cut === -1 ? trimmed : trimmed.slice(cut + 1)
}

/** T3: a sub-project shares its workspace's path, so the path questions below answer the root and never a child. */
export function findProjectByPath(s: OrchState, path: string): Project | undefined {
  return s.projects.find((p) => p.parentId === undefined && isSamePath(p.path, path))
}

/**
 * The registered project a path belongs to, for `projects find` and every `--project` filter: the
 * project whose root is that path or holds it, and **the longest such root** when projects nest (a
 * package registered inside a monorepo that is registered too). A sibling that only shares a prefix
 * (`proj2` beside `proj`) is not inside: `isPathWithin` asks for a separator boundary.
 */
export function findProjectContaining(s: OrchState, path: string): Project | undefined {
  let best: Project | undefined
  let bestLength = -1
  for (const p of s.projects) {
    if (p.parentId !== undefined || !isPathWithin(p.path, path)) continue
    const length = comparablePath(p.path).length
    if (length > bestLength) {
      best = p
      bestLength = length
    }
  }
  return best
}

export function findProject(s: OrchState, id: string): Project | undefined {
  return s.projects.find((p) => p.id === id)
}

/**
 * Whether this Job belongs to this project, for `jobs list --project` (CLI spec §16).
 *
 * `projectId` wins when it resolves: the Job belongs to its own project and to that project's workspace root
 * (a plan auto-filed under a sub-project shares the root's path, and every path lookup answers the root). A Job without one belongs by its folder, **with the rule
 * `projects find` uses** (`findProjectContaining`): the longest registered root that is its folder or
 * holds it. That covers a Job made before projects were registered, one whose project record is gone,
 * and one made from a subfolder of a project, which keeps that folder and gets no `projectId` when
 * nothing moved it up to the root (with Astera closed, `run-create` attaches a project only by an
 * exact path). Comparing with `isSamePath` alone left that last Job under no project at all, although
 * `projects find` named one for its folder.
 *
 * The worktree registry that lets the sidebar map a worktree folder back to its repository is the
 * app's (`core.worktrees`) and this layer has none, so an old Job created inside a worktree is not
 * matched here.
 */
export function jobInProject(s: OrchState, job: Pick<Job, 'projectId' | 'cwd'>, project: Project): boolean {
  const own = job.projectId !== undefined ? findProject(s, job.projectId) : undefined
  // A workspace holds its sub-projects' plans too; a sub-project asked for by id holds only its own
  if (own) return own.id === project.id || rootProjectOf(s, own).id === project.id
  return findProjectContaining(s, job.cwd)?.id === project.id
}

/**
 * The project for this path, registering it if this is the first time it has been seen.
 *
 * **Idempotent, and that is the whole contract.** The caller is `orch.list`, which runs every time
 * the Jobs sidebar is shown; it must be free to call this on every list without growing the array.
 * The match is `isSamePath`, so the same repository spelled `D:\Work\Proj` and `d:/work/proj`
 * registers once.
 *
 * **It does not validate the path.** Whether the folder exists, and whether the renderer was allowed
 * to name it, are asked before this is reached (`assertAllowedPath`); repeating the question here
 * would put a filesystem call in a pure module and answer it differently.
 */
export function ensureProject(
  s: OrchState,
  a: { path: string; now: string }
): { state: OrchState; project: Project } {
  const found = findProjectByPath(s, a.path)
  if (found) return { state: s, project: found }
  const project: Project = {
    id: newId('proj'),
    path: a.path,
    name: nameFromPath(a.path),
    addedAt: a.now,
    // A new project makes no sub-projects from `jobs set --areas` until the owner turns it on (`projects set
    // --auto-projects on`). Written here rather than flipping the absent default, which keeps older projects as they were.
    autoProjects: false
  }
  return { state: { ...s, projects: [...s.projects, project] }, project }
}

/** W8-G (#103): `ensureProject` for a folder a tab happens to stand in. Only a git folder becomes a project, as with
 *  `projects add`; any other tab folder is left unregistered.
 *
 *  T3: **only the repository itself**, never a subfolder of it or a linked worktree (`.claude/worktrees/<x>`): a folder
 *  a registered project holds registers nothing, and any other is registered by `repoRootOf` (detect.ts `mainRepoRoot`:
 *  the main worktree's top level, null when not git). shortcut: a repository nested inside a registered one is not
 *  registered from a tab; `projects add` registers it. */
export async function ensureGitProject(
  s: OrchState,
  a: { path: string; now: string },
  repoRootOf: (dir: string) => Promise<string | null>
): Promise<OrchState> {
  if (findProjectContaining(s, a.path)) return s
  const root = await repoRootOf(a.path)
  return root === null ? s : ensureProject(s, { path: root, now: a.now }).state
}

/** W8-G (#103): drops the projects an older build registered from a tab's non-git folder. One that holds a plan stays:
 *  it is the person's work, not a stray tab. */
export async function dropNonGitProjects(s: OrchState, isGit: (dir: string) => Promise<boolean>): Promise<OrchState> {
  const strays: string[] = []
  for (const p of s.projects)
    if (p.parentId === undefined && !s.jobs.some((j) => jobInProject(s, j, p)) && !(await isGit(p.path))) strays.push(p.id)
  return strays.length === 0 ? s : { ...s, projects: s.projects.filter((p) => !strays.includes(p.id)) }
}

/** Renames one. Nothing in P0 calls it — the CLI spec §13 does not require project write commands —
 *  but the field exists to be changed and a rename that has to go through a raw state edit is how a
 *  second writer gets invented. */
export function renameProject(s: OrchState, id: string, name: string): Res<Project> {
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, error: 'name is required' }
  const found = findProject(s, id)
  if (!found) return { ok: false, error: `unknown project: ${id}` }
  const next: Project = { ...found, name: trimmed }
  return {
    ok: true,
    state: { ...s, projects: s.projects.map((p) => (p.id === id ? next : p)) },
    value: next
  }
}

/** W7-B: the per-project choices `projects-set` writes besides delivery (delivery.ts `setProjectDelivery`). A field
 *  given as null is cleared, so the project reads PROJECT_DEFAULTS for it again; one left out is kept. */
export type ProjectSettingsPatch = {
  autoApprove?: boolean | null
  // #117
  handsOff?: boolean | null
  testConfigId?: string | null
  concurrency?: number | null
  reviewRounds?: number | null
  replan?: 'waves' | 'off' | null
  defaultBranch?: string | null
  // W10-A: repository-relative, checked by the caller (promptNames.ts `repoRelative`)
  promptsDir?: string | null
  // T3 workspaces: false stops auto-created sub-projects
  autoProjects?: false | null
  // T5: kinds granted in advance (kebab-case words), and the coordinator's model
  grants?: string[] | null
  coordinatorModel?: string | null
}

/** T5: a standing grant's kind: a short kebab-case word (`protected-paths`, `migrations`). */
export const GRANT_KIND = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const MAX_GRANT_LENGTH = 40

export function setProjectSettings(s: OrchState, id: string, patch: ProjectSettingsPatch): Res<Project> {
  const found = findProject(s, id)
  if (!found) return { ok: false, error: `unknown project: ${id}` }
  const { concurrency, reviewRounds, replan } = patch
  if (concurrency != null && !(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= MAX_CONCURRENT_WORKERS))
    return { ok: false, error: `concurrency must be an integer from 1 to ${MAX_CONCURRENT_WORKERS}` }
  if (reviewRounds != null && !(Number.isInteger(reviewRounds) && reviewRounds >= 1))
    return { ok: false, error: 'review rounds must be an integer >= 1' }
  if (replan != null && replan !== 'waves' && replan !== 'off') return { ok: false, error: 'replan must be waves or off' }
  const bad = patch.grants?.find((g) => !GRANT_KIND.test(g) || g.length > MAX_GRANT_LENGTH)
  if (bad !== undefined) return { ok: false, error: `grant ${JSON.stringify(bad)} must be a short kebab-case word (protected-paths, migrations)` }
  if (patch.grants?.length === 0) patch = { ...patch, grants: null }
  else if (patch.grants) patch = { ...patch, grants: [...new Set(patch.grants)] }
  if (patch.coordinatorModel != null && !MODEL_ID.test(patch.coordinatorModel))
    return { ok: false, error: `coordinator model ${JSON.stringify(patch.coordinatorModel)} is not a model id` }
  const next: Record<string, unknown> = { ...found }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    if (v === null) delete next[k]
    else next[k] = v
  }
  const project = next as unknown as Project
  return { ok: true, state: { ...s, projects: s.projects.map((p) => (p.id === id ? project : p)) }, value: project }
}

// ── T3 workspaces: sub-projects of one repository ──

/** The Job's project: its `projectId`, else the registered project holding its folder (the read path for old rows).
 *  T3: a sub-project reads every setting it leaves unset from its workspace, so filing a plan under one never drops
 *  the workspace's delivery, approval or hands-off. */
export function projectOfJob(s: OrchState, job: Pick<Job, 'projectId' | 'cwd'>): Project | undefined {
  const own = (job.projectId !== undefined ? findProject(s, job.projectId) : undefined) ?? findProjectContaining(s, job.cwd)
  return own && projectWithWorkspace(s, own.id)
}

/** The workspace a project belongs to: its parent, else itself. */
export const rootProjectOf = (s: OrchState, p: Project): Project => (p.parentId !== undefined ? findProject(s, p.parentId) : undefined) ?? p

/** The sub-projects of a workspace. */
export const childProjectsOf = (s: OrchState, id: string): Project[] => s.projects.filter((p) => p.parentId === id)

/** A sub-project of `parentId` named `name`, made if the workspace has none by that name (case ignored); the found one is
 *  answered unchanged, like `ensureProject`. The parent must be a root: one level only. */
export function addSubProject(s: OrchState, a: { parentId: string; name: string; focus?: string[]; now: string }): Res<Project> {
  const name = a.name.trim()
  if (!name) return { ok: false, error: 'name is required' }
  const parent = findProject(s, a.parentId)
  if (!parent) return { ok: false, error: `unknown project: ${a.parentId}`, missing: true }
  if (parent.parentId !== undefined) return { ok: false, error: `${parent.id} is a sub-project; give its workspace ${parent.parentId}` }
  const found = childProjectsOf(s, parent.id).find((p) => p.name.toLowerCase() === name.toLowerCase())
  if (found) return { ok: true, state: s, value: found }
  const focus = [...new Set((a.focus ?? []).map((f) => f.trim()).filter((f) => f !== ''))]
  const project: Project = { id: newId('proj'), path: parent.path, name, addedAt: a.now, parentId: parent.id, ...(focus.length > 0 ? { focus } : {}) }
  return { ok: true, state: { ...s, projects: [...s.projects, project] }, value: project }
}

/** Unregisters a project. Refused while a plan of it is running, paused or queued (not `jobFinished`: a completed,
 *  delivered, stopped or archived plan does not hold it; and a plan with no Run only while it waits on another, `after`:
 *  a draft never run does not), and for a workspace that still has sub-projects: removing one never removes another. */
export function removeProject(s: OrchState, id: string): Res<Project> {
  const found = findProject(s, id)
  if (!found) return { ok: false, error: `unknown project: ${id}`, missing: true }
  const children = childProjectsOf(s, id)
  if (children.length > 0) return { ok: false, error: `${id} has sub-projects (${children.map((c) => c.id).join(', ')}); remove them first` }
  const active = s.jobs.filter(
    (j) => jobInProject(s, j, found) && !jobFinished(s, j.id) && (j.after !== undefined || s.runs.some((r) => r.jobId === j.id))
  )
  if (active.length > 0)
    return { ok: false, error: `${id} has plans that are running, paused or queued (${active.map((j) => j.id).join(', ')}); stop or archive them first` }
  return { ok: true, state: { ...s, projects: s.projects.filter((p) => p.id !== id) }, value: found }
}

/** Files a plan that has not started under another project of the same workspace (`jobs-set --project`). Its folder
 *  stays: every project of a workspace is the same repository. */
export function moveJobToProject(s: OrchState, jobId: string, projectId: string): Res<Job> {
  const job = s.jobs.find((j) => j.id === jobId)
  if (!job) return { ok: false, error: `unknown job: ${jobId}`, missing: true }
  const target = findProject(s, projectId)
  if (!target) return { ok: false, error: `unknown project: ${projectId}`, missing: true }
  if (job.pendingStart !== true) return { ok: false, error: `job ${jobId} has started: only a plan not started yet moves` }
  const from = projectOfJob(s, job)
  if (!from || rootProjectOf(s, from).id !== rootProjectOf(s, target).id)
    return { ok: false, error: `${projectId} is not in the workspace of job ${jobId}` }
  const next: Job = { ...job, projectId: target.id }
  return { ok: true, state: { ...s, jobs: s.jobs.map((j) => (j.id === jobId ? next : j)) }, value: next }
}

/** T3 auto-create from the work: the plan filed under the sub-project of its workspace named after `area` (its first
 *  area), made when missing with the top folders of the plan's Tasks' affected paths as its focus. Unchanged when the
 *  plan has no project or its workspace turned it off (`autoProjects: false`). `tasks` are the plan's (overlap.ts
 *  `planTasksOf`). */
export function autoProjectFor(
  s: OrchState,
  job: Job,
  area: string,
  tasks: readonly { affectedPaths?: string[] }[],
  now: string
): OrchState {
  const own = projectOfJob(s, job)
  if (!own) return s
  const root = rootProjectOf(s, own)
  if (root.autoProjects === false) return s
  const focus = tasks.flatMap((t) => t.affectedPaths ?? []).flatMap((p) => {
    const parts = p.replace(/\\/g, '/').split('/').filter((x) => x !== '' && x !== '.')
    return parts.length > 1 ? [parts[0]] : []
  })
  const added = addSubProject(s, { parentId: root.id, name: area, focus, now })
  if (!added.ok || job.projectId === added.value.id) return added.ok ? added.state : s
  return { ...added.state, jobs: added.state.jobs.map((j) => (j.id === job.id ? { ...j, projectId: added.value.id } : j)) }
}
