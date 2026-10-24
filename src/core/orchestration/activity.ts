// The activity feed (orchestrator SPEC §9, W3-A): what happened across every project and plan, as one stream, with the
// plan, Task, session, model and account on each line; the summaries it gives ("what finished in the last 15
// minutes"); and the notices it raises, deduped and rate limited.
//
// **Derived, like the public events (publicEvents.ts), never written by the code that moves the state.** Each commit's
// two states go through `deriveActivity`; the Host keeps the result in a second instance of its event log
// (src/host/eventLog.ts, `activity.jsonl`), bounded the same way and read back at its start. The public events stay the
// SDK's contract; these are the app's own lines, so they can name a model, an account and a cancellation without
// widening that contract.
//
// **No second copy of a rule.** A Task's bucket (done, failed, cancelled, awaiting review) is `taskBoardsOf`'s
// (blocked.ts), a Run's ending is `outcomeOfTasks`'s (running.ts), a plan awaiting approval is
// `pendingStart && plannerSessionIds !== undefined` (W2-A), a plan that holds is `validatePlan`'s, a plan's name is
// `jobNameOf`'s.
//
// **Two lines no commit makes** (W5-D), recorded by the Host from its sessions' hook events instead: a plan ready for
// approval (host/activity.ts `planReadyActivity`, at the planner's turn end: the commit that marks a plan pending comes when the planner
// *starts*, #48) and a worker waiting at a permission prompt or a question (`waitingActivity`, #42).
//
// Pure: no clock (the log stamps each event), no files.
import type { TaskBlockedReason, TaskCategory, UsagePause } from '../types'
import type { UsageChange } from './usageGuard'
import { taskBoardsOf } from './blocked'
import { jobNameOf } from './jobName'
import { heldForOwner, outcomeOfTasks } from './running'
import { completionSettled, replanOn } from './replan'
// W8-C plan after plan
import { afterStoppedText } from './after'
// W8-D several plans in one repo
import { overlapLines } from './overlap'
import type { DeliveryOffReason } from './deliveryChoices'
import type { ScheduleLimits } from './schedule'
import { emptyState, OWNER_ANSWER_SUBJECT, type OrchState } from './state'
import {
  isPlaceholderSessionId,
  type Decision,
  type DeliveryMode,
  type Dispatch,
  type Gate,
  type GateKind,
  type Job,
  type Outcome,
  type PlanOverlap,
  type RunPr,
  type Task,
  type TaskLinks,
  type TaskStatus,
  type WorkerState
} from './types'

export const ACTIVITY_KINDS = [
  'task.status',
  'dispatch.started',
  'dispatch.exited',
  'dispatch.rolled',
  'dispatch.resumed',
  'gate.opened',
  'gate.resolved',
  'task.links',
  'run.pr',
  'plan.awaiting-approval',
  // W8-F (#94): the planner finished a feedback round but the plan does not hold (payload.problems); feed only
  'plan.incomplete',
  'plan.done',
  // W5-D (#42): a worker's session at a permission prompt or a question (waitingActivity)
  'task.waiting',
  // W6-D: a replan began / ended between waves or as the final check (replan.ts)
  'plan.replanning',
  'plan.replanned',
  // W6-A: the planner found everything built (`plan-nothing-to-do`); feed and notice
  'plan.nothing-to-do',
  // W6-B: a worker's question a coordinator answered (feed only; T21's own answers below share the kind), and something
  // only the owner can decide (a notice and the chime): a worker's or coordinator's `send --type escalation`, or a Gate
  // opened because the attempts ran out. W6-D raises it too, when a replan is handed to the person
  'task.escalated',
  // W6-G: no new worker starts on an account near its usage limit, and then may again (usageActivity)
  'usage.paused',
  'usage.resumed',
  // T5b: a start went to another account than the one it named, which was full or at its cap (payload.reason)
  'account.switched',
  // W6-H: a finished plan pushed to its delivery branch (a feed line and a notice, no chime). A push that stopped is an
  // escalation instead (delivery.ts recordDelivery)
  'plan.delivered',
  // W7-A: a plan started with no approval step (autoApprove)
  'plan.auto-started',
  // W8-D: a plan's Tasks newly meet another plan's of the same project (Job.overlaps): feed and notice, no chime
  'plan.overlap',
  // #111: the owner rejected a plan (`jobs-reject`); the Job is archived with `rejected`. Feed only (the Inbox's handled list too)
  'plan.rejected',
  // T20: the owner told the planner in its terminal to run the plan (payload.reason: their words); feed only
  'plan.chat-approved',
  // Coordinator rotation: a fresh coordinator took the Run's slot (JobRun.coordinatorRefreshes); feed only
  'coordinator.refreshed',
  // Stall watchdog (exec/stallWatch.ts): one line per action it took on a stalled plan (payload.reason); feed only
  'watchdog',
  // T21 (exec/autoAnswer.ts): one line per question Astera answered itself (payload.reason); feed only
  'question.auto-answered',
  // T23 (exec/crashResume.ts): what the Host's start picked up after a crash (payload.reason); feed only
  'host.recovered',
  // #117: a call a hands-off plan made in the owner's place, and a guardrail case it refused (Job.decisions); feed only,
  // the plan.done notice lists them
  'plan.decided',
  'plan.refused',
  // T7: the owner changed a run Task's deps, spec, basis or evidence before it started (task-update); feed only
  'task.edited',
  // T34: the owner dismissed a failed delivery (`run-delivery-dismiss`); feed only
  'plan.deliveryDismissed'
] as const
export type ActivityKind = (typeof ACTIVITY_KINDS)[number]

