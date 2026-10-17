// W3-B: the resolver's view of orchestration data (core/intents/resolve.ts), folded from the workspace sidebar's own
// tree (W2-B) so a "worker three" here is the "Worker 3" the sidebar shows.
import type { Directory } from '../../../../core/intents/resolve'
import { planSessions, type WorkspaceData, type WorkspaceProject } from '../workspace/workspaceTree'

export function directoryOf(
  tree: readonly WorkspaceProject[],
  data: WorkspaceData | null,
  currentProjectPath: string | null,
  currentPlanId: string | null
): Directory {
  const jobs = new Map(Object.values(data?.jobsByProject ?? {}).flat().map((j) => [j.id, j]))
  return {
    projects: tree.map((p) => ({ id: p.id, name: p.name, path: p.path })),
    plans: tree.flatMap((p) =>
      p.plans
        .filter((pl) => !pl.archived)
        .map((pl) => {
          const job = jobs.get(pl.jobId)
          return {
            jobId: pl.jobId,
            name: pl.name,
            projectId: p.id,
            projectName: p.name,
            projectPath: p.path,
            scheduled: job?.schedule !== undefined,
            pendingStart: job?.pendingStart === true,
            ...(pl.runId !== undefined ? { runId: pl.runId } : {}),
            sessions: planSessions(pl).map((x) => ({
              sessionId: x.sessionId,
              role: x.role,
              label: x.label,
              ...(x.taskTitle !== undefined ? { taskTitle: x.taskTitle } : {})
            }))
          }
        })
    ),
    currentProjectPath,
    currentPlanId
  }
}
