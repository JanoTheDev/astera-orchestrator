// W6-H: how a finished plan lands (orchestrator SPEC §7, PLAN "Wave 6"). Per project: `pr` opens the plan's one pull
// request (`run-open-pr`, never merged by Astera); `push` merges the plan into a branch and pushes it with no review by
// a person (`deliverByPush`, exec/integrateGit.ts); T6 `merge` does the same merge and validation on this computer and
// pushes nothing (`deliverByPush` with `local`). A Job may override its project. Missing everywhere means `pr`, the
// owner's decision of 2026-10-17, so nothing changes for a project nobody set. `manual` delivers nothing by itself: the
// owner reviews the plan's worktree and then opens the PR or pushes (`run-deliver --as`).
//
// Pure: no clock and no files.
import { GITHUB_SOURCE_ID } from '../github/issueSource'
import { checkConfigIdsOf } from './convergence'
import { jobNameOf } from './jobName'
import { addDecision, jobOf, type OrchState, type Res } from './state'
import { FAILURE_LIMIT, newId, type DeliveryMode, type DeliveryProgress, type Job, type JobRun, type Project, type RunDelivery, type Task } from './types'
import { findProject, projectOfJob } from './projects'
import { deliveryChoicesOf, effectiveDelivery, type DeliveryOffReason, type DeliverySetup } from './deliveryChoices'

export const DELIVERIES = ['pr', 'push', 'merge', 'manual'] as const satisfies readonly DeliveryMode[]

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

/** The branch this plan forks from and delivers into: its own, else its project's. Absent: the repository's default
 *  branch (a PR) or the branch the folder stands on (a fork). */
export const deliveryBranchOf = (s: OrchState, job: Job): string | undefined => job.deliveryBranch ?? projectOfJob(s, job)?.deliveryBranch

/** A `--delivery-branch` value trimmed, or null when it cannot name a branch (empty, a space, a leading `-`). */
const branchNameOf = (v: string): string | null => {
  const b = v.trim()
  return b === '' || /\s/.test(b) || b.startsWith('-') ? null : b
}

// T32: the folder setups last read, by folder, so the sync callers (draftPrDue, the stall watch, deliveryWait) see what the
// async ones (`run-deliver`, the dispatch loop) read. Empty (nothing read, e.g. the app, tests): the saved delivery stands.
const setups = new Map<string, DeliverySetup>()
export const forgetDeliverySetups = (): void => setups.clear()

/** How the plan really lands: its saved delivery (`deliveryOf`) when it can work on its folder, else merge on this
 *  computer, else review (`effectiveDelivery`), with why. A folder not read yet keeps the saved one. */
export function deliveryLandingOf(s: OrchState, job: Job): { mode: DeliveryMode; reason?: DeliveryOffReason } {
  const saved = deliveryOf(s, job)
  const setup = setups.get(job.cwd)
  return setup === undefined ? { mode: saved } : effectiveDelivery(saved, deliveryChoicesOf(setup))
}

/** `deliveryLandingOf` after reading the plan's folder with `read` (absent: not read, the last answer stands). A folder
 *  that cannot be read keeps the last answer, else the saved delivery. */
export async function readLandingOf(s: OrchState, job: Job, read?: (cwd: string) => Promise<DeliverySetup>): Promise<{ mode: DeliveryMode; reason?: DeliveryOffReason }> {
  if (read) {
    try {
      setups.set(job.cwd, await read(job.cwd))
    } catch {
      // the last answer, else the saved delivery
    }
  }
  return deliveryLandingOf(s, job)
}

/** How the plan's delivery fell back (merge on this computer, else review), why, and the branch a merge lands on when
 *  known; null when it did not fall back. The plan's log line carries it, so the app words it in the owner's language. */
export function deliveryFallbackOf(s: OrchState, job: Job): { mode: DeliveryMode; reason: DeliveryOffReason; branch?: string } | null {
  const { mode, reason } = deliveryLandingOf(s, job)
  if (reason === undefined) return null
  const branch = deliveryBranchOf(s, job) ?? setups.get(job.cwd)?.branch ?? undefined
  return branch === undefined ? { mode, reason } : { mode, reason, branch }
}

/** One plain line for the plan's log when its delivery fell back, e.g. "Merged into main on this computer: no GitHub
 *  remote"; null when it did not. */
export function deliveryFallbackLine(s: OrchState, job: Job): string | null {
  const fell = deliveryFallbackOf(s, job)
  if (fell === null) return null
  const why = { notGit: 'not a git repository', noRemote: 'no remote', notGitHub: 'no GitHub remote', ghSignedOut: 'gh is not signed in' }[fell.reason]
  return fell.mode === 'merge' ? `Merged into ${fell.branch ?? 'its branch'} on this computer: ${why}` : `Left for your review: ${why}`
}

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