export interface ActivityPayload {
  /** What the line is about: the Task's title, or the plan's name for a plan's line. */
  title: string
  /** The plan's name (`jobNameOf`). */
  plan?: string
  model?: string
  accountId?: string
  /** T5b account.switched: the account the start named (`accountId` is the one it started on). */
  fromAccountId?: string
  // task.status
  status?: TaskStatus
  from?: TaskStatus
  category?: TaskCategory
  // dispatch.*
  review?: boolean
  outcome?: Outcome
  workerState?: WorkerState
  closedBy?: Dispatch['closedBy']
  rollReason?: 'waiting' | 'switching'
  resetsAt?: string
  toAccountId?: string
  // gate.*
  gateId?: string
  question?: string
  gateKind?: GateKind
  resolution?: string
  // task.links, run.pr
  links?: TaskLinks
  pr?: RunPr
  // plan.done
  runOutcome?: 'completed' | 'failed' | 'blocked'
  /** W8-E (#99): a failed plan's failed Tasks; its final check is skipped. */
  failedTasks?: number
  /** Item 2: a plan that finished with Tasks held for the owner: each one as "title: what it waits for". */
  blockedTasks?: string[]
  // task.waiting (W5-D, #42)
  waitingFor?: 'permission' | 'question'
  // plan.replanning / plan.replanned (W6-D)
  replanMode?: 'wave' | 'completion'
  /** The wave about to start (a completion pass: the one after the last). */
  wave?: number
  /** plan.replanned: what the replan changed, one line. */
  // plan.nothing-to-do (W6-A): the planner's summary (inputs/existing.md)
  summary?: string
  // question.auto-answered (W6-B; `question` above is the worker's question)
  answer?: string
  /** W7-C (#72): the owner answered it (from the card, the inbox or `questions answer`), not the coordinator. */
  answeredBy?: 'owner'
  // task.escalated (W6-B): the escalation's subject, else its body; a Gate's question; W6-D: why the replan escalated
  reason?: string
  // usage.* (W6-G); also accountId and resetsAt
  usageWindow?: UsagePause['window']
  percent?: number
  // plan.auto-started / plan.awaiting-approval (W7-A)
  tasks?: number
  round?: number
  changes?: string[]
  // plan.incomplete (W8-F)
  problems?: string[]
  // plan.delivered (W6-H)
  branch?: string
  sha?: string
  // plan.overlap (W8-D): the new overlaps, one line each (overlapLines)
  overlaps?: string[]
  /** #117: the plan runs hands-off: nothing on it asks the owner, so its Gates and escalations raise no notice. */
  handsOff?: true
  /** #117 plan.done of a hands-off plan: each decision it made for the owner, one line (decisionLine). */
  decisions?: string[]
  // task.edited (T7)
  /** What the owner changed, in this order: deps, spec, basis, evidence. */
  edited?: EditedField[]
  /** T32 watchdog line of a plan whose saved delivery cannot work on its folder: how it lands instead and why. */
  deliveryFallback?: { mode: DeliveryMode; reason: DeliveryOffReason; branch?: string }
}

/** T7: the run Task fields whose change is a task.edited line. */
export const EDITED_FIELDS = ['deps', 'spec', 'basis', 'evidence'] as const
export type EditedField = (typeof EDITED_FIELDS)[number]

/** One line before the log numbers and stamps it (the shape of publicEvents.ts's EventDraft). */
export interface ActivityDraft {
  type: ActivityKind
  projectId?: string
  jobId?: string
  runId?: string
  taskId?: string
  sessionId?: string
  payload: ActivityPayload
}

/** One line as the log keeps it (eventRing.ts gives it its id, sequence and time). */
export interface ActivityEvent extends ActivityDraft {
  id: string
  sequence: number
  occurredAt: string
  /** W5-D (#44): the paired Runtime whose Host keeps the line; absent for the local Host's (orchRouter.ts `everywhere`). */
  runtimeId?: string
}

const byId = <T extends { id: string }>(xs: readonly T[]): Map<string, T> => new Map(xs.map((x) => [x.id, x]))

/** #117: handsOffOf (delivery.ts) as this renderer-safe module can read it. shortcut: by `projectId` only (the folder
 *  fallback of projectOfJob needs node:path), so an old Job with none reads its own setting; the Host sets it on new Jobs. */
const handsOffHere = (s: OrchState, job: Job): boolean =>
  job.handsOff ?? (job.projectId !== undefined ? s.projects.find((p) => p.id === job.projectId)?.handsOff : undefined) ?? false

