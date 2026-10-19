// The Tasks page's Planning section: plans that have no Tasks to show yet because they are still being planned,
// replanned, waiting for approval or queued behind another plan. Pure, so the node-only test suite reaches it.
import type { MessageKey, MessageParams } from '../../../../core/i18n'
import type { JobRow, TaskBlockedReason } from '../../../../core/types'
import { jobName } from '../../lib/jobName'

export type PlanningStage = 'writing' | 'replanning' | 'ready' | 'queued'

export interface PlanningEntry {
  plan: JobRow
  stage: PlanningStage
  /** The name of the plan this one is queued after (stage `queued`). */
  afterName?: string
}

/** A plan's stage while it is planning, or null once it is past planning (running, finished) or was never planned. */
export function planningStageOf(plan: JobRow): PlanningStage | null {
  if (plan.archivedAt !== undefined || plan.schedule) return null
  if (plan.replanWave !== undefined) return 'replanning'
  // A plan queued after another has no planner yet (plannerSessionIds unset), so `planned` is not set on it
  if (plan.pendingStart && !plan.planned && plan.after !== undefined) return 'queued'
  if (!plan.pendingStart || !plan.planned) return null
  if (plan.planReady) return 'ready'
  if (plan.plannerSessionId === undefined && plan.after !== undefined) return 'queued'
  return 'writing'
}

/** The plans to list, in the order the snapshot gives them. `plans` is every plan the page may show. */
export function planningEntriesOf(plans: readonly JobRow[]): PlanningEntry[] {
  const out: PlanningEntry[] = []
  for (const plan of plans) {
    const stage = planningStageOf(plan)
    if (stage === null) continue
    const after = stage === 'queued' ? plans.find((p) => p.id === plan.after) : undefined
    out.push({ plan, stage, ...(after ? { afterName: jobName(after) } : {}) })
  }
  return out
}

/** The stage in words, as a catalog key and its params. */
export function stageText(e: PlanningEntry): { key: MessageKey; params?: MessageParams } {
  switch (e.stage) {
    case 'replanning':
      return { key: 'pages.tasks.planning.replanning', params: { n: (e.plan.replanWave ?? 0) + 1 } }
    case 'ready':
      return { key: 'pages.tasks.planning.ready' }
    case 'queued':
      return { key: 'pages.tasks.planning.queued', params: { plan: e.afterName ?? e.plan.after ?? '' } }
    default:
      return { key: 'pages.tasks.planning.writing' }
  }
}

/** The kind of wait a Task card names with a chip: another plan holds its files (`lease`), its plan is queued after
 *  another (`queued`), it waits for an earlier wave (`wave`), a Task of its own plan is at its files (`files`), a usage
 *  limit (`limit`) or a worker cap (`cap`). Null: the reason needs no chip (the line under the title says it). */
export type WaitKind = 'lease' | 'queued' | 'wave' | 'files' | 'limit' | 'cap'

export function waitKindOf(reason: TaskBlockedReason | undefined): WaitKind | null {
  switch (reason?.kind) {
    case 'same-files':
      return reason.plan ? 'lease' : 'files'
    case 'pending-start':
      return reason.after ? 'queued' : null
    case 'deps':
      return 'wave'
    case 'rate-limited':
    case 'usage-paused':
      return 'limit'
    case 'plan-cap':
    case 'global-cap':
      return 'cap'
    default:
      return null
  }
}

/** The chip's words: whose lease, which plan it is queued after, which wave of how many is open. */
export function waitText(reason: TaskBlockedReason, plan: Pick<JobRow, 'wave'>): { key: MessageKey; params?: MessageParams } | null {
  switch (reason.kind) {
    case 'same-files':
      return reason.plan ? { key: 'pages.tasks.wait.lease', params: { plan: reason.plan.title } } : { key: 'pages.tasks.wait.files' }
    case 'pending-start':
      return reason.after ? { key: 'pages.tasks.wait.queued', params: { plan: reason.after.title } } : null
    case 'deps':
      return plan.wave
        ? { key: 'pages.tasks.wait.wave', params: { at: plan.wave.at, of: plan.wave.of } }
        : { key: 'pages.tasks.wait.deps', params: { count: reason.waitingOn.length } }
    case 'rate-limited':
    case 'usage-paused':
      return { key: 'pages.tasks.wait.limit' }
    case 'plan-cap':
    case 'global-cap':
      return { key: 'pages.tasks.wait.cap' }
    default:
      return null
  }
}
