// W6-H: how a finished plan lands (orchestrator SPEC §7, PLAN "Wave 6"). Per project: `pr` opens the plan's one pull
// request (`run-open-pr`, never merged by Astera); `push` merges the plan into a branch and pushes it with no review by
// a person (`deliverByPush`, exec/integrateGit.ts). A Job may override its project. Missing everywhere means `pr`, the
// owner's decision of 2026-10-17, so nothing changes for a project nobody set.
//
// Pure: no clock and no files.
import { GITHUB_SOURCE_ID } from '../github/issueSource'
import { checkConfigIdsOf } from './convergence'
import { jobNameOf } from './jobName'
import { addDecision, jobOf, type OrchState, type Res } from './state'
import { newId, type DeliveryMode, type DeliveryProgress, type Job, type JobRun, type Project, type RunDelivery } from './types'
import { findProject, projectOfJob } from './projects'

export const DELIVERIES = ['pr', 'push'] as const satisfies readonly DeliveryMode[]

/** A `--delivery` value: the mode, `undefined` when not given, null when it is neither. */
export function parseDelivery(v: unknown): DeliveryMode | null | undefined {
  if (v === undefined) return undefined
  return (DELIVERIES as readonly unknown[]).includes(v) ? (v as DeliveryMode) : null
}

// T3: moved to projects.ts, where a sub-project's unset settings fall back to its workspace's
export { projectOfJob }

/** #117: whether a plan runs hands-off: the Job's own setting, else its project's, else no. */
export const handsOffOf = (s: OrchState, job: Job): boolean => job.handsOff ?? projectOfJob(s, job)?.handsOff ?? false

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
 *  into `task.escalated`: a notice and the chime), since only the owner can move a push on that a guard refused. #117:
 *  on a hands-off plan the stop is a `refused` decision instead (a plan.refused line, no Inbox card): the guard said no
 *  and nobody is asked. T3: `quiet` records it only: a retried delivery asks the owner once, after its last automatic
 *  attempt (`raiseDeliveryQuestion`). */