/** #117: one decision as a line: "Decided for you: retry-once — Fix login: the attempts ran out: one more try". */
export function decisionLine(d: Decision, taskTitle?: string): string {
  const about = taskTitle ?? d.question
  return d.kind === 'refused' ? `Refused: ${d.question} (${d.why})` : `Decided for you: ${d.choice} — ${about}: ${d.why}`
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** A Task's bucket, asked of `taskBoardsOf` with the Task and its own Dispatches alone: the bucket reads nothing else,
 *  and with no Job in the state the reasons (which do read the rest) are skipped. */
const categoryOf = (t: Task, ds: readonly Dispatch[]): TaskCategory =>
  taskBoardsOf({ ...emptyState(), tasks: [t], dispatches: [...ds] }).get(t.id)!.category

/** The Dispatch a Task's line names: its open one, else its latest; a worker before a review. */
const dispatchOf = (ds: readonly Dispatch[]): Dispatch | undefined => {
  const sorted = [...ds].sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  return sorted.find((d) => d.endedAt === undefined && !d.review) ?? sorted.at(-1)
}

export function deriveActivity(prev: OrchState, next: OrchState): ActivityDraft[] {
  if (prev === next) return []
  // Most commits move only messages and deliveries (a heartbeat): nothing to read then. W6-B reads a message that was
  // added (an escalation, a reply's status line); acks and deliveries change messages without adding one.
  const newMessages = prev.messages.length !== next.messages.length
  if (!newMessages && prev.tasks === next.tasks && prev.dispatches === next.dispatches && prev.gates === next.gates && prev.runs === next.runs && prev.jobs === next.jobs)
    return []
  const out: ActivityDraft[] = []
  const runs = byId(next.runs)
  const jobs = byId(next.jobs)
  const tasks = byId(next.tasks)
  const where = (runId: string | undefined, taskId?: string): Omit<ActivityDraft, 'type' | 'payload'> & { job?: Job } => {
    const job = runId === undefined ? undefined : jobs.get(runs.get(runId)?.jobId ?? '')
    return {
      ...(job?.projectId !== undefined ? { projectId: job.projectId } : {}),
      ...(job !== undefined ? { jobId: job.id, job } : {}),
      ...(runId !== undefined ? { runId } : {}),
      ...(taskId !== undefined ? { taskId } : {})
    }
  }
  const push = (type: ActivityKind, at: ReturnType<typeof where>, payload: ActivityPayload, sessionId?: string): void => {
    const { job, ...ids } = at
    out.push({
      type,
      ...ids,
      ...(sessionId !== undefined ? { sessionId } : {}),
      payload: { ...(job !== undefined ? { plan: jobNameOf(job) } : {}), ...(job !== undefined && handsOffHere(next, job) ? { handsOff: true as const } : {}), ...payload }
    })
  }
  const dispatchesOf = (s: OrchState): Map<string, Dispatch[]> => {
    const m = new Map<string, Dispatch[]>()
    for (const d of s.dispatches) m.set(d.taskId, [...(m.get(d.taskId) ?? []), d])
    return m
  }
  const taskWho = (t: Task, d: Dispatch | undefined): Pick<ActivityPayload, 'model' | 'accountId'> => {
    const model = d?.model ?? t.model
    return { ...(model !== undefined ? { model } : {}), ...(d !== undefined ? { accountId: d.accountId } : {}) }
  }
  // #117: a hands-off plan's end lists what it decided for the owner
  const decisionsOf = (job: Job | undefined): Pick<ActivityPayload, 'decisions'> =>
    job !== undefined && handsOffHere(next, job)
      ? { decisions: (job.decisions ?? []).map((d) => decisionLine(d, d.taskId !== undefined ? tasks.get(d.taskId)?.title : undefined)) }
      : {}
  const realSession = (d: Dispatch | undefined): string | undefined =>
    d !== undefined && !isPlaceholderSessionId(d.sessionId) ? d.sessionId : undefined

  // Tasks: a status or bucket that moved. A Dispatch closed by a person moves the bucket (cancelled) and not the status.
  if (prev.tasks !== next.tasks || prev.dispatches !== next.dispatches) {
    const before = byId(prev.tasks)
    const dsBefore = dispatchesOf(prev)
    const dsNow = prev.dispatches === next.dispatches ? dsBefore : dispatchesOf(next)
    const affected = new Set<string>()
    for (const t of next.tasks) if (before.get(t.id) !== t) affected.add(t.id)
    if (prev.dispatches !== next.dispatches) {
      const was = byId(prev.dispatches)
      for (const d of next.dispatches) if (was.get(d.id) !== d) affected.add(d.taskId)
    }
    for (const id of affected) {
      const t = tasks.get(id)
      const was = before.get(id)
      // A new Task (a Run copying its plan's Tasks) is no news yet: its first move is
      if (t === undefined || t.runId === undefined || was === undefined) continue
      const ds = dsNow.get(id) ?? []
      const category = categoryOf(t, ds)
      const from = categoryOf(was, dsBefore.get(id) ?? [])
      if (was.status === t.status && from === category) continue
      const d = dispatchOf(ds)
      // Blocked with no Gate opened beside it: the scheduler gave up on a Gate the owner's plan kept refusing. One notice,
      // hands-off plan or not (its reason is the Task's result).
      if (t.status === 'blocked' && was.status !== 'blocked' && prev.gates === next.gates)
        push('task.escalated', where(t.runId, t.id), { title: t.title, reason: t.result ?? 'blocked', handsOff: undefined })
      push(
        'task.status',
        where(t.runId, t.id),
        { title: t.title, status: t.status, from: was.status, category, ...taskWho(t, d) },
        realSession(d)
      )
    }
    for (const t of next.tasks) {
      const was = before.get(t.id)
      if (was === undefined || was === t || t.runId === undefined || same(was.links, t.links)) continue
      push('task.links', where(t.runId, t.id), { title: t.title, ...(t.links !== undefined ? { links: t.links } : {}) })
    }
    // T7: the owner re-planned a Task of a running plan. A replan's own edits are its plan.replanned line instead.
    for (const t of next.tasks) {
      const was = before.get(t.id)
      if (was === undefined || was === t || t.runId === undefined) continue
      const edited = EDITED_FIELDS.filter((f) =>
        f === 'deps' ? !same(was.deps, t.deps) : f === 'spec' ? was.spec !== t.spec : f === 'basis' ? was.basis?.state !== t.basis?.state : was.basis?.evidence !== t.basis?.evidence
      )
      if (edited.length === 0) continue
      const at = where(t.runId, t.id)
      if (at.job?.replanning !== undefined || prev.jobs.find((j) => j.id === at.jobId)?.replanning !== undefined) continue
      push('task.edited', at, { title: t.title, edited })
    }
  }

  // Dispatches: a worker's session started (not its `pending:` placeholder), ended, rolled at a limit, resumed.
  if (prev.dispatches !== next.dispatches) {
    const before = byId(prev.dispatches)
    for (const d of next.dispatches) {
      const was = before.get(d.id)
      if (was === d) continue
      const t = tasks.get(d.taskId)
      if (t === undefined || t.runId === undefined) continue
      const at = where(t.runId, t.id)
      const base: ActivityPayload = { title: t.title, accountId: d.accountId, ...(d.model ?? t.model ? { model: d.model ?? t.model } : {}), ...(d.review ? { review: true } : {}) }
      const session = realSession(d)
      if (session !== undefined && realSession(was) === undefined) push('dispatch.started', at, base, session)
      if (d.endedAt !== undefined && was?.endedAt === undefined)
        push(
          'dispatch.exited',
          at,
          { ...base, workerState: d.workerState, ...(d.outcome ? { outcome: d.outcome } : {}), ...(d.closedBy ? { closedBy: d.closedBy } : {}) },
          session
        )
      const entries = d.resumes ?? []
      const old = was?.resumes ?? []
      entries.forEach((e, i) => {
        if (i >= old.length)
          push('dispatch.rolled', at, { ...base, accountId: e.fromAccountId, rollReason: e.reason, ...(e.resetsAt ? { resetsAt: e.resetsAt } : {}) }, session)
        if (e.resumedAt !== undefined && old[i]?.resumedAt === undefined)
          push('dispatch.resumed', at, { ...base, accountId: e.fromAccountId, ...(e.toAccountId ? { toAccountId: e.toAccountId } : {}) }, session)
      })
    }
  }

  if (prev.gates !== next.gates) {
    const before = byId(prev.gates)
    for (const g of next.gates) {
      const was = before.get(g.id)
      if (was === g) continue
      const title = tasks.get(g.taskId)?.title ?? g.taskId
      const gate = { gateId: g.id, question: g.question, ...(g.kind ? { gateKind: g.kind } : {}) }
      if (was === undefined && g.status === 'open') {
        push('gate.opened', where(g.runId, g.taskId), { title, ...gate })
        // W6-B: the attempts ran out (W6-C's review cap too), so only the owner can move it on
        if (gateEscalates(g)) push('task.escalated', where(g.runId, g.taskId), { title, gateId: g.id, reason: g.question })
      }
      if (g.status === 'resolved' && was?.status !== 'resolved')
        push('gate.resolved', where(g.runId, g.taskId), { title, ...gate, ...(g.resolution !== undefined ? { resolution: g.resolution } : {}) })
    }
  }

  if (prev.runs !== next.runs) {
    const before = byId(prev.runs)
    for (const r of next.runs) {
      const was = before.get(r.id)
      if (was === undefined || was === r || same(was.pr, r.pr)) continue
      const at = where(r.id)
      push('run.pr', at, { title: at.job ? jobNameOf(at.job) : r.id, ...(r.pr !== undefined ? { pr: r.pr } : {}) })
    }
    // W6-H: the push landed
    for (const r of next.runs) {
      const was = before.get(r.id)
      if (r.delivery?.sha === undefined || was === undefined || was.delivery?.sha === r.delivery.sha) continue
      const at = where(r.id)
      push('plan.delivered', at, { title: at.job ? jobNameOf(at.job) : r.id, sha: r.delivery.sha, ...(r.delivery.branch !== undefined ? { branch: r.delivery.branch } : {}) })
    }
    // T1: the owner dismissed a failed delivery (`run-delivery-dismiss`)
    for (const r of next.runs) {
      const was = before.get(r.id)
      if (r.deliveryState?.state !== 'dismissed' || was === undefined || was.deliveryState?.state === 'dismissed') continue
      const at = where(r.id)
      push('plan.deliveryDismissed', at, { title: at.job ? jobNameOf(at.job) : r.id })
    }
    // Coordinator rotation: each refresh added since the last commit, by its new session
    for (const r of next.runs) {
      const was = before.get(r.id)
      if (was === undefined || was.coordinatorRefreshes === r.coordinatorRefreshes) continue
      const seen = new Set((was.coordinatorRefreshes ?? []).map((x) => x.to))
      const at = where(r.id)
      for (const x of r.coordinatorRefreshes ?? [])
        if (!seen.has(x.to)) push('coordinator.refreshed', at, { title: at.job ? jobNameOf(at.job) : r.id, reason: x.reason }, x.to)
    }
  }

  // W6-A: a plan that ended before approval because everything it asks for is built
  if (prev.jobs !== next.jobs) {
    const was = byId(prev.jobs)
    for (const j of next.jobs) {
      // T20: approved from the planner chat
      if (j.approvedFromChat !== undefined && was.get(j.id)?.approvedFromChat === undefined)
        push('plan.chat-approved', { ...(j.projectId !== undefined ? { projectId: j.projectId } : {}), jobId: j.id, job: j }, { title: jobNameOf(j), reason: j.approvedFromChat.words })
      // W7-A: started with no approval step (jobs-auto-start)
      if (j.autoStartedAt !== undefined && was.get(j.id)?.autoStartedAt === undefined)
        push(
          'plan.auto-started',
          { ...(j.projectId !== undefined ? { projectId: j.projectId } : {}), jobId: j.id, job: j },
          { title: jobNameOf(j), tasks: next.runs.filter((r) => r.jobId === j.id).reduce((n, r) => n + next.tasks.filter((t) => t.runId === r.id).length, 0) }
        )
      // W8-C plan after plan: the plan it is queued after stopped (after.ts afterSweep), escalated once per stop
      if (j.afterStopNotified !== undefined && was.get(j.id)?.afterStopNotified === undefined)
        push(
          'task.escalated',
          { ...(j.projectId !== undefined ? { projectId: j.projectId } : {}), jobId: j.id, job: j },
          { title: jobNameOf(j), reason: afterStoppedText(next, j) }
        )
      // W8-D: overlaps this commit added, against the ones the plan had
      if (j.overlaps !== undefined && j.overlaps !== was.get(j.id)?.overlaps) {
        // By the other plan and the spot, not the Task ids: starting a Run copies its Tasks under new ids
        const keyOf = (o: PlanOverlap): string => `${o.jobId}|${o.by}|${o.path ?? o.issue}`
        const had = new Set((was.get(j.id)?.overlaps ?? []).map(keyOf))
        const added = j.overlaps.filter((o) => !had.has(keyOf(o)))
        if (added.length > 0)
          push(
            'plan.overlap',
            { ...(j.projectId !== undefined ? { projectId: j.projectId } : {}), jobId: j.id, job: j },
            { title: jobNameOf(j), overlaps: overlapLines(next, { ...j, overlaps: added }) }
          )
      }
      // #117: the decisions this commit added, one line each
      const had = was.get(j.id)?.decisions?.length ?? 0
      for (const d of (j.decisions ?? []).slice(had)) {
        const title = d.taskId !== undefined ? tasks.get(d.taskId)?.title : undefined
        push(
          d.kind === 'refused' ? 'plan.refused' : 'plan.decided',
          { ...(j.projectId !== undefined ? { projectId: j.projectId } : {}), jobId: j.id, job: j, ...(d.taskId !== undefined ? { taskId: d.taskId } : {}) },
          { title: title ?? jobNameOf(j), reason: decisionLine(d, title).slice(0, 1000) }
        )
      }
      // #111: rejected (`jobs-reject`) in this commit; the archived Job is still in next.jobs, so this runs before any skip
      if (j.rejected !== undefined && was.get(j.id)?.rejected === undefined)
        push(
          'plan.rejected',
          { ...(j.projectId !== undefined ? { projectId: j.projectId } : {}), jobId: j.id, job: j },
          { title: jobNameOf(j), ...(j.rejected.reason !== undefined ? { reason: j.rejected.reason } : {}) }
        )
      if (j.nothingToDo === undefined || was.get(j.id)?.nothingToDo !== undefined) continue
      push(
        'plan.nothing-to-do',
        { ...(j.projectId !== undefined ? { projectId: j.projectId } : {}), jobId: j.id, job: j },
        { title: jobNameOf(j), summary: j.nothingToDo.summary.slice(0, 2000) }
      )
    }
  }
  // W6-B: the messages this commit added. A reply adds its `status` line (applyReply, `replyTo` the question), so the
  // answer is read off that line; an empty answer is the cleanup settlePendingQuestions leaves, never a reply.
  if (newMessages) {
    const was = new Set(prev.messages.map((m) => m.id))
    const byMsg = byId(next.messages)
    for (const m of next.messages) {
      if (was.has(m.id)) continue
      const taskTitle = m.taskId !== undefined ? tasks.get(m.taskId)?.title : undefined
      const at = where(m.runId, m.taskId)
      const title = taskTitle ?? (at.job ? jobNameOf(at.job) : m.runId)
      if (m.type === 'escalation') {
        push('task.escalated', at, { title, reason: (m.subject || m.body).slice(0, 500) }, sessionOfDispatch(next, m.dispatchId))
        continue
      }
      const q = m.type === 'status' && m.replyTo !== undefined ? byMsg.get(m.replyTo) : undefined
      // W7-C (#72): an owner's answer is a feed line too, "answered by you", never a notice
      const byOwner = m.subject === OWNER_ANSWER_SUBJECT ? { answeredBy: 'owner' as const } : {}
      if (q?.type === 'escalation' && 'answeredBy' in byOwner) {
        push('question.auto-answered', at, { title, question: (q.subject || q.body).slice(0, 500), answer: (q.answerBody ?? '').slice(0, 500), ...byOwner }, sessionOfDispatch(next, q.dispatchId))
        continue
      }
      if (q?.type !== 'question' || (q.answerBody ?? '') === '') continue
      push('question.auto-answered', at, { title, question: q.body.slice(0, 500), answer: q.answerBody!.slice(0, 500), ...byOwner }, sessionOfDispatch(next, q.dispatchId))
    }
  }

  // Last, so a plan's ending follows the Task lines that ended it. Only a Run in both states that was running.
  if (prev.tasks !== next.tasks) {
    const group = (s: OrchState): Map<string, Task[]> => {
      const m = new Map<string, Task[]>()
      for (const t of s.tasks) if (t.runId !== undefined) m.set(t.runId, [...(m.get(t.runId) ?? []), t])
      return m
    }
    const was = group(prev)
    const now = group(next)
    const prevRuns = new Set(prev.runs.map((r) => r.id))
    for (const [runId, ts] of now) {
      if (!prevRuns.has(runId) || !runs.has(runId) || outcomeOfTasks(was.get(runId) ?? [], prev.gates) !== 'running') continue
      const outcome = outcomeOfTasks(ts, next.gates)
      if (outcome === 'running' || outcome === 'checking') continue
      const at = where(runId)
      // W6-D: a plan that replans is done only when its final check settles having added nothing, which the check's end
      // says (below). Never here: a completion pass that covered this many done Tasks before is not this one's check (item 8)
      if (outcome === 'completed' && at.job && (replanOn(at.job) || !completionSettled(next, at.job, runId))) continue
      // W8-E (#99): a failed plan ends here, with no final check (replan.ts replansDue asks for an all-completed Run)
      const failedTasks = outcome === 'failed' ? ts.filter((t) => t.status === 'failed').length : undefined
      // Item 2: so does a plan whose other Tasks all ended around the ones held for the owner
      const blockedTasks = outcome === 'blocked' ? ts.filter((t) => heldForOwner(t, next.gates)).map((t) => `${t.title}: ${t.result ?? 'blocked'}`.slice(0, 300)) : undefined
      push('plan.done', at, {
        title: at.job ? jobNameOf(at.job) : runId,
        runOutcome: outcome,
        ...(failedTasks !== undefined ? { failedTasks } : {}),
        ...(blockedTasks !== undefined ? { blockedTasks } : {}),
        ...decisionsOf(at.job)
      })
    }
  }
  // W6-D: a replan's start and end, from the Job's marks (replan.ts). A final check that added nothing is the plan done.
  if (prev.jobs !== next.jobs) {
    const before = byId(prev.jobs)
    for (const j of next.jobs) {
      const was = before.get(j.id)
      if (was === undefined || was === j) continue
      const title = jobNameOf(j)
      if (j.replanning && !was.replanning)
        push('plan.replanning', where(j.replanning.runId), { title, replanMode: j.replanning.mode, wave: j.replanning.wave })
      const last = j.lastReplan
      // W7-E (#74): by value, as run.pr above: a state read back from disk or the socket is a new object, and the same
      // final check was reported again (plan.replanned + plan.done twice for one pass)
      if (!last || same(last, was.lastReplan)) continue
      const at = where(last.runId)
      if (last.escalated !== undefined) {
        push('task.escalated', at, { title, reason: last.escalated })
        continue
      }
      push('plan.replanned', at, { title, replanMode: last.mode, wave: last.wave, summary: last.summary })
      const ts = next.tasks.filter((t) => t.runId === last.runId)
      if (last.mode === 'completion' && outcomeOfTasks(ts, next.gates) === 'completed' && completionSettled(next, j, last.runId))
        push('plan.done', at, { title, runOutcome: 'completed', ...decisionsOf(j) })
    }
  }
  return out
}

/** W6-B: a Gate that only the owner can move on, which escalates: the convergence attempts ran out, or W6-C's review
 *  cap (`reason: 'review-rounds-exhausted'`). */
export const gateEscalates = (g: Gate): boolean =>
  g.kind === 'convergence-exhausted' ||
  // shortcut: Gate.reason is W6-C's field, read untyped until W6 merges; type it then
  (g as Gate & { reason?: string }).reason === 'review-rounds-exhausted'

const sessionOfDispatch = (s: OrchState, dispatchId: string | undefined): string | undefined => {
  const id = dispatchId === undefined ? undefined : s.dispatches.find((d) => d.id === dispatchId)?.sessionId
  return id !== undefined && !isPlaceholderSessionId(id) ? id : undefined
}

export const awaitsApproval = (j: Job | undefined): boolean => j?.pendingStart === true && j.plannerSessionIds !== undefined

/** #42: the worker whose session `sessionId` turned to waiting on a person, as a `task.waiting` line: its open
 *  Dispatch's Task, plan, model and account, and what it waits on. null for a session that is no open Dispatch's. */
export function waitingActivity(s: OrchState, sessionId: string, waitingFor: 'permission' | 'question'): ActivityDraft | null {
  const d = s.dispatches.find((x) => x.sessionId === sessionId && x.endedAt === undefined)
  const t = d && s.tasks.find((x) => x.id === d.taskId)
  if (!d || !t || t.runId === undefined) return null
  const job = s.jobs.find((j) => j.id === s.runs.find((r) => r.id === t.runId)?.jobId)
  const model = d.model ?? t.model
  return {
    type: 'task.waiting',
    ...(job?.projectId !== undefined ? { projectId: job.projectId } : {}),
    ...(job !== undefined ? { jobId: job.id } : {}),
    runId: t.runId,
    taskId: t.id,
    sessionId,
    payload: {
      title: t.title,
      ...(job !== undefined ? { plan: jobNameOf(job) } : {}),
      ...(model !== undefined ? { model } : {}),
      accountId: d.accountId,
      ...(d.review ? { review: true } : {}),
      waitingFor
    }
  }
}

/** W6-G: a usage guard's change (usageGuard.ts) as its feed line: a line no commit makes, recorded by the Host. The
 *  title is the account id; the feed shows the account's name. */
export function usageActivity(e: UsageChange): ActivityDraft {
  if (e.type === 'account.switched')
    return { type: e.type, payload: { title: e.to, accountId: e.to, fromAccountId: e.from, reason: e.reason } }
  const p = e.pause
  return {
    type: e.type,
    payload: {
      title: p.accountId,
      accountId: p.accountId,
      usageWindow: p.window,
      percent: p.percent,
      ...(p.resetsAt !== null ? { resetsAt: p.resetsAt } : {})
    }
  }
}

// ── Summaries ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ActivityItem {
  taskId?: string
  jobId?: string
  runId?: string
  title: string
  plan?: string
  model?: string
  accountId?: string
  at: string
}

