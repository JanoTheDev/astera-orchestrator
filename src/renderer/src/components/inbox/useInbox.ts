// W9-D: the Inbox's data, read off what the app already polls (useWorkspaceData): the open questions are
// `data.gates` (`questions-list --status open` also lists asks and escalations), the waits come from the session
// index, the feed from the Host. Nothing is stored here.
import { useMemo } from 'react'
import type { ActivityEvent } from '../../../../core/orchestration/activity'
import { buildSessionIndex, needsInput } from '../../../../core/orchestration/sessionIndex'
import { useActivityFeed } from '../activity/useActivityFeed'
import { useHostWaiting } from '../search/useHostWaiting'
import { useAttention } from '../../state/useAttention'
import { planSessions, type WorkspaceData, type WorkspaceProject } from '../../state/workspaceTree'
import { needsOf, type NeedCard, type QuestionRow } from './inboxView'

export interface InboxState {
  needs: NeedCard[]
  events: ActivityEvent[]
  /** The project folder of a plan, for the door its commands go through. */
  pathOfJob: ReadonlyMap<string, string>
}

export function useInbox(tree: readonly WorkspaceProject[], data: WorkspaceData | null): InboxState {
  const attention = useAttention(tree.flatMap((p) => p.plans.flatMap((plan) => planSessions(plan).map((s) => s.sessionId))))
  const hostWaiting = useHostWaiting(data?.projects[0]?.path ?? null)
  const events = useActivityFeed(true)
  return useMemo(() => {
    const jobs = Object.values(data?.jobsByProject ?? {}).flat()
    const runs = data?.runs ?? []
    const tasks = data?.tasks ?? []
    const input = { tree: [...tree], jobs, runs, tasks, gates: data?.gates ?? [], escalations: data?.escalations ?? [], attention, hostWaiting }
    const plans = new Map(tree.flatMap((p) => p.plans.map((pl) => [pl.jobId, { projectName: p.name, planName: pl.name }] as const)))
    const needs = needsOf({
      items: needsInput(input, buildSessionIndex(input)),
      questions: (data?.gates ?? []) as unknown as QuestionRow[],
      jobs,
      plans,
      jobOfRun: new Map(runs.map((r) => [r.id, r.jobId])),
      taskTitles: new Map(tasks.map((t) => [t.id, t.title])),
      events
    })
    const pathOfJob = new Map(tree.flatMap((p) => p.plans.map((pl) => [pl.jobId, p.path] as const)))
    return { needs, events, pathOfJob }
  }, [tree, data, attention, hostWaiting, events])
}
