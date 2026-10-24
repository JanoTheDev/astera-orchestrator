// W3-B: a parsed intent → exact ids (resolveIntent) → the existing commands (execute). No new routing: every change
// goes through an `orch.command` door, and the plan actions through lib/jobActions.ts, the Jobs view's own functions.
// Everything `confirm`-class (core/intents/safety.ts) is one of those functions, and each asks first.
import type { Attention, OrchSnapshot } from '../../../../core/types'
import type { Dispatch, Task } from '../../../../core/orchestration/types'
import { findRun } from '../../../../core/orchestration/snapshot'
import type { Intent } from '../../../../core/intents/types'
import {
  resolvePlan,
  resolveProject,
  resolveScope,
  resolveSession,
  type Directory,
  type DirPlan,
  type DirProject,
  type FoundSession,
  type Miss,
  type Pins
} from '../../../../core/intents/resolve'
import { summarize } from '../../../../core/intents/summary'
import type { OrchDoor } from '../../lib/orchDoor'
import {
  approvePlan,
  archiveJob,
  deleteRun,
  discardMadeJob,
  holdJob,
  holdWorker,
  rejectPlan,
  sendPlanFeedback,
  pauseRun,
  resumeRun,
  resumeStoppedRun,
  stopRun,
  unholdWorker,
  type ActionUi
} from '../../lib/jobActions'

export type Ready = { ok: true; intent: Intent; plan?: DirPlan; plans?: DirPlan[]; project?: DirProject; session?: FoundSession }
export type Resolution = Ready | { ok: false; miss: Miss }

export function resolveIntent(intent: Intent, dir: Directory, pins: Pins = {}): Resolution {
  const fail = (miss: Miss): Resolution => ({ ok: false, miss })
  switch (intent.kind) {
    case 'reply':
      return { ok: true, intent }
    case 'summarize':
    case 'waiting': {
      const r = resolveScope(dir, intent.target, pins)
      return r.ok ? { ok: true, intent, plans: r.value } : fail(r)
    }
    case 'plan': {
      const r = resolveProject(dir, intent.target, intent.objective, pins)
      return r.ok ? { ok: true, intent, project: r.value } : fail(r)
    }
    case 'send': {
      let plan: DirPlan | undefined
      if (intent.target !== undefined) {
        const p = resolvePlan(dir, intent.target, pins)
        if (!p.ok) return fail(p)
        plan = p.value
      }
      const r = resolveSession(dir, intent.session, plan, pins)
      return r.ok ? { ok: true, intent, plan: r.value.plan, session: r.value } : fail(r)
    }
    case 'pause':
    case 'resume': {
      // W5-C: "pause worker three" is that worker (worker-hold), "pause Console" the plan. Only workers can be held,
      // so only workers are matched; a picked session wins, then a plan, then a worker by name.
      const workers: Directory = { ...dir, plans: dir.plans.map((p) => ({ ...p, sessions: p.sessions.filter((s) => s.role === 'worker') })) }
      const asWorker = (): Resolution | null => {
        const w = resolveSession(workers, intent.target ?? '', undefined, pins)
        return w.ok ? { ok: true, intent, plan: w.value.plan, session: w.value } : w.why === 'ambiguous' ? fail(w) : null
      }
      if (pins.sessionId !== undefined) return asWorker() ?? fail({ ok: false, what: 'session', why: 'not-found', candidates: [] })
      const p = resolvePlan(dir, intent.target, pins)
      if (p.ok) return { ok: true, intent, plan: p.value }
      return (intent.target !== undefined ? asWorker() : null) ?? fail(p)
    }
    default: {
      const r = resolvePlan(dir, intent.target, pins)
      return r.ok ? { ok: true, intent, plan: r.value } : fail(r)
    }
  }
}

/** One line of the coordinator's answer. A line with a session or plan opens it when clicked. */
export interface Line {
  text: string
  sessionId?: string
  jobId?: string
}

type TaskLike = Pick<Task, 'runId' | 'title' | 'status' | 'updatedAt'>
type DispatchLike = Pick<Dispatch, 'id' | 'sessionId' | 'outcome' | 'endedAt' | 'held'>

