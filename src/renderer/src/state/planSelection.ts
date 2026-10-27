// What a pushed snapshot and a pending plan may do to the owner's open plan, out of useJobs so it can be tested. The
// owner's last pick wins: a snapshot of another project never closes the open plan, and a plan asked to open never
// opens after the owner has gone somewhere else.
import type { OrchSnapshot } from '../../../core/types'
import { findRun, isForeignSnapshot } from '../../../core/orchestration/snapshot'
import { detailRunGone } from '../lib/remoteJobs'
import type { WorkspacePlan, WorkspaceProject } from './workspaceTree'

export interface PlanRef {
  projectPath: string
  runId: string
  runtimeId?: string
}

/** Whether the open plan closes on `snap` (its project's snapshot, a paired Runtime's for a remote plan), and whether
 *  its Run is in it (the `seen` of detailRunGone). */
export function openRunCheck(a: { openRun: PlanRef; currentProject: string | null; snap: OrchSnapshot | null; seen: boolean }): { close: boolean; found: boolean } {
  // #76: a local detail opened for another project than the current one has no Run in this snapshot and its detail is
  // never fetched: it sat open as an empty "No Tasks yet" window.
  if (!a.openRun.runtimeId && a.openRun.projectPath !== a.currentProject) return { close: true, found: false }
  // Not known yet, or folded for another project (a late push from before a switch): says nothing about this Run
  if (a.snap === null || isForeignSnapshot(a.snap, a.openRun.projectPath)) return { close: false, found: false }
  // 위와 같은 이유로 findRun 이다 — `runs.some` 이면 회차의 상세 창이 열린 다음 프레임에 닫힌다.
  const found = findRun(a.snap, a.openRun.runId) !== undefined
  return { close: detailRunGone({ remote: !!a.openRun.runtimeId, found, seen: a.seen }), found }
}

/** What a plan asked to open (W7-C) does now: opens once its project is current, waits while the switch that brings
 *  it is still coming (`currentProject` is still `lastProject`, the one current when the effect last ran), and is
 *  dropped once the owner switches anywhere else, so it can never steal focus on a later switch. */
export function pendingRunStep(pending: PlanRef | null, currentProject: string | null, lastProject: string | null): 'open' | 'wait' | 'drop' {
  if (!pending) return 'wait'
  if (currentProject === pending.projectPath) return 'open'
  return currentProject === lastProject ? 'wait' : 'drop'
}

/** The pending plan once the owner opened `openRun`: another plan supersedes it. */
export function pendingAfterOpen(pending: PlanRef | null, openRun: PlanRef | null): PlanRef | null {
  return pending && openRun && openRun.runId !== pending.runId ? null : pending
}

/** The tree entry a plan tab's id (`view:plan:<runId>`) names: its Run, or its Job before it has run. */
const treeHit = (tree: readonly WorkspaceProject[], runId: string): { project: WorkspaceProject; plan: WorkspacePlan } | undefined => {
  for (const project of tree) {
    const plan = project.plans.find((x) => x.jobId === runId || x.runId === runId)
    if (plan) return { project, plan }
  }
  return undefined
}

/** A plan tab's title: the plan's name from the workspace tree, which holds every project's plans. */
export const planNameOf = (tree: readonly WorkspaceProject[] | undefined, runId: string): string | undefined =>
  (tree && treeHit(tree, runId)?.plan.name) || undefined

/** The project path of the plan a plan tab names, from the workspace tree. */
export const planProjectOf = (tree: readonly WorkspaceProject[], runId: string): string | undefined => treeHit(tree, runId)?.project.path

/** The plan the active tab opens: its own plan when the tab is a plan tab that openRun does not show yet. A local plan
 *  of another project than the current one is not opened (openRunCheck would close it at once); a remote plan opens as
 *  remembered (`known`, from the last open of it). An unknown project falls back to the current one. */
export function planToOpen(a: {
  tabRunId: string | null
  openRun: PlanRef | null
  currentProject: string | null
  treePath: string | undefined
  known: PlanRef | undefined
}): PlanRef | null {
  if (a.tabRunId === null || a.openRun?.runId === a.tabRunId) return null
  if (a.known?.runtimeId) return a.known
  const projectPath = a.known?.projectPath ?? a.treePath ?? a.currentProject
  if (!projectPath || projectPath !== a.currentProject) return null
  return a.known ?? { projectPath, runId: a.tabRunId }
}
