// W3-C: every orchestration session across all projects, for the sidebar's search and its "needs my input" list
// (orchestrator SPEC §6 "what each session shows", §8 "show every session needing my input", §12 search).
//
// **Built on the workspace tree, never beside it.** Which sessions a plan has, their labels ("Trading Worker 2") and
// their numbering are workspaceTree.ts's (W2-B); this adds what search and the inbox need on top: the Task's branch,
// its open Gates and each session's attention. The tree is declared here by its shape, because workspaceTree.ts is
// the renderer's and core does not import from it. Pure, derived, stored nowhere.
import type { Attention } from '../types'
import type { Gate, Job, JobRun, Task } from './types'

/** One session as workspaceTree.ts lists it (WorkspaceSession). */
export interface TreeSession {
  sessionId: string
  role: 'planner' | 'coordinator' | 'worker'
  label: string
  projectName: string
  planName: string
  taskId?: string
  taskTitle?: string
  model?: string
  accountId?: string
  cwd?: string
}

export interface TreePlan {
  jobId: string
  projectId: string
  name: string
  planner: TreeSession[]
  coordinator: TreeSession[]
  workers: TreeSession[]
}

export interface TreeProject {
  id: string
  name: string
  path: string
  plans: TreePlan[]
}

export interface IndexedSession extends TreeSession {
  jobId: string
  projectId: string
  /** The branch its Task works on (Task.links, W2-D). */
  branch?: string
  /** core/sessions/attention.ts's verdict; `idle` when none was read yet, as that module answers for an unknown id. */
  attention: Attention
  /** Open Gates on its Task. */
  openGates: number
}

export interface SessionIndexInput {
  tree: TreeProject[]
  /** Every project's Jobs: a plan awaiting approval is read off its Job. */
  jobs: Job[]
  runs: JobRun[]
  tasks: Task[]
  gates: Gate[]
  attention: Readonly<Record<string, Attention>>
}

const sessionsOf = (plan: TreePlan): TreeSession[] => [...plan.planner, ...plan.coordinator, ...plan.workers]

/** Every session of every plan in the tree, in the tree's order. */
export function buildSessionIndex(input: SessionIndexInput): IndexedSession[] {
  const taskById = new Map(input.tasks.map((t) => [t.id, t]))
  const gatesByTask = new Map<string, number>()
  for (const g of input.gates) if (g.status === 'open') gatesByTask.set(g.taskId, (gatesByTask.get(g.taskId) ?? 0) + 1)
  return input.tree.flatMap((p) =>
    p.plans.flatMap((plan) =>
      sessionsOf(plan).map((s) => {
        const branch = s.taskId === undefined ? undefined : taskById.get(s.taskId)?.links?.branch
        return {
          ...s,
          jobId: plan.jobId,
          projectId: plan.projectId,
          ...(branch !== undefined ? { branch } : {}),
          attention: input.attention[s.sessionId] ?? 'idle',
          openGates: s.taskId === undefined ? 0 : (gatesByTask.get(s.taskId) ?? 0)
        }
      })
    )
  )
}

/** How well `needle` matches `hay`, lower is better, or null for no match: the whole of it, the start of a word, a
 *  part of it, or its letters in order (`trw2` for "Trading Worker 2"). The same tiers as fileMatch.ts, plus the
 *  fuzzy last one: these are short labels, and a person types the initials of one. */
function tierOf(hay: string, needle: string): number | null {
  if (hay === needle) return 0
  if (hay.startsWith(needle) || hay.includes(` ${needle}`)) return 1
  if (hay.includes(needle)) return 2
  let at = 0
  for (const ch of hay) if (ch === needle[at]) at++
  return at === needle.length ? 3 : null
}

/** What a result is searched by, most telling first: a tie in tier goes to the earlier field. */
const fieldsOf = (s: IndexedSession): string[] =>
  [s.label, s.taskTitle ?? '', s.planName, s.projectName].map((f) => f.toLowerCase())