export interface ExecDeps {
  door(projectPath: string): OrchDoor
  ui: ActionUi
  tasks: readonly TaskLike[]
  /** W5-C: every Dispatch (WorkspaceData), so a worker named by its session is held by its open Dispatch. */
  dispatches: readonly DispatchLike[]
  nowMs: number
  attention(sessionId: string): Promise<Attention | null>
  openPlan(jobId: string): void
  openRun(projectPath: string, runId: string): void
  /** That project's Jobs snapshot, read when asked (W5-C, #41): archive and delete count what goes with a plan from it
   *  (jobActions), for a plan of any project. Null when it cannot be read. */
  snapshotFor(projectPath: string): Promise<OrchSnapshot | null>
  /** The account a new plan's coordinator and planner run on; '' is Auto (none sent: the Host picks the one with most
   *  room, T5b), null when no account is signed in. */
  coordinatorAccount(): Promise<string | null>
}

const errorOf = (body: unknown): string | undefined => {
  const e = (body as { error?: unknown } | null)?.error
  return typeof e === 'string' ? e : undefined
}

export async function execute(r: Ready, d: ExecDeps): Promise<Line[]> {
  const { intent } = r
  const t = d.ui.t
  const plan = r.plan
  const name = plan ? `${plan.projectName} › ${plan.name}` : ''
  const door = plan ? d.door(plan.projectPath) : null
  switch (intent.kind) {
    case 'reply':
      return [{ text: intent.text }]
    case 'summarize':
      return summarize(r.plans ?? [], d.tasks, intent.minutes, d.nowMs).map((text) => ({ text }))
    case 'waiting': {
      const all = (r.plans ?? []).flatMap((p) => p.sessions.map((s) => ({ s, p })))
      const states = await Promise.all(all.map(({ s }) => d.attention(s.sessionId).catch(() => null)))
      const lines = all
        .filter((_, i) => states[i] === 'waiting')
        .map(({ s, p }) => ({ text: `${s.label} — ${p.projectName} › ${p.name}`, sessionId: s.sessionId, jobId: p.jobId }))
      return lines.length > 0 ? lines : [{ text: t('command.none.waiting') }]
    }
    case 'plan': {
      const project = r.project!
      const account = await d.coordinatorAccount()
      if (account === null) return [{ text: t('command.noAccount') }]
      const pd = d.door(project.path)
      // The Start page's call for a typed objective (jobs-create, which names the plan: intake.ts shortTitle), then its
      // planner. No --planning or --concurrency: the project's defaults decide, as they did here before
      const made = await pd.command('jobs-create', { cwd: project.path, ...(account ? { coordinatorAccount: account } : {}), objective: intent.objective })
      if (made.status >= 400) return [{ text: `${t('jobs.new.failed')}${errorOf(made.body) ? `: ${errorOf(made.body)}` : ''}` }]
      const id = (made.body as { id: string }).id
      const planned = await pd.command('jobs-plan', { id })
      if (planned.status >= 400) {
        await discardMadeJob(pd, id)
        return [{ text: `${t('jobs.new.plannerFailed')}${errorOf(planned.body) ? `: ${errorOf(planned.body)}` : ''}` }]
      }
      d.openPlan(id)
      return [{ text: t('command.done.planned', { project: project.name }), jobId: id }]
    }
  }
  if (!plan || !door) return []
  switch (intent.kind) {
    case 'switch':
      d.openPlan(plan.jobId)
      return [{ text: t('command.done.switched', { plan: name }) }]
    case 'show-sessions':
      d.openPlan(plan.jobId)
      return plan.sessions.length > 0
        ? plan.sessions.map((s) => ({ text: `${s.label}${s.taskTitle ? ` — ${s.taskTitle}` : ''}`, sessionId: s.sessionId, jobId: plan.jobId }))
        : [{ text: t('command.none.sessions') }]
    case 'approve':
      if (!plan.pendingStart) return [{ text: t('command.refused.started', { plan: name }) }]
      return (await approvePlan(door, plan.jobId, name, d.ui)) ? [{ text: t('command.done.approved', { plan: name }) }] : []
    // W7-A: talk to the planner. Feedback works before approval and while the plan runs (a replan); reject only before.
    case 'plan-feedback':
      return (await sendPlanFeedback(door, plan.jobId, intent.text, d.ui)) ? [{ text: t('command.done.feedback', { plan: name }), jobId: plan.jobId }] : []
    case 'plan-reject':
      if (!plan.pendingStart) return [{ text: t('command.refused.started', { plan: name }) }]
      return (await rejectPlan(door, plan.jobId, name, intent.reason ?? '', d.ui)) ? [{ text: t('command.done.rejected', { plan: name }) }] : []
    case 'pause':
    case 'stop-launching': {
      // W5-C: one worker is held (asked first); a plain plan stops launching and nothing closes (#38, #39)
      if (r.session !== undefined) {
        const s = r.session.session
        const open = d.dispatches.find((x) => x.sessionId === s.sessionId && !x.outcome && !x.endedAt)
        if (!open) return [{ text: t('command.refused.noWorker', { session: s.label }) }]
        return (await holdWorker(door, open.id, s.label, d.ui))
          ? [{ text: t('command.done.workerHeld', { session: s.label }), sessionId: s.sessionId, jobId: plan.jobId }]
          : []
      }
      // A schedule fires new rounds with their own coordinators, which a hold does not stop: it pauses as a whole,
      // closing its sessions, after asking (pauseRun).
      if (plan.scheduled) {
        await pauseRun(door, plan.jobId, d.ui)
        return []
      }
      return (await holdJob(door, plan.jobId, true, d.ui)) ? [{ text: t('command.done.held', { plan: name }) }] : []
    }
    case 'stop':
      // A schedule pauses as a whole; a plain plan's Run stops (both close its sessions, and both ask first).
      if (plan.scheduled) {
        await pauseRun(door, plan.jobId, d.ui)
        return []
      }
      if (plan.runId === undefined) return [{ text: t('command.refused.notRunning', { plan: name }) }]
      return (await stopRun(door, plan.runId, name, d.ui)) ? [{ text: t('command.done.stopped', { plan: name }) }] : []
    case 'resume':
      if (r.session !== undefined) {
        const s = r.session.session
        const held = d.dispatches.find((x) => x.sessionId === s.sessionId && x.held && !x.outcome && !x.endedAt)
        if (!held) return [{ text: t('command.refused.notHeld', { session: s.label }) }]
        return (await unholdWorker(door, held.id, d.ui))
          ? [{ text: t('command.done.workerResumed', { session: s.label }), sessionId: s.sessionId, jobId: plan.jobId }]
          : []
      }
      if (plan.held) return (await holdJob(door, plan.jobId, false, d.ui)) ? [{ text: t('command.done.resumed', { plan: name }) }] : []
      if (plan.scheduled) {
        await resumeRun(door, plan.jobId, d.ui)
        return []
      }
      if (plan.runId === undefined) return [{ text: t('command.refused.notRunning', { plan: name }) }]
      return (await resumeStoppedRun(door, plan.runId, d.ui)) ? [{ text: t('command.done.resumed', { plan: name }) }] : []
    case 'send': {
      const s = r.session!.session
      // The exact session id the resolver found, through the CLI's own `sessions send` (SessionDriver in the Host)
      const reply = await door.command('sessions-send', { id: s.sessionId, text: intent.text })
      if (reply.status >= 400) return [{ text: errorOf(reply.body) ?? t('command.sendFailed') }]
      return [{ text: t('command.done.sent', { session: s.label }), sessionId: s.sessionId, jobId: plan.jobId }]
    }
    case 'archive':
    case 'delete': {
      const snap = await d.snapshotFor(plan.projectPath).catch(() => null)
      if (!snap || !findRun(snap, plan.jobId)) return [{ text: t('command.refused.unreadable', { plan: name }) }]
      if (intent.kind === 'archive') await archiveJob(door, snap, plan.jobId, d.ui)
      else await deleteRun(door, snap, plan.jobId, d.ui)
      return []
    }
    case 'merge':
      // Merging is the Run window's, with its own confirmation and the worktree counts it shows: opened, not run.
      if (plan.runId === undefined) return [{ text: t('command.refused.notRunning', { plan: name }) }]
      d.openRun(plan.projectPath, plan.runId)
      return [{ text: t('command.done.mergeOpened', { plan: name }) }]
  }
  return []
}
