// T23: plans pick up by themselves after a crash. The Host, at its start, reads what orchestration.json says was in
// flight; when anything was, it loads now instead of waiting for an app (the load is lazy otherwise, and a Host
// started at login with no app would idle out with the plans still stopped).
//
// What happens after the load is the machinery that already exists, in order:
// - the load closes every Dispatch whose session did not outlive the crash and empties dead coordinator slots
//   (store.ts `load`);
// - the Host's recovery (host/recovery.ts) resumes each lost worker in its own worktree, `claude --resume` on its
//   conversation when one was recorded (recovery/decide.ts `resume-native`), with `crashResumeBriefing` appended to
//   its spec. Recovery never resets or deletes a worktree: a dirty one is resumed or gated, never cleaned.
// Here: waiting for that, then a coordinator for every Run whose coordinator died, then one feed line saying what was
// recovered. T5: the dead coordinator's own conversation is resumed (`run-start --resume`, `claude --resume`) when its
// native id is known (`nativeIdOf`); else, or when that start is refused, a fresh one (`run-start`, whose restart brief
// carries `coordinatorHandoff`, the fresh-coordinator brief).
import type { ActivityDraft } from '../activity'
import type { GitSummary } from '../checkpoint'
import type { OrchState } from '../state'
import { outcomeOf } from '../running'

export const CRASH_RESUME_NOTE = 'Astera restarted after a crash; check git status, finish the Task.'
/** Why a restarted coordinator was restarted, in its brief's "was ended (…)". */
export const CRASH_REASON = 'Astera restarted after a crash'
/** How long the start waits for recovery to act on every lost worker before it goes on without it. */
export const RECOVERY_WAIT_MS = 120_000
/** T5: the whole brief of a coordinator or planner resumed in its own conversation after a crash: it already knows its
 *  role and its plan, so only what happened. */
export const crashResumedBrief = (role: 'coordinator' | 'planner', id: string): string =>
  `${CRASH_REASON}, and this conversation was resumed. Carry on as the ${role} of ${id}: read its current state with \`astera\` before you act.`
const POLL_MS = 2_000
const LISTED_FILES = 50

/** What a worker resumed after its session was lost is told, at the end of its spec: the note, and the uncommitted
 *  changes its worktree still holds, which are its own work and must be kept. */
export function crashResumeBriefing(git: GitSummary | null): string {
  const lines = [CRASH_RESUME_NOTE, '']
  if (git === null) lines.push('Astera could not read git status in this folder: run `git status` before you change anything.')
  else if (git.changed.length === 0) lines.push('The worktree has no uncommitted changes: what you did before the crash is in its commits.')
  else
    lines.push(
      `Uncommitted changes from before the crash are still in this worktree (${git.changed.length} file(s)). They are your own work in progress: keep them and finish from there.`,
      ...git.changed.slice(0, LISTED_FILES).map((f) => `- ${f}`),
      ...(git.changed.length > LISTED_FILES ? [`- … and ${git.changed.length - LISTED_FILES} more`] : [])
    )
  lines.push('', 'Do not reset, stash, clean or delete anything in this folder.')
  return lines.join('\n')
}

/** What the file says was in flight: open Dispatches, and running Runs with a coordinator in their slot. */
export function inFlightOf(s: OrchState): { dispatchIds: string[]; coordinatorRuns: string[] } {
  return {
    dispatchIds: s.dispatches.filter((d) => !d.endedAt && !d.outcome).map((d) => d.id),
    coordinatorRuns: s.runs
      .filter((r) => r.coordinatorSessionId !== undefined && r.paused !== true && outcomeOf(s, r.id) === 'running')
      .map((r) => r.id)
  }
}

/** A lost Dispatch recovery is done with: it reported after all, or it was closed and its Task has a new attempt, an
 *  open Gate, or is no longer waiting on it. */
function settled(s: OrchState, id: string): boolean {
  const d = s.dispatches.find((x) => x.id === id)
  if (!d || d.outcome) return true
  if (!d.endedAt) return false
  if (s.dispatches.some((x) => x.retryOf === id)) return true
  if (s.gates.some((g) => g.taskId === d.taskId && g.status === 'open')) return true
  const task = s.tasks.find((t) => t.id === d.taskId)
  return !task || task.status !== 'dispatched'
}