export interface ActivitySummary {
  since: string
  completed: ActivityItem[]
  failed: ActivityItem[]
  cancelled: ActivityItem[]
  /** Tasks waiting on their review, and plans waiting on their approval. */
  awaitingReview: ActivityItem[]
  plansDone: Array<ActivityItem & { outcome: 'completed' | 'failed' | 'blocked' }>
  /** Every Task not running now, with why (blocked.ts), when a state was given. */
  blocked: Array<ActivityItem & { reason: TaskBlockedReason }>
}

/** Reasons that are not a block: about to start, a plan's definition copy, a plan put away. */
const NOT_BLOCKED: ReadonlySet<TaskBlockedReason['kind']> = new Set(['next', 'definition', 'archived'])

const itemOf = (e: ActivityEvent): ActivityItem => ({
  ...(e.taskId !== undefined ? { taskId: e.taskId } : {}),
  ...(e.jobId !== undefined ? { jobId: e.jobId } : {}),
  ...(e.runId !== undefined ? { runId: e.runId } : {}),
  title: e.payload.title,
  ...(e.payload.plan !== undefined ? { plan: e.payload.plan } : {}),
  ...(e.payload.model !== undefined ? { model: e.payload.model } : {}),
  ...(e.payload.accountId !== undefined ? { accountId: e.payload.accountId } : {}),
  at: e.occurredAt
})

