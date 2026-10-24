// T4 Plans page "Main plan": the project's plans in run order with one combined count, and under a Task or plan the one
// plain line saying what it waits for. Pure, so the node-only test suite reaches it; MainPlan.tsx only renders.
//
// The renderer holds JobRows, not the Host's OrchState, so core's `mainPlanOf` cannot run here: the order is its rule
// (oldest first, a plan queued `after` another right behind it) and the waits are read from each Task's board reason
// (core/orchestration/blocked.ts), which is where `mainPlanOf`'s links come from too.
import type { MessageKey, MessageParams } from '../../../../core/i18n'
import type { JobRow, JobTask } from '../../../../core/types'
import { isDuplicateGate } from '../../../../core/orchestration/overlap'
import { jobDisplayName as jobName } from '../../../../core/orchestration/jobName'
import { categoryOf } from './planBoard'
import { lastActivityOf, planStatusOf } from './planList'
import { needsYouOf } from './planTree'

export interface Line {
  key: MessageKey
  params?: MessageParams
  /** A line that reports a failure (drawn with the error icon in the danger colour); absent: a wait. */
  failed?: true
}

export interface MainTask {
  task: JobTask
  /** What it waits for on another plan, if anything. */
  wait?: Line
}

/** Where a plan stands for the page's header and folding: a person's part first, then what moves, what waits, what ended. */
export type MainPhase = 'needs' | 'running' | 'waiting' | 'done'

/** A finished plan's one row: how many Tasks, the commit it landed as (short) and when. */
export interface FinishedSummary {
  tasks: number
  commit?: string
  /** epoch ms */
  at?: number
}

export interface MainPlanBlock {
  row: JobRow
  name: string
  phase: MainPhase
  /** Drawn open until the person folds it: every plan but a finished one. */
  open: boolean
  finished?: FinishedSummary
  tasks: MainTask[]
  /** Where its delivery check stands, if it has one to tell. */
  checks?: Line
}

export interface MainPlanView {
  plans: MainPlanBlock[]
  done: number
  total: number
  /** How many plans stand in each phase. */
  counts: Record<MainPhase, number>
}

/** Oldest first, and a plan queued after another right behind the latest of it (core mainPlan.ts `runOrder`, without the
 *  priority the rows do not carry). */
function runOrder(rows: readonly JobRow[]): JobRow[] {
  const rest = [...rows].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id))
  const out: JobRow[] = []
  while (rest.length > 0) {
    // a hand-edited cycle would never place the first; the Math.max keeps the loop moving
    const i = Math.max(0, rest.findIndex((r) => !rest.some((o) => o.id === r.after)))
    out.push(...rest.splice(i, 1))
  }
  return out
}