export const crashFeedLine = (workers: number, coordinators: number, waiting = 0): string =>
  `Recovered after a crash: resumed ${workers} worker${workers === 1 ? '' : 's'}, ${coordinators} coordinator${coordinators === 1 ? '' : 's'}` +
  (waiting > 0 ? `; ${waiting} worker${waiting === 1 ? ' waits' : 's wait'} for a free slot` : '')

export interface CrashResumeDeps {
  /** orchestration.json as it is on disk, before anything loads it; null when there is none. */
  readFile(): OrchState | null
  /** The Host's load (its restart cleanup, then the recovery sweep its driving starts). */
  ready(): Promise<void>
  state(): OrchState
  /** A command under the Host's own caller. */
  handle(cmd: string, args: Record<string, unknown>): Promise<{ status: number; body: unknown }>
  /** The recovery work in flight, awaited (host/recovery.ts `catchUp`). */
  settle(): Promise<void>
  /** T2: the lost Dispatches recovery left for a free slot (host/recovery.ts `waiting`): done with for now, so the
   *  coordinators are not held back behind them. Absent: none. */
  waiting?(): ReadonlySet<string>
  activity(d: ActivityDraft): void
  log(m: string): void
  /** T5: the agent CLI's own conversation id a dead session had (`agentSessionOf`, or what the Host saved); null for
   *  none. Absent: every coordinator starts fresh. */
  nativeIdOf?(sessionId: string): Promise<string | null>
  sleep?(ms: number): Promise<void>
  nowMs?(): number
}

/** Runs once at the Host's start. Null when the file shows nothing in flight (nothing loaded, nothing said). Never
 *  rejects. */
export async function resumeAfterCrash(d: CrashResumeDeps): Promise<{ workers: number; coordinators: number } | null> {
  try {
    const before = d.readFile()
    if (!before) return null
    const was = inFlightOf(before)
    if (was.dispatchIds.length === 0 && was.coordinatorRuns.length === 0) return null
    d.log(`crash resume: ${was.dispatchIds.length} worker(s) and ${was.coordinatorRuns.length} coordinator(s) were in flight — loading`)
    await d.ready()

    const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
    const now = d.nowMs ?? Date.now
    const until = now() + RECOVERY_WAIT_MS
    const waitingNow = (id: string): boolean => !settled(d.state(), id) && (d.waiting?.().has(id) ?? false)
    for (;;) {
      await d.settle()
      if (was.dispatchIds.every((id) => settled(d.state(), id) || waitingNow(id))) break
      if (now() >= until) {
        d.log('crash resume: recovery has not acted on every lost worker yet; going on without it')
        break
      }
      await sleep(POLL_MS)
    }
    const lost = new Set(was.dispatchIds)
    const workers = d.state().dispatches.filter((x) => x.retryOf !== undefined && lost.has(x.retryOf)).length

    let coordinators = 0
    for (const runId of was.coordinatorRuns) {
      const s = d.state()
      const run = s.runs.find((r) => r.id === runId)
      // Still in its slot: the session outlived the crash (or a coordinator was started meanwhile).
      if (!run || run.coordinatorSessionId !== undefined || run.paused === true || outcomeOf(s, runId) !== 'running') continue
      const started = (): boolean => d.state().runs.find((x) => x.id === runId)?.coordinatorSessionId !== undefined
      const dead = before.runs.find((x) => x.id === runId)?.coordinatorSessionId
      const native = dead && d.nativeIdOf ? await d.nativeIdOf(dead).catch(() => null) : null
      if (native) {
        const r = await d.handle('run-start', { run: runId, reason: CRASH_REASON, resume: native })
        if (r.status < 300 && started()) {
          coordinators++
          continue
        }
        d.log(`crash resume: run ${runId}'s coordinator could not resume ${native} (${r.status} ${JSON.stringify(r.body)}); starting a fresh one`)
      }
      const r = await d.handle('run-start', { run: runId, reason: CRASH_REASON })
      if (r.status < 300 && started()) coordinators++
      else d.log(`crash resume: run ${runId}'s coordinator could not be restarted (${r.status} ${JSON.stringify(r.body)})`)
    }

    const line = crashFeedLine(workers, coordinators, was.dispatchIds.filter(waitingNow).length)
    d.log(`crash resume: ${line}`)
    d.activity({ type: 'host.recovered', payload: { title: 'Astera', reason: line } })
    return { workers, coordinators }
  } catch (err) {
    d.log(`crash resume failed: ${String(err)}`)
    return null
  }
}