/** What happened since `since` (ISO): each Task once, in the bucket its latest line in the window put it. With a
 *  state, the plans still awaiting approval and every Task blocked now, each with its reason (`taskBoardsOf`). */
export function summarize(events: readonly ActivityEvent[], since: string, state?: OrchState, limits: ScheduleLimits = {}): ActivitySummary {
  const window = events.filter((e) => e.occurredAt >= since)
  const latest = new Map<string, ActivityEvent>()
  for (const e of window) if (e.type === 'task.status' && e.taskId !== undefined) latest.set(e.taskId, e)
  const s: ActivitySummary = { since, completed: [], failed: [], cancelled: [], awaitingReview: [], plansDone: [], blocked: [] }
  for (const e of latest.values()) {
    const bucket = { done: s.completed, failed: s.failed, cancelled: s.cancelled, 'awaiting-review': s.awaitingReview }[e.payload.category as string]
    bucket?.push(itemOf(e))
  }
  const jobs = state ? byId(state.jobs) : undefined
  const approvals = new Map<string, ActivityEvent>()
  for (const e of window) if (e.type === 'plan.awaiting-approval' && e.jobId !== undefined) approvals.set(e.jobId, e)
  for (const e of approvals.values()) {
    const j = jobs?.get(e.jobId!)
    if (jobs === undefined || awaitsApproval(j)) s.awaitingReview.push(itemOf(e))
  }
  for (const e of window) if (e.type === 'plan.done' && e.payload.runOutcome) s.plansDone.push({ ...itemOf(e), outcome: e.payload.runOutcome })
  if (state) {
    const runs = byId(state.runs)
    for (const [taskId, board] of taskBoardsOf(state, limits)) {
      if (!board.reason || NOT_BLOCKED.has(board.reason.kind)) continue
      const t = state.tasks.find((x) => x.id === taskId)
      const job = jobs!.get(runs.get(t?.runId ?? '')?.jobId ?? '')
      if (!t || t.runId === undefined || !job) continue
      s.blocked.push({ taskId, jobId: job.id, runId: t.runId, title: t.title, plan: jobNameOf(job), at: t.updatedAt, reason: board.reason })
    }
  }
  return s
}

