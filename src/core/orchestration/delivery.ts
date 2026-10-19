// W6-H: how a finished plan lands (orchestrator SPEC §7, PLAN "Wave 6"). Per project: `pr` opens the plan's one pull
// request (`run-open-pr`, never merged by Astera); `push` merges the plan into a branch and pushes it with no review by
// a person (`deliverByPush`, exec/integrateGit.ts). A Job may override its project. Missing everywhere means `pr`, the
// owner's decision of 2026-10-17, so nothing changes for a project nobody set.
//
// Pure: no clock and no files.
import { GITHUB_SOURCE_ID } from '../github/issueSource'
import { checkConfigIdsOf } from './convergence'
import { jobOf, type OrchState, type Res } from './state'
import { newId, type DeliveryMode, type Job, type JobRun, type Project, type RunDelivery } from './types'
import { findProject, findProjectContaining } from './projects'

export const DELIVERIES = ['pr', 'push'] as const satisfies readonly DeliveryMode[]

/** A `--delivery` value: the mode, `undefined` when not given, null when it is neither. */
export function parseDelivery(v: unknown): DeliveryMode | null | undefined {
  if (v === undefined) return undefined
  return (DELIVERIES as readonly unknown[]).includes(v) ? (v as DeliveryMode) : null
}

/** The Job's project: its `projectId`, else the registered project holding its folder (the read path for old rows). */
export const projectOfJob = (s: OrchState, job: Job): Project | undefined =>
  (job.projectId !== undefined ? findProject(s, job.projectId) : undefined) ?? findProjectContaining(s, job.cwd)

/** How this Job's plan lands: its own setting, else its project's, else `pr`. */
export const deliveryOf = (s: OrchState, job: Job): DeliveryMode => job.delivery ?? projectOfJob(s, job)?.delivery ?? 'pr'

/** The issues the plan came from, which a push closes (`Fixes #n`): the GitHub issue the Job was made from, and every
 *  issue the repository's workflow created for this plan (`links.issue.closes`, the ones the PR says "Closes" for). */
export function deliveryIssuesOf(s: OrchState, run: JobRun): number[] {
  const out = new Set<number>()
  const source = jobOf(s, run)?.source
  if (source?.id === GITHUB_SOURCE_ID && /^\d+$/.test(source.itemId)) out.add(Number(source.itemId))
  for (const t of s.tasks) if (t.runId === run.id && t.links?.issue?.closes) out.add(t.links.issue.number)
  return [...out].sort((a, b) => a - b)
}

/** The message of each merge commit a push delivery makes: the plan's name, then one `Fixes #n` line per issue, which
 *  GitHub reads off the pushed commits to close them. */
export const deliveryMessage = (plan: string, issues: readonly number[]): string =>
  [`Deliver plan: ${plan}`, ...(issues.length > 0 ? ['', ...issues.map((n) => `Fixes #${n}`)] : [])].join('\n')

/** The checks the merged tree runs once more before a push: every check any of the Run's Tasks was validated with, in
 *  first-seen order. Empty: the project has none configured, and the reviews are the only gate. */
export function deliveryChecksOf(s: OrchState, runId: string): string[] {
  const ids = new Set<string>()
  for (const t of s.tasks) if (t.runId === runId) for (const id of checkConfigIdsOf(t)) ids.add(id)
  return [...ids]
}

/** Sets a project's delivery and its branch. `branch: null` clears the branch (back to the default branch). */
export function setProjectDelivery(
  s: OrchState,
  id: string,
  patch: { delivery?: DeliveryMode; branch?: string | null }
): Res<Project> {
  const found = findProject(s, id)
  if (!found) return { ok: false, error: `unknown project: ${id}` }
  const branch = patch.branch?.trim()
  if (branch !== undefined && (branch === '' || /\s/.test(branch) || branch.startsWith('-')))
    return { ok: false, error: `not a branch name: ${JSON.stringify(patch.branch)}` }
  const { deliveryBranch: _old, ...rest } = found
  const next: Project = {
    ...(patch.branch === null ? rest : found),
    ...(patch.delivery !== undefined ? { delivery: patch.delivery } : {}),
    ...(branch !== undefined ? { deliveryBranch: branch } : {})
  }
  return { ok: true, state: { ...s, projects: s.projects.map((p) => (p.id === id ? next : p)) }, value: next }
}

/** Records a push delivery on its Run. A stop is also an escalation from the Run (W6-B turns an `escalation` message
 *  into `task.escalated`: a notice and the chime), since only the owner can move a push on that a guard refused. */
export function recordDelivery(s: OrchState, runId: string, delivery: RunDelivery): OrchState {
  const runs = s.runs.map((r) => (r.id === runId ? { ...r, delivery } : r))
  if (delivery.error === undefined) return { ...s, runs }
  const message = {
    id: newId('msg'),
    runId,
    type: 'escalation' as const,
    subject: `Delivery stopped: ${delivery.error}`.slice(0, 500),
    body: delivery.error,
    answered: false,
    createdAt: delivery.at
  }
  return { ...s, runs, messages: [...s.messages, message] }
}

/** Sets one Job's own delivery (`jobs-plan --delivery`). */
export function setJobDelivery(s: OrchState, jobId: string, delivery: DeliveryMode): Res<Job> {
  const found = s.jobs.find((j) => j.id === jobId)
  if (!found) return { ok: false, error: `unknown job: ${jobId}` }
  const next: Job = { ...found, delivery }
  return { ok: true, state: { ...s, jobs: s.jobs.map((j) => (j.id === jobId ? next : j)) }, value: next }
}

/** W9-J: once a plan is delivered, its ready worktrees go (worktrees/cleanup.ts decides; the Host's dep reads the
 *  `autoCleanWorktrees` setting). A failure is logged and never fails the delivery. */
export async function cleanAfterDelivery(
  deps: { cleanWorktrees?(runId: string): Promise<unknown>; log?(message: string): void },
  runId: string
): Promise<void> {
  try {
    await deps.cleanWorktrees?.(runId)
  } catch (e) {
    deps.log?.(`run=${runId}: cleaning its worktrees after delivery failed: ${String(e)}`)
  }
}
