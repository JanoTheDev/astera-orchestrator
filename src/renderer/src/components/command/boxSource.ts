// W9-D: the workspace tree and its data, as the three lists the box searches (boxHits.ts).
import { buildSessionIndex, type IndexedSession } from '../../../../core/orchestration/sessionIndex'
import type { Attention } from '../../../../core/types'
import type { WorkspaceData, WorkspaceProject } from '../workspace/workspaceTree'
import type { PlanRef, TaskRef } from './boxHits'

export interface BoxSource {
  sessions: IndexedSession[]
  plans: PlanRef[]
  tasks: TaskRef[]
}

export function boxSourceOf(tree: readonly WorkspaceProject[], data: WorkspaceData | null, attention: Readonly<Record<string, Attention>>): BoxSource {
  const live = tree.map((p) => ({ ...p, plans: p.plans.filter((pl) => !pl.archived) }))
  const plans = live.flatMap((p) => p.plans.map((pl) => ({ jobId: pl.jobId, name: pl.name, projectName: p.name })))
  const planOf = new Map(plans.map((p) => [p.jobId, p]))
  const jobOfRun = new Map((data?.runs ?? []).map((r) => [r.id, r.jobId]))
  const tasks = (data?.tasks ?? []).flatMap((t): TaskRef[] => {
    const jobId = t.runId === undefined ? t.jobId : jobOfRun.get(t.runId)
    const plan = jobId === undefined ? undefined : planOf.get(jobId)
    return plan ? [{ taskId: t.id, title: t.title, jobId: plan.jobId, planName: plan.name, projectName: plan.projectName }] : []
  })
  const sessions = buildSessionIndex({
    tree: live,
    jobs: Object.values(data?.jobsByProject ?? {}).flat(),
    runs: data?.runs ?? [],
    tasks: data?.tasks ?? [],
    gates: data?.gates ?? [],
    attention
  })
  return { sessions, plans, tasks }
}