// ── Notices ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** One notification. `key` dedupes it; `sessionId`, when there is one, is the tab a click opens. */
export interface ActivityNotice {
  key: string
  title: string
  body: string
  sessionId?: string
  /** W6-B: it needs the owner (an escalation, a Gate), so the app chimes with it (renderer lib/alertSound.ts). */
  alert?: true
}

/** A Gate's notice key: its Task and reason, not its id. A Gate that opens again with the same reason on the same Task is the
 *  same news, so the throttle shows it once. */
const gateKey = (e: ActivityEvent, reason: string): string => `gate:${e.taskId ?? e.payload.gateId}:${reason}`

const inPlan = (e: ActivityEvent): string => (e.payload.plan !== undefined && e.payload.plan !== e.payload.title ? ` (${e.payload.plan})` : '')

/** W6-G: when a usage window resets, as this machine's clock reads it: "14:20", or "Mon 14:20" for the 7-day one. */
export function resetClock(iso: string, weekly: boolean): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { ...(weekly ? { weekday: 'short' as const } : {}), hour: '2-digit', minute: '2-digit', hour12: false })
}

/** The lines worth interrupting someone for: a Task failed, a plan ended, a question waits on a person, a plan waits
 *  on its approval, an escalation (W6-B). A coordinator's answer (`question.auto-answered`) never is. A worker waiting at a prompt (`task.waiting`) is a feed line and not a notice here: the desktop's `inputNeeded` and Slack's own notice
 *  already say it, from the session's attention (desktopNotifier.ts), and a second notice would be the flood. */
