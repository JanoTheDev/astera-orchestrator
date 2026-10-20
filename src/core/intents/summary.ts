// W3-B: the coordinator's own answers to status questions ("show progress on Redis", "summarize the last 15 min"),
// read from the Tasks of each plan's latest Run. No model call: SPEC §4 has the coordinator answer these itself.
import type { Task } from '../orchestration/types'
import type { DirPlan } from './resolve'

type TaskLike = Pick<Task, 'runId' | 'title' | 'status' | 'updatedAt'>

const RUNNING = new Set<Task['status']>(['dispatched', 'validating', 'reviewing', 'merging'])

/** "3/7 done, 2 running, 1 failed" — or "not started" / "no tasks yet". */
export function planStatus(plan: DirPlan, tasks: readonly TaskLike[]): string {
  if (plan.pendingStart) return 'not started'
  const mine = tasks.filter((t) => plan.runId !== undefined && t.runId === plan.runId)
  if (mine.length === 0) return 'no tasks yet'
  const n = (f: (t: TaskLike) => boolean): number => mine.filter(f).length
  const parts = [`${n((t) => t.status === 'completed')}/${mine.length} done`]
  const running = n((t) => RUNNING.has(t.status))
  const failed = n((t) => t.status === 'failed')
  const blocked = n((t) => t.status === 'blocked')
  if (running > 0) parts.push(`${running} running`)
  if (failed > 0) parts.push(`${failed} failed`)
  if (blocked > 0) parts.push(`${blocked} blocked`)
  return parts.join(', ')
}

/** One line per plan, then (with `minutes`) each Task that moved in that window and what it is now. */
export function summarize(plans: readonly DirPlan[], tasks: readonly TaskLike[], minutes: number | undefined, nowMs: number): string[] {
  const lines: string[] = []
  const since = minutes === undefined ? null : nowMs - minutes * 60_000
  for (const p of plans) {
    lines.push(`${p.projectName} › ${p.name}: ${planStatus(p, tasks)}`)
    if (since === null) continue
    for (const t of tasks)
      if (p.runId !== undefined && t.runId === p.runId && Date.parse(t.updatedAt) >= since) lines.push(`  ${t.title}: ${t.status}`)
  }
  return lines
}
