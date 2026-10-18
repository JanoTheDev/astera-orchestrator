// Stall watchdog (owner 2026-10-18: "i want this all built in later i dont want to have a claude tab on the side to do
// stuff"). Every plan that stalls in one of four known ways is moved on by the Host itself, without an agent of its
// own: a ready Task nobody starts, a coordinator busy with nothing to show, a completed Task left out of the plan
// branch, a wave whose draft PR never opened. Checked every `STALL_WATCH_MS` from the dispatch loop's tick
// (dispatchLoop.ts watchStalls), which applies the remedies and writes one feed line for each.
//
// **Detection is pure** (`stallRemedies`): Host state, the time and the memo of what was already done, plus the few
// facts only the process has (busy, a registered worktree, a usage pause) as probes. Each remedy is applied once per
// stall: the memo keys a stall by what makes it one (a Task's readiness moment, a busy spell, a wave), and a stall
// that clears drops its entry, so the next one starts over. Nothing destructive: it tells, starts, merges into the
// plan branch, refreshes a coordinator and retries a draft PR. It never cancels, rewrites or merges into main.
import type { ActivityDraft } from '../activity'
import { readyWithoutWorker, type CoordinatorNotice } from '../inbox'
import { jobNameOf } from '../jobName'
import { wavesToMerge } from '../integrate'
import { draftPrDue } from '../draftPr'
import { isJobActive } from '../lifecycle'
import { coordinatorStarting, jobOf, type OrchState } from '../state'
import { DEFAULT_CONCURRENCY, FAILURE_LIMIT, type Task } from '../types'
import { outcomeOf } from '../view'
import { workerStartInFlight } from './coordinatorRotate'

/** How often the watchdog looks. */
export const STALL_WATCH_MS = 30_000
/** A ready Task with a free slot and no worker: the coordinator is told after this, and Astera starts it this long after that. */
export const READY_STALL_MS = 2 * 60_000
/** A coordinator busy this long with no worker started, no Gate and no message is told what is ready. */
export const BUSY_TELL_MS = 5 * 60_000
/** ... and replaced by a fresh coordinator after this long. */
export const BUSY_REFRESH_MS = 10 * 60_000
/** A completed Task not in the plan branch this long after it completed: its merge is retried. */
export const MERGE_STALL_MS = 2 * 60_000
/** A draft PR due this long and not opened or updated: it is asked again. */
export const DRAFT_STALL_MS = 2 * 60_000

/** One stall the watchdog has seen: since when, how many of its remedies were applied, and when the last one was. */
export interface StallEntry {
  since: number
  step: number
  at: number
}
/** By stall key. In memory: a restart starts every stall over, which at worst repeats one remedy. */
export type StallMemo = ReadonlyMap<string, StallEntry>

/** What only the process can tell. */
export interface StallProbe {
  /** true busy, false idle, null cannot tell (DispatchLoopContext.sessionBusy) */
  busy(sessionId: string): boolean | null
  isRegistered(p: string): boolean
  /** The usage guard holds new workers on this account: its ready Tasks wait for it, not for the coordinator. */
  paused?(accountId: string): boolean
}

export type StallRemedy = { key: string; runId: string } & (
  | { kind: 'tell-start'; task: Task; since: number }
  | { kind: 'place'; task: Task; since: number }
  | { kind: 'tell-busy'; sessionId: string; since: number }
  | { kind: 'refresh'; sessionId: string; since: number }
  | { kind: 'merge'; task: Task; runRoot: string; worktree: string }
  | { kind: 'draft-pr'; done: number }
)

/** Something the plan did since `since`: a worker started, a Gate opened, a question or escalation came in, or the
 *  coordinator acked its mail (`check --ack`). The Host's own `status` notices are not the coordinator's doing.
 *  shortcut: a Message records no sender, so a worker's question counts as the plan moving too; upgrade if that ever
 *  hides a stuck coordinator. */
function movedSince(s: OrchState, runId: string, since: number): boolean {
  const after = (iso: string | undefined): boolean => iso !== undefined && Date.parse(iso) >= since
  const mine = new Set(s.tasks.filter((t) => t.runId === runId).map((t) => t.id))
  return (
    s.dispatches.some((d) => mine.has(d.taskId) && after(d.startedAt)) ||
    s.gates.some((g) => g.runId === runId && after(g.createdAt)) ||
    s.messages.some((m) => m.runId === runId && (m.type === 'question' || m.type === 'escalation') && after(m.createdAt)) ||
    s.deliveries.some((d) => d.runId === runId && after(d.ackedAt))
  )
}