/** The checks the merged tree runs once before a push: every check any of the Run's Tasks was validated with, in
 *  first-seen order, then the project's test command (Tasks are not given it, so the full suite runs here once). Empty:
 *  the project has none configured, and the reviews are the only gate. */
export function deliveryChecksOf(s: OrchState, runId: string): string[] {
  const ids = new Set<string>()
  for (const t of s.tasks) if (t.runId === runId) for (const id of checkConfigIdsOf(t)) ids.add(id)
  const run = s.runs.find((r) => r.id === runId)
  const job = run && jobOf(s, run)
  const test = job && projectOfJob(s, job)?.testConfigId
  if (test) ids.add(test)
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
  const branch = patch.branch == null ? undefined : branchNameOf(patch.branch)
  if (branch === null) return { ok: false, error: `not a branch name: ${JSON.stringify(patch.branch)}` }
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

/** Sets a plan's own target branch (`deliveryBranchOf`); null clears it, back to its project's. */
export function setJobDeliveryBranch(s: OrchState, jobId: string, branch: string | null): Res<Job> {
  const found = s.jobs.find((j) => j.id === jobId)
  if (!found) return { ok: false, error: `unknown job: ${jobId}` }
  const name = branch === null ? undefined : branchNameOf(branch)
  if (name === null) return { ok: false, error: `not a branch name: ${JSON.stringify(branch)}` }
  const { deliveryBranch: _old, ...rest } = found
  const next: Job = name === undefined ? rest : { ...found, deliveryBranch: name }
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
export function afterAttempt(
  prev: DeliveryProgress | undefined,
  at: string,
  error?: string,
  opts?: { ask?: boolean; /** T1: the stop's code (PushStop), kept as `lastCode` */ code?: string }
): DeliveryProgress {
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
    ...(opts?.code !== undefined ? { lastCode: opts.code } : {}),
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

// ── T5: a hands-free plan mends a failed delivery validation itself ──

/** Whether a plan runs with no person approving: hands-off, or auto-approve (the plan's own, else its project's). */
export const handsFreeOf = (s: OrchState, job: Job): boolean =>
  handsOffOf(s, job) || (job.autoApprove ?? projectOfJob(s, job)?.autoApprove) === true

/** The words every delivery fix Task's spec holds. A fix Task hangs off the Run's last Task, as an integration Task does,
 *  and the Run's own Tasks are counted by these words, not by a stored counter. */
export const DELIVERY_FIX_MARK = 'make the delivery checks pass on the merged result'

const isDeliveryFix = (t: Task): boolean => t.parentId !== undefined && t.spec.includes(DELIVERY_FIX_MARK)

export const deliveryFixesOf = (s: OrchState, runId: string): Task[] => s.tasks.filter((t) => t.runId === runId && isDeliveryFix(t))

/** A fix Task that itself failed (retries spent) is a fix attempt run out: true when the Run has failed Tasks and every
 *  one of them is a delivery fix Task, so the owner is asked as after FAILURE_LIMIT fixes, not told "not completed". */
export const onlyDeliveryFixesFailed = (s: OrchState, runId: string): boolean => {
  const failed = s.tasks.filter((t) => t.runId === runId && t.status === 'failed')
  return failed.length > 0 && failed.every(isDeliveryFix)
}

/** What a failed delivery validation of this Run leads to: `fix` a fix Task (no owner question meanwhile), `owner`
 *  FAILURE_LIMIT fix Tasks did not make it pass, so the owner is asked now; null: not a hands-free plan with a plan
 *  branch (the Run's worktree, where a fix Task works), so the retries and the owner question go as for any stop. */
export function deliveryFixOf(s: OrchState, run: JobRun): 'fix' | 'owner' | null {
  const job = jobOf(s, run)
  if (!job || run.worktree === undefined || !handsFreeOf(s, job)) return null
  return deliveryFixesOf(s, run.id).length < FAILURE_LIMIT ? 'fix' : 'owner'
}

/** The spec of the `n`th fix Task: it works in the plan branch (`runRoot`), merges origin's branch in first so it stands
 *  on the merged result the delivery validated, and holds the failing checks' output (`reason`, its tail). */
export function buildDeliveryFixSpec(a: { runRoot: string; branch?: string; reason: string; n: number }): string {
  const origin = a.branch === undefined ? 'origin/HEAD' : `origin/${a.branch}`
  const fetch = a.branch === undefined ? 'git fetch origin' : `git fetch origin ${a.branch}`
  return `This plan's delivery stopped: its checks failed on the merged result (this plan branch with ${origin} merged
in), so nothing was pushed. Your task: ${DELIVERY_FIX_MARK} (fix ${a.n} of ${FAILURE_LIMIT}).

The repository is at ${a.runRoot}, on the plan branch, and that is your working directory. Do not switch branches
and do not create a new one.

1. ${fetch} && git merge --no-edit ${origin}
   A conflict is resolved so both sides' work survives; never \`git merge --abort\` or \`git reset --hard\`.
2. Make the failing checks below pass. Fix the cause; never skip, delete or weaken a test or a check.
3. Run the checks that failed (heavy jobs through \`astera heavy -- <cmd>\`), then commit everything:
   \`git status --porcelain\` must print nothing when you are done.

Once you report, Astera validates the merged result again and delivers it.

What failed:
${a.reason.slice(-4000)}
`
}

// ── T1: delivery state machine ──

/** The states the owner may settle by hand (`run-deliver --ownerPushed`, `run-delivery-dismiss`): a delivery that
 *  failed, is being retried or waits on the owner, and a Run from before `deliveryState` existed that has only an error. */
export function ownerMaySettle(run: JobRun): boolean {
  const p = run.deliveryState
  if (p === undefined) return run.delivery?.error !== undefined || run.pr?.error !== undefined
  return p.state === 'failed' || p.state === 'retrying' || p.state === 'needs-owner'
}

/** The Run with its delivery errors cleared (`pr.error`, `delivery.error`), the records themselves kept: a Run with a
 *  `pr` or `delivery` record reads as past its final check (running.ts checkPending). */
export function withoutDeliveryError(run: JobRun): JobRun {
  const out = { ...run }
  if (run.pr?.error !== undefined) {
    const { error: _e, ...pr } = run.pr
    out.pr = pr
  }
  if (run.delivery?.error !== undefined) {
    const { error: _e, ...delivery } = run.delivery
    out.delivery = delivery
  }
  return out
}

/** Marks the open owner question of a delivery answered, so the Inbox does not keep asking about a settled one. */
const answerQuestion = (s: OrchState, questionId: string | undefined, body: string): OrchState =>
  questionId === undefined
    ? s
    : { ...s, messages: s.messages.map((m) => (m.id === questionId && !m.answered ? { ...m, answered: true, answerBody: body } : m)) }

/** T1: the plan's pull request was merged or closed on GitHub: its delivery ends there. The PR record loses its draft
 *  mark and its error (nothing is marked ready or retried on it again), and the delivery reads delivered, a closed one
 *  with the note `closed on GitHub`. */
export function landedOnGitHub(s: OrchState, runId: string, landed: 'merged' | 'closed', at: string): OrchState {
  const run = s.runs.find((r) => r.id === runId)
  if (!run) return s
  const p = run.deliveryState
  const next: DeliveryProgress = {
    state: 'delivered',
    attempts: p?.attempts ?? 0,
    lastAttemptAt: at,
    ...(p?.questionId !== undefined ? { questionId: p.questionId } : {}),
    ...(landed === 'closed' ? { note: 'closed on GitHub' } : {})
  }
  const clean = withoutDeliveryError(run)
  const { draft: _d, wavesDone: _w, ...pr } = clean.pr ?? { at }
  const out = { ...s, runs: s.runs.map((r) => (r.id === runId ? { ...clean, pr: { ...pr, landed }, deliveryState: next } : r)) }
  return answerQuestion(out, p?.questionId, landed === 'merged' ? 'merged on GitHub' : 'closed on GitHub')
}

/** T1: the owner dismissed a failed delivery (`run-delivery-dismiss`): its errors go, it reads `dismissed` (not failed,
 *  never attempted again) and its open owner question is answered. */
export function dismissDelivery(s: OrchState, runId: string, at: string): Res<DeliveryProgress> {
  const run = s.runs.find((r) => r.id === runId)
  if (!run) return { ok: false, error: `unknown run: ${runId}` }
  if (!ownerMaySettle(run)) return { ok: false, error: 'This Run has no failed delivery to dismiss' }
  const p = run.deliveryState
  const next: DeliveryProgress = {
    state: 'dismissed',
    attempts: p?.attempts ?? 0,
    lastAttemptAt: at,
    ...(p?.questionId !== undefined ? { questionId: p.questionId } : {})
  }
  const out = { ...s, runs: s.runs.map((r) => (r.id === runId ? { ...withoutDeliveryError(r), deliveryState: next } : r)) }
  return { ok: true, state: answerQuestion(out, p?.questionId, 'dismissed'), value: next }
}