/**
 * The sessions `query` asks for, best first. Each word must match one of the label, the Task title, the plan or the
 * project; a session's rank is the sum of its words' best matches, and a tie keeps the index's order. An empty query
 * asks for nothing: the tree already shows everything.
 */
export function searchSessions(index: readonly IndexedSession[], query: string, limit = 20): IndexedSession[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const FIELDS = 4
  const scored: Array<{ s: IndexedSession; score: number; i: number }> = []
  index.forEach((s, i) => {
    const fields = fieldsOf(s)
    let score = 0
    for (const w of words) {
      let best: number | null = null
      for (let k = 0; k < FIELDS; k++) {
        const t = tierOf(fields[k], w)
        if (t !== null && (best === null || t * FIELDS + k < best)) best = t * FIELDS + k
      }
      if (best === null) return
      score += best
    }
    scored.push({ s, score, i })
  })
  return scored
    .sort((a, b) => a.score - b.score || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.s)
}

/** One thing waiting on the person. */
export type InboxItem =
  /** A session showing a permission prompt or a question (attention `waiting`). */
  | { kind: 'session'; session: IndexedSession }
  /** An open Gate: a question the orchestrator put to the person. `sessionId` is its Task's worker, when it has one. */
  | { kind: 'gate'; gate: Gate; jobId: string; projectName: string; planName: string; taskTitle?: string; sessionId?: string }
  /** A plan its planner finished that waits for "Approve & execute" (W2-A). `sessionId` is its latest planner. */
  | { kind: 'approval'; jobId: string; projectName: string; planName: string; sessionId?: string }

/** A plan awaiting approval: the W2-A rule (CONTEXT rule 10), the one place the inbox reads it. */
export const awaitsApproval = (job: Job): boolean => job.pendingStart === true && job.plannerSessionIds !== undefined

/**
 * Everything across all projects that waits on the person: sessions at a prompt, then open Gates, then plans awaiting
 * approval. Only plans in the tree count, so an archived plan the sidebar hides adds nothing.
 */
export function needsInput(input: SessionIndexInput, index: readonly IndexedSession[] = buildSessionIndex(input)): InboxItem[] {
  const plans = new Map(input.tree.flatMap((p) => p.plans.map((plan) => [plan.jobId, { plan, project: p }] as const)))
  const jobOfRun = new Map(input.runs.map((r) => [r.id, r.jobId]))
  const taskById = new Map(input.tasks.map((t) => [t.id, t]))
  const workerOf = new Map(index.filter((s) => s.taskId !== undefined).map((s) => [s.taskId!, s.sessionId]))

  const sessions: InboxItem[] = index.filter((s) => s.attention === 'waiting').map((session) => ({ kind: 'session', session }))
  const gates: InboxItem[] = input.gates
    .filter((g) => g.status === 'open')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .flatMap((gate) => {
      const jobId = jobOfRun.get(gate.runId)
      const at = jobId === undefined ? undefined : plans.get(jobId)
      if (!at) return []
      const taskTitle = taskById.get(gate.taskId)?.title
      const sessionId = workerOf.get(gate.taskId)
      return [
        {
          kind: 'gate' as const,
          gate,
          jobId: at.plan.jobId,
          projectName: at.project.name,
          planName: at.plan.name,
          ...(taskTitle !== undefined ? { taskTitle } : {}),
          ...(sessionId !== undefined ? { sessionId } : {})
        }
      ]
    })
  const approvals: InboxItem[] = input.jobs.filter(awaitsApproval).flatMap((job) => {
    const at = plans.get(job.id)
    if (!at) return []
    const sessionId = at.plan.planner.at(-1)?.sessionId
    return [
      {
        kind: 'approval' as const,
        jobId: job.id,
        projectName: at.project.name,
        planName: at.plan.name,
        ...(sessionId !== undefined ? { sessionId } : {})
      }
    ]
  })
  return [...sessions, ...gates, ...approvals]
}
