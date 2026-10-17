// W3-B: a parsed intent → exact ids (resolveIntent) → the existing commands (execute). No new routing: every change
// goes through an `orch.command` door, and the plan actions through lib/jobActions.ts, the Jobs view's own functions.
// Everything `confirm`-class (core/intents/safety.ts) is one of those functions, and each asks first.
import type { Attention, OrchSnapshot } from '../../../../core/types'
import type { Task } from '../../../../core/orchestration/types'
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
import { approvePlan, archiveJob, deleteRun, pauseRun, resumeRun, resumeStoppedRun, stopRun, type ActionUi } from '../../lib/jobActions'

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

export interface ExecDeps {
  door(projectPath: string): OrchDoor
  ui: ActionUi
  tasks: readonly TaskLike[]
  nowMs: number
  attention(sessionId: string): Promise<Attention | null>
  openPlan(jobId: string): void
  openRun(projectPath: string, runId: string): void
  /** The Jobs view's snapshot of that project, or null when it watches another one: archive and delete count what
   *  goes with a plan from it (jobActions), so they act only on the open project's plans. */
  snapshotFor(projectPath: string): OrchSnapshot | null
  /** The account a new plan's coordinator and planner run on (defaultAccountIdOf), or null when none is signed in. */
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
      // The "+ New job" form's call (NewRunModal), then its planner (W2-A)
      const made = await pd.command('run-create', { objective: intent.objective, cwd: project.path, coordinatorAccount: account, auto: true })
      if (made.status >= 400) return [{ text: `${t('jobs.new.failed')}${errorOf(made.body) ? `: ${errorOf(made.body)}` : ''}` }]
      const id = (made.body as { id: string }).id
      const planned = await pd.command('jobs-plan', { id })
      if (planned.status >= 400)
        return [{ text: `${t('jobs.new.plannerFailed')}${errorOf(planned.body) ? `: ${errorOf(planned.body)}` : ''}`, jobId: id }]
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
    case 'pause':
    case 'stop-launching':
      // A schedule pauses as a whole; a plain plan's Run stops (both close its sessions, and both ask first).
      if (plan.scheduled) {
        await pauseRun(door, plan.jobId, d.ui)
        return []
      }
      if (plan.runId === undefined) return [{ text: t('command.refused.notRunning', { plan: name }) }]
      return (await stopRun(door, plan.runId, name, d.ui)) ? [{ text: t('command.done.stopped', { plan: name }) }] : []
    case 'resume':
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
      const snap = d.snapshotFor(plan.projectPath)
      if (!snap || !findRun(snap, plan.jobId)) return [{ text: t('command.refused.openProject', { project: plan.projectName }) }]
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