export function noticeOf(e: ActivityEvent): ActivityNotice | null {
  const session = e.sessionId !== undefined ? { sessionId: e.sessionId } : {}
  switch (e.type) {
    case 'task.status':
      return e.payload.status === 'failed' && e.payload.from !== 'failed'
        ? { key: `failed:${e.taskId}`, title: 'Task failed', body: `${e.payload.title}${inPlan(e)}`, ...session }
        : null
    case 'plan.done': {
      // W8-E (#99): no chime, nothing is asked; the failed Tasks are on the board
      const blocked = e.payload.blockedTasks ?? []
      const done: ActivityNotice =
        e.payload.runOutcome === 'failed'
          ? {
              key: `done:${e.runId}`,
              title: e.payload.failedTasks !== undefined ? `Plan finished with ${e.payload.failedTasks} failed` : 'Plan finished with failures',
              body: `${e.payload.title}. The final check was skipped.`
            }
          : e.payload.runOutcome === 'blocked'
            ? {
                // Its own key: once the owner unblocks them, the plan's "Plan done" is new news
                key: `done:${e.runId}:blocked`,
                title: `Plan finished with ${blocked.length} blocked`,
                body: [`${e.payload.title}. The rest is done; these wait on you:`, ...blocked.map((l) => `- ${l}`)].join('\n')
              }
            : { key: `done:${e.runId}`, title: 'Plan done', body: e.payload.title }
      // #117: a hands-off plan's one notice says what it decided for the owner
      return e.payload.decisions === undefined ? done : { ...done, body: `${done.body}\n${decisionsText(e.payload.decisions)}` }
    }
    case 'gate.opened':
      // #117: a hands-off plan answers its own Gates (exec/autoAnswer.ts handsOffStepsDue): nothing to tell the owner
      if (e.payload.handsOff) return null
      return { key: gateKey(e, e.payload.question ?? ''), title: 'Needs your answer', body: `${e.payload.title}${inPlan(e)}: ${e.payload.question ?? ''}`.slice(0, 240), alert: true }
    case 'plan.awaiting-approval':
      // W7-A: a plan revised for the owner's feedback is a new notice, with the chime: the owner asked for it
      return e.payload.round
        ? {
            key: `approve:${e.jobId}:${e.payload.round}`,
            title: 'Plan revised: ready for approval',
            body: `${e.payload.title}${e.payload.changes?.length ? `: ${e.payload.changes.join('; ')}` : ''}`.slice(0, 240),
            alert: true
          }
        : { key: `approve:${e.jobId}`, title: 'Plan ready for approval', body: e.payload.title }
    // W7-A: no chime, nothing is asked; the plan view has its Stop
    case 'plan.auto-started':
      return { key: `auto-started:${e.jobId}`, title: `Plan started: ${e.payload.tasks ?? 0} tasks`, body: `${e.payload.title} (auto-approve). Stop it from its plan view.` }
    case 'plan.nothing-to-do':
      return { key: `nothing:${e.jobId}`, title: 'Nothing to do: already built', body: e.payload.title }
    // W6-B. A Gate's escalation shares its gate.opened key, so the throttle shows one of the two
    case 'task.escalated':
      if (e.payload.handsOff) return null
      return {
        key: e.payload.gateId !== undefined ? gateKey(e, e.payload.reason ?? '') : `escalated:${e.id}`,
        title: 'Needs your decision',
        body: `${e.payload.title}${inPlan(e)}: ${e.payload.reason ?? ''}`.slice(0, 240),
        alert: true,
        ...session
      }
    // W6-G: a notice but no chime (W6-B's chime is for what needs the owner): nothing is asked of anyone
    case 'usage.paused': {
      const weekly = e.payload.usageWindow === 'seven_day'
      const resumes = e.payload.resetsAt ? `, resumes ~${resetClock(e.payload.resetsAt, weekly)}` : ''
      return {
        key: `usage:${e.payload.accountId}:${e.payload.usageWindow}:${e.payload.resetsAt ?? ''}`,
        title: 'New workers paused',
        body: `${e.payload.title} is at ${e.payload.percent}% of its ${weekly ? '7-day' : '5-hour'} limit${resumes}. Running workers carry on.`
      }
    }
    case 'usage.resumed':
      return { key: `usage-resumed:${e.id}`, title: 'New workers resumed', body: `${e.payload.title} is under the usage threshold again.` }
    // W6-H: no chime, it needs nothing of the owner
    case 'plan.delivered':
      return { key: `delivered:${e.runId}`, title: `Plan pushed to ${e.payload.branch ?? 'its branch'}`, body: e.payload.title }
    // W8-D: no chime, nothing is blocked (the file guard keeps the plans apart); the approve area lists them
    case 'plan.overlap':
      return {
        key: `overlap:${e.jobId}:${(e.payload.overlaps ?? []).join('|')}`,
        title: 'Plans overlap',
        body: `${e.payload.title}: ${(e.payload.overlaps ?? []).join('; ')}`.slice(0, 240)
      }
    default:
      return null
  }
}