/** The text of a duplicate question names the other plan and Task: Duplicate? "T" (plan B) repeats "O" of plan A (why). */
const DUPLICATE_OF = /repeats "(.+)" of plan (.+) \(/

function waitOf(task: JobTask, mine: JobRow, rows: readonly JobRow[]): Line | undefined {
  const reason = task.board?.reason
  if (task.gate && isDuplicateGate({ options: task.gate.options })) {
    const m = DUPLICATE_OF.exec(task.gate.question)
    return m
      ? { key: 'pages.plans.main.duplicate', params: { plan: m[2], task: m[1] } }
      : { key: 'pages.plans.main.duplicateOther' }
  }
  if (reason?.kind === 'same-files' && reason.plan)
    return {
      key: reason.delivery ? 'pages.plans.main.sameFilesDeliver' : 'pages.plans.main.sameFiles',
      params: { plan: reason.plan.title, task: reason.waitingOn.title }
    }
  if (reason?.kind === 'deps') {
    // a dep that is a Task of another plan: found by id in the other rows
    for (const dep of reason.waitingOn) {
      const owner = rows.find((r) => r.id !== mine.id && r.tasks.some((t) => t.id === dep.id))
      if (owner) return { key: dep.delivery ? 'pages.plans.main.waitsDeliver' : 'pages.plans.main.waits', params: { plan: jobName(owner), task: dep.title } }
    }
  }
  return undefined
}

function checksOf(row: JobRow, rows: readonly JobRow[]): Line | undefined {
  const d = row.delivery
  if (d?.waitingFor) {
    const other = rows.find((r) => r.id === d.waitingFor?.jobId)
    return {
      key: d.waitingFor.escalated ? 'pages.plans.main.checksWaitTold' : 'pages.plans.main.checksWait',
      params: { plan: other ? jobName(other) : d.waitingFor.jobId }
    }
  }
  // a failure, not a wait: its own icon, and why when the delivery says
  if (d?.state === 'failed') return d.reason ? { key: 'pages.plans.main.checksFailedWhy', params: { reason: d.reason }, failed: true } : { key: 'pages.plans.main.checksFailed', failed: true }
  if (d?.state === 'needs-owner') return { key: 'pages.plans.main.checksNeedYou' }
  if (d || row.outcome === 'checking') return { key: 'pages.plans.main.checksRunning' }
  return undefined
}

/** The phase from the plan's status word (planList.ts planStatusOf) by its tone: ok is done (a dismissed delivery ended too),
 *  warn and danger need the owner, info moves, neutral waits. A Task waiting on the owner counts even in a paused plan. */
function phaseOf(row: JobRow): MainPhase {
  const status = planStatusOf(row)
  if (status.tone === 'ok' || status.key === 'pages.plans.status.deliveryDismissed') return 'done'
  if (needsYouOf(row) > 0 || status.tone === 'warn' || status.tone === 'danger') return 'needs'
  return status.tone === 'info' ? 'running' : 'waiting'
}

function finishedOf(row: JobRow): FinishedSummary {
  // the squash merge's commit once seen on the base, else the last commit a Task added
  const commit = row.pr?.attributed ?? row.tasks.flatMap((t) => t.links?.commits ?? []).at(-1)
  const at = row.pr?.attributedAt !== undefined ? Date.parse(row.pr.attributedAt) : lastActivityOf(row)
  return { tasks: row.total, ...(commit ? { commit: commit.slice(0, 7) } : {}), ...(at !== undefined && !Number.isNaN(at) ? { at } : {}) }
}

/** A finished plan's date in `locale`: month and day, with the year only when it is not `nowMs`'s year. */
export const finishedDateOf = (at: number, nowMs: number, locale: string): string => {
  const d = new Date(at)
  const sameYear = d.getFullYear() === new Date(nowMs).getFullYear()
  return d.toLocaleDateString(locale, { ...(sameYear ? {} : { year: 'numeric' }), month: 'short', day: 'numeric' })
}

/** The plans the page draws: all, or without the done ones. */
export const shownPlans = (view: MainPlanView, hideDone: boolean): MainPlanBlock[] => (hideDone ? view.plans.filter((p) => p.phase !== 'done') : view.plans)

/** `rows` (the open project's plans) as the main plan: archived plans and schedule templates left out. */
export function mainPlanViewOf(rows: readonly JobRow[]): MainPlanView {
  const live = rows.filter((r) => r.archivedAt === undefined && !r.schedule)
  const plans = runOrder(live).map((row): MainPlanBlock => {
    const checks = checksOf(row, live)
    const phase = phaseOf(row)
    return {
      row,
      name: jobName(row),
      phase,
      open: phase !== 'done',
      ...(phase === 'done' ? { finished: finishedOf(row) } : {}),
      tasks: row.tasks.map((task) => {
        const wait = waitOf(task, row, live)
        return wait ? { task, wait } : { task }
      }),
      ...(checks ? { checks } : {})
    }
  })
  const all = plans.flatMap((p) => p.tasks)
  const counts: Record<MainPhase, number> = { needs: 0, running: 0, waiting: 0, done: 0 }
  for (const p of plans) counts[p.phase]++
  return { plans, done: all.filter((m) => categoryOf(m.task) === 'done').length, total: all.length, counts }
}