/** The remedies due now, and the memo to keep. A healthy plan gets none. */
export function stallRemedies(
  s: OrchState,
  nowMs: number,
  memo: StallMemo,
  probe: StallProbe
): { due: StallRemedy[]; memo: Map<string, StallEntry> } {
  const next = new Map<string, StallEntry>()
  const due: StallRemedy[] = []
  /** A stall seen now keeps its entry, or starts one at `since`. */
  const seen = (key: string, since: number): StallEntry => {
    const e = memo.get(key) ?? { since, step: 0, at: 0 }
    next.set(key, e)
    return e
  }
  const stepped = (key: string, e: StallEntry): void => {
    next.set(key, { ...e, step: e.step + 1, at: nowMs })
  }
  const at = new Map(s.tasks.map((t) => [t.id, Date.parse(t.updatedAt)]))

  // A running plan its coordinator places: not paused, held, replanning, stopping or between coordinators
  for (const run of s.runs) {
    const sessionId = run.coordinatorSessionId
    const job = jobOf(s, run)
    if (sessionId === undefined || !job || !isJobActive(job) || job.paused || job.dispatchHold || job.pendingStart) continue
    if (job.replanning || run.paused || run.coordinatorStop || run.coordinatorStopPending !== undefined) continue
    if (coordinatorStarting(run, nowMs) || outcomeOf(s, run.id) !== 'running' || workerStartInFlight(s, run.id, nowMs)) continue
    const mine = new Set(s.tasks.filter((t) => t.runId === run.id).map((t) => t.id))
    const open = s.dispatches.filter((d) => mine.has(d.taskId) && !d.outcome && !d.endedAt).length
    let free = (job.concurrency ?? DEFAULT_CONCURRENCY) - open
    const startable = readyWithoutWorker(s, run.id).filter(
      (t) => (t.accountIds?.length ?? 0) > 0 && t.consecutiveFailures < FAILURE_LIMIT && probe.paused?.(t.accountIds![0]) !== true
    )

    // Ready, a free slot, no worker: tell the exact start, then start it
    for (const t of startable) {
      if (free <= 0) break
      free--
      const since = Math.max(at.get(t.id) ?? 0, ...t.deps.map((d) => at.get(d) ?? 0))
      if (nowMs - since < READY_STALL_MS) continue
      const key = `ready:${t.id}:${since}`
      const e = seen(key, since)
      if (e.step === 0) {
        due.push({ key, runId: run.id, kind: 'tell-start', task: t, since })
        stepped(key, e)
      } else if (e.step === 1 && nowMs - e.at >= READY_STALL_MS) {
        due.push({ key, runId: run.id, kind: 'place', task: t, since })
        stepped(key, e)
      }
    }

    // Busy with work waiting and nothing to show for it: tell it, then a fresh coordinator
    const slots = (job.concurrency ?? DEFAULT_CONCURRENCY) - open
    if (probe.busy(sessionId) === true && startable.length > 0 && slots > 0) {
      const key = `busy:${sessionId}`
      let e = seen(key, nowMs)
      if (movedSince(s, run.id, e.since)) {
        e = { since: nowMs, step: 0, at: 0 }
        next.set(key, e)
      }
      if (e.step === 0 && nowMs - e.since >= BUSY_TELL_MS) {
        due.push({ key, runId: run.id, kind: 'tell-busy', sessionId, since: e.since })
        stepped(key, e)
      } else if (e.step === 1 && nowMs - e.since >= BUSY_REFRESH_MS) {
        due.push({ key, runId: run.id, kind: 'refresh', sessionId, since: e.since })
        stepped(key, e)
      }
    }
  }

  // Completed and not in the plan branch, finished plans too: their delivery needs it there
  const byId = new Map(s.tasks.map((t) => [t.id, t]))
  for (const w of wavesToMerge(s, (p) => probe.isRegistered(p))) {
    const t = byId.get(w.taskId)!
    if (nowMs - (at.get(t.id) ?? nowMs) < MERGE_STALL_MS) continue
    const key = `merge:${t.id}`
    const e = seen(key, at.get(t.id)!)
    if (e.step > 0) continue
    due.push({ key, runId: w.runId, kind: 'merge', task: t, runRoot: w.runRoot, worktree: w.worktree })
    stepped(key, e)
  }

  // A wave done, its draft PR not opened or updated (draftPr.ts draftPrDue stays due until the PR records it)
  for (const run of s.runs) {
    const done = draftPrDue(s, run)
    if (done === null) continue
    const key = `draft:${run.id}:${done}`
    const e = seen(key, nowMs)
    if (e.step > 0 || nowMs - e.since < DRAFT_STALL_MS) continue
    due.push({ key, runId: run.id, kind: 'draft-pr', done })
    stepped(key, e)
  }
  return { due, memo: next }
}

/** One watchdog action as its feed line ("Watchdog: …"): a line no commit makes, recorded by the Host. */
export function watchdogActivity(s: OrchState, runId: string, reason: string, taskId?: string): ActivityDraft {
  const run = s.runs.find((r) => r.id === runId)
  const job = run ? jobOf(s, run) : undefined
  return {
    type: 'watchdog',
    ...(job?.projectId !== undefined ? { projectId: job.projectId } : {}),
    ...(job !== undefined ? { jobId: job.id } : {}),
    runId,
    ...(taskId !== undefined ? { taskId } : {}),
    payload: { title: job ? jobNameOf(job) : runId, reason }
  }
}

/** The notice that tells a coordinator the exact start of a stalled ready Task. `agent` is the account's vendor. */
export function startNotice(runId: string, t: Task, since: number, agent: string): CoordinatorNotice {
  return {
    runId,
    taskId: t.id,
    subject: `watchdog: task ${t.id} ready since ${new Date(since).toISOString()}`,
    body:
      `${t.id} (${t.title}) has been ready for 2 minutes with a free slot and no worker. Start it now:\n\n` +
      `astera worker-start --task ${t.id} --agent ${agent} --account ${t.accountIds?.[0] ?? ''} --json\n\n` +
      'If it is still unstarted in 2 minutes, Astera starts it itself.'
  }
}