/** #117: the decisions as a notice's lines, short enough for Slack: the count, then at most DECISIONS_SHOWN lines. */
export const DECISIONS_SHOWN = 10
function decisionsText(lines: readonly string[]): string {
  if (lines.length === 0) return 'No decisions were needed.'
  const shown = lines.slice(0, DECISIONS_SHOWN).map((l) => `- ${l.length > 160 ? `${l.slice(0, 157)}...` : l}`)
  const more = lines.length > shown.length ? [`and ${lines.length - shown.length} more in the activity feed`] : []
  return [`${lines.length} decision(s) made for you:`, ...shown, ...more].join('\n')
}

export const NOTICE_DEDUP_MS = 10 * 60_000
export const NOTICE_WINDOW_MS = 60_000
export const NOTICE_MAX_PER_WINDOW = 3

/** At most `max` notices a `windowMs`, and one key once a `dedupMs`. What the rate turns away is counted, for the
 *  next digest to say. */
export function createNoticeThrottle(o: { dedupMs?: number; windowMs?: number; max?: number } = {}): {
  admit(key: string, nowMs: number): boolean
  takeSuppressed(): number
} {
  const dedupMs = o.dedupMs ?? NOTICE_DEDUP_MS
  const windowMs = o.windowMs ?? NOTICE_WINDOW_MS
  const max = o.max ?? NOTICE_MAX_PER_WINDOW
  const seen = new Map<string, number>()
  let sent: number[] = []
  let suppressed = 0
  return {
    admit(key, nowMs) {
      for (const [k, at] of seen) if (nowMs - at >= dedupMs) seen.delete(k)
      if (seen.has(key)) return false
      seen.set(key, nowMs)
      sent = sent.filter((at) => nowMs - at < windowMs)
      if (sent.length >= max) {
        suppressed += 1
        return false
      }
      sent.push(nowMs)
      return true
    },
    takeSuppressed() {
      const n = suppressed
      suppressed = 0
      return n
    }
  }
}

const titles = (xs: readonly ActivityItem[]): string => {
  const shown = xs.slice(0, 3).map((x) => x.title)
  return shown.join(', ') + (xs.length > shown.length ? ` and ${xs.length - shown.length} more` : '')
}

/** A digest's text, or null when nothing happened. `suppressed`: notices the rate held back since the last digest. */
export function digestText(s: ActivitySummary, suppressed = 0): string | null {
  const lines: string[] = []
  if (s.completed.length > 0) lines.push(`${s.completed.length} completed: ${titles(s.completed)}`)
  if (s.failed.length > 0) lines.push(`${s.failed.length} failed: ${titles(s.failed)}`)
  if (s.cancelled.length > 0) lines.push(`${s.cancelled.length} cancelled: ${titles(s.cancelled)}`)
  if (s.awaitingReview.length > 0) lines.push(`${s.awaitingReview.length} awaiting review: ${titles(s.awaitingReview)}`)
  if (s.plansDone.length > 0) lines.push(`${s.plansDone.length} plan(s) finished: ${titles(s.plansDone)}`)
  // Blocked alone is no news: it says what is still true, so it only rides along with something that happened
  if (lines.length === 0 && suppressed === 0) return null
  if (s.blocked.length > 0) lines.push(`${s.blocked.length} waiting: ${titles(s.blocked)}`)
  if (suppressed > 0) lines.push(`${suppressed} more notice(s) held back`)
  return lines.join('\n')
}

/**
 * The notices of one sink (the Host's Slack, the app's desktop): each important line at once, through the throttle,
 * and a digest every `digestMs()` (0: none). With no digest, what the rate held back is told in one notice at the next
 * tick, so nothing is dropped unsaid. `summary` is asked for the window since the last digest.
 */
export function createActivityNotices(a: {
  send(n: ActivityNotice): void
  summary(since: string): Promise<ActivitySummary | null>
  digestMs(): number | Promise<number>
  nowMs(): number
  throttle?: ReturnType<typeof createNoticeThrottle>
}): { onEvents(events: readonly ActivityEvent[]): void; tick(): Promise<void> } {
  const throttle = a.throttle ?? createNoticeThrottle()
  let last = a.nowMs()
  return {
    onEvents(events) {
      for (const e of events) {
        const n = noticeOf(e)
        if (n && throttle.admit(n.key, a.nowMs())) a.send(n)
      }
    },
    async tick() {
      const now = a.nowMs()
      const ms = await a.digestMs()
      if (!(ms > 0)) {
        last = now
        const held = throttle.takeSuppressed()
        if (held > 0) a.send({ key: `held:${now}`, title: 'More orchestration updates', body: `${held} more notice(s) held back; open Astera's activity feed` })
        return
      }
      if (now - last < ms) return
      const since = new Date(last).toISOString()
      last = now
      const s = await a.summary(since)
      const text = s ? digestText(s, throttle.takeSuppressed()) : null
      if (text) a.send({ key: `digest:${now}`, title: 'Activity summary', body: text })
    }
  }
}