export function recordDelivery(s: OrchState, runId: string, delivery: RunDelivery, opts?: { quiet?: boolean }): OrchState {
  const runs = s.runs.map((r) => (r.id === runId ? { ...r, delivery } : r))
  if (delivery.error === undefined || opts?.quiet === true) return { ...s, runs }
  const run = s.runs.find((r) => r.id === runId)
  const job = run && jobOf(s, run)
  if (job && handsOffOf(s, job))
    return addDecision({ ...s, runs }, job.id, {
      at: delivery.at,
      kind: 'refused',
      question: `Push the plan to ${delivery.branch ?? 'its delivery branch'}?`,
      choice: 'not pushed',
      why: `Delivery stopped: ${delivery.error}`.slice(0, 500)
    })
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

// ── T3: delivery that finishes by itself ──

/** Minutes before the automatic retry after the 1st..5th failed attempt. The 5th failure also asks the owner once
 *  (`raiseDeliveryQuestion`); after it the last wait repeats, so a passing cause still delivers by itself. */
export const DELIVERY_RETRY_MINUTES = [1, 5, 15, 30, 60] as const
export const DELIVERY_MAX_ATTEMPTS = DELIVERY_RETRY_MINUTES.length
/** A `delivering` record this old belongs to a process that died mid-delivery: it is due again. */
export const DELIVERING_STALE_MS = 60 * 60_000
/** How often the owner's "I'll push it myself" is checked against git. */
export const OWNER_PUSH_CHECK_MS = 5 * 60_000
/** The owner question's two choices. */
export const DELIVERY_RETRY_NOW = 'Retry now'
export const DELIVERY_OWNER_PUSHES = "I'll push it myself"

/** The record after one attempt: delivered, or one more failure with its retry time. `ask: false` (a plan-branch push)
 *  never reads `needs-owner`: only the end delivery asks the owner. */
export function afterAttempt(prev: DeliveryProgress | undefined, at: string, error?: string, opts?: { ask?: boolean }): DeliveryProgress {
  const attempts = (prev?.attempts ?? 0) + 1
  const keep = prev?.questionId !== undefined ? { questionId: prev.questionId } : {}
  if (error === undefined) return { state: 'delivered', attempts, lastAttemptAt: at, ...keep }
  const wait = DELIVERY_RETRY_MINUTES[Math.min(attempts, DELIVERY_MAX_ATTEMPTS) - 1]
  return {
    state: attempts >= DELIVERY_MAX_ATTEMPTS && opts?.ask !== false ? 'needs-owner' : 'retrying',
    attempts,
    lastError: error,
    lastAttemptAt: at,
    nextRetryAt: new Date(Date.parse(at) + wait * 60_000).toISOString(),
    ...keep
  }
}

/** Whether the driving loop attempts the end delivery now: once pending, after a failure when its retry time came
 *  (the owner's "I'll push it myself" is checked instead, `ownerCheckDue`), and a `delivering` left by a dead process. */
export function deliveryDue(p: DeliveryProgress | undefined, nowMs: number): boolean {
  if (!p) return false
  if (p.state === 'pending') return true
  if (p.state === 'delivering') return p.lastAttemptAt === undefined || nowMs - Date.parse(p.lastAttemptAt) >= DELIVERING_STALE_MS
  if (p.state !== 'retrying' && p.state !== 'needs-owner') return false
  return p.ownerPushes !== true && (p.nextRetryAt === undefined || Date.parse(p.nextRetryAt) <= nowMs)
}

/** Whether the owner's "I'll push it myself" is due another look at git. */
export const ownerCheckDue = (p: DeliveryProgress | undefined, nowMs: number): boolean =>
  p?.state === 'needs-owner' && p.ownerPushes === true && (p.nextRetryAt === undefined || Date.parse(p.nextRetryAt) <= nowMs)

/** Raises the one owner question of a delivery that failed every automatic attempt: an escalation from the Run with the
 *  reason and the two choices, its id kept on the Run (`deliveryState.questionId`), so it is raised once. */
export function raiseDeliveryQuestion(s: OrchState, runId: string, at: string, of: 'deliveryState' | 'branchPush' = 'deliveryState'): OrchState {
  const run = s.runs.find((r) => r.id === runId)
  const p = run?.[of]
  if (!run || !p || p.questionId !== undefined) return s
  const job = jobOf(s, run)
  const plan = job ? jobNameOf(job) : runId
  // T4: the plan branch pushed after each Task (`run-draft-pr`) asks the same question
  const what = of === 'branchPush' ? `Pushing the plan branch of ${plan}` : `Delivery of ${plan}`
  const message = {
    id: newId('msg'),
    runId,
    type: 'escalation' as const,
    subject: `${what} failed ${p.attempts} times: ${p.lastError ?? ''}`.slice(0, 500),
    body:
      (of === 'branchPush'
        ? `Astera tried to push this plan's branch ${p.attempts} times in a row: ${p.lastError ?? 'unknown reason'}\n\n` +
          `"${DELIVERY_RETRY_NOW}" tries again now. "${DELIVERY_OWNER_PUSHES}" leaves it to you; Astera stops pushing the plan branch ` +
          '(the end delivery still runs).'
        : `Astera tried to deliver this plan ${p.attempts} times and stopped asking by itself: ${p.lastError ?? 'unknown reason'}\n\n` +
          `"${DELIVERY_RETRY_NOW}" tries again now. "${DELIVERY_OWNER_PUSHES}" leaves it to you; the plan reads delivered once ` +
          'git sees its commits on the delivery branch.'),
    options: [DELIVERY_RETRY_NOW, DELIVERY_OWNER_PUSHES],
    answered: false,
    createdAt: at
  }
  return {
    ...s,
    runs: s.runs.map((r) => (r.id === runId ? { ...r, [of]: { ...p, questionId: message.id } } : r)),
    messages: [...s.messages, message]
  }
}

/** The owner's answer to the delivery question, once answered: `retry`, `self`, or null (unanswered, or neither). A
 *  hands-off coordinator answers "<choice>. Why: <reason>" (handover.ts), so the choice is the part before it. */
export function deliveryAnswerOf(s: OrchState, p: DeliveryProgress | undefined): 'retry' | 'self' | null {
  if (p?.state !== 'needs-owner' || p.questionId === undefined || p.ownerPushes === true) return null
  const m = s.messages.find((x) => x.id === p.questionId)
  if (!m?.answered) return null
  const choice = (m.answerBody ?? '').split(/\.\s*why:/i)[0].trim().toLowerCase()
  if (choice === DELIVERY_RETRY_NOW.toLowerCase()) return 'retry'
  if (choice === DELIVERY_OWNER_PUSHES.toLowerCase()) return 'self'
  return null
}
