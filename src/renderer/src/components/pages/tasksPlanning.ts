// The Tasks page's Planning section: plans that have no Tasks to show yet because they are still being planned,
// replanned, waiting for approval or queued behind another plan. Pure, so the node-only test suite reaches it.
import type { MessageKey, MessageParams } from '../../../../core/i18n'
import type { JobRow } from '../../../../core/types'
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
