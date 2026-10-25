// A finished Run closes every session it left behind (item 9 of the owner's Gameful follow-up). The coordinator stop and
// the idle-worker release (dispatchLoop.ts) end the coordinator and the closed, non-retained Dispatches; what they never
// reach stayed alive for good: a worker whose Dispatch is still open in a Run that finished anyway, a worker whose record
// was lost (adopt.ts: only adopted onto a Task that is still ready or dispatched), a planner or replan session, a session
// a coordinator made with `sessions create`, and a session of orchestration's left in one of the Run's worktrees.
//
// **Only sessions orchestration started.** The state names its coordinators, planners and workers; a worker's launch
// prompt names its spec (`tsk_…-dsp_….md`); and the Host marks every session orchestration starts, and every session an
// agent creates, with the Run or Job it belongs to (`ORCH_MARK_KEY`, set in host/orch.ts). A session with none of these
// is the owner's own tab, and is never closed here, wherever it is. A retained Dispatch's session is kept: `worker-retain`
// is a person's "keep it".
//
// The selection is pure (`runEndSessions`); `createRunEndSweep` runs it from the driving Host's tick, under the same
// grace and settled-completion rule the coordinator stop waits for, and the same resend backoff and give-up.
import type { OrchState } from '../state'
import { jobOf } from '../state'
import { isPlaceholderSessionId, type JobRun, type Task } from '../types'
import { outcomeOfRun } from '../running'
import { completionSettled } from '../replan'
import type { ActivityDraft } from '../activity'
import { specIdsOf } from './adopt'
import { watchdogActivity } from './stallWatch'
import {
  COORDINATOR_STOP_RETRY_CAP_TRIES,
  COORDINATOR_STOP_RETRY_MAX_MS,
  COORDINATOR_STOP_RETRY_MS,
  graceOver,
  idleWorkersOf
} from './dispatchLoop'

/** A live session the Host holds: its id, the folder it runs in, its orchestration mark, and the text naming its spec
 *  (its roll prompt). */
export interface RunEndSession {
  id: string
  cwd?: string
  /** `ORCH_MARK_KEY`'s value: a Run id, a Job id, or `ORCH_MARK_AGENT`. Absent: orchestration did not start it. */
  mark?: string
  spec?: string
}

export type RunEndWhy =
  | 'coordinator'
  | 'planner'
  | 'worker'
  | 'reviewer'
  | 'untracked worker'
  | 'created'
  | 'in worktree'
  | 'retained'
  | 'not started by orchestration'

export interface RunEndPick {
  id: string
  why: RunEndWhy
  dispatchId?: string
}

export interface RunEndPlan {
  runId: string
  close: RunEndPick[]
  kept: RunEndPick[]
}

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
const inside = (cwd: string, root: string): boolean => cwd === root || cwd.startsWith(`${root}/`)

/** Each Run's Tasks, one sweep (audit OR-1's reason: a month of history is many Runs). */
export function tasksByRun(s: OrchState): Map<string, Task[]> {
  const out = new Map<string, Task[]>()
  for (const t of s.tasks) {
    if (t.runId === undefined) continue
    const list = out.get(t.runId)
    if (list) list.push(t)
    else out.set(t.runId, [t])
  }
  return out
}

/** The sessions each finished Run left behind among `live`: the ones to close, and the ones kept with why. Only Runs
 *  with something to say are returned. A session belongs to one Run, by the first of: the coordinator slot, the latest
 *  Dispatch on it, a replan, a planner (its Job's latest Run), its mark, the spec its prompt names. A marked session with
 *  no owner that runs inside a finished Run's worktree is that Run's; an unmarked one there is kept. */
export function runEndSessions(s: OrchState, live: readonly RunEndSession[], owned = tasksByRun(s)): RunEndPlan[] {
  const runs = new Map(s.runs.map((r) => [r.id, r]))
  const finished = (runId: string): boolean => {
    const run = runs.get(runId)
    return run !== undefined && outcomeOfRun(owned.get(runId) ?? [], run, s) !== 'running'
  }
  const latestRunOfJob = new Map<string, JobRun>()
  for (const r of s.runs) {
    const was = latestRunOfJob.get(r.jobId)
    if (!was || r.ordinal > was.ordinal) latestRunOfJob.set(r.jobId, r)
  }
  const taskRun = new Map<string, string>()
  for (const t of s.tasks) if (t.runId !== undefined) taskRun.set(t.id, t.runId)
  const latestOfSession = new Map<string, OrchState['dispatches'][number]>()
  for (const d of s.dispatches) latestOfSession.set(d.sessionId, d)
  const dispatchById = new Map(s.dispatches.map((d) => [d.id, d]))
  const coordinatorOf = new Map<string, string>()
  for (const r of s.runs) if (r.coordinatorSessionId !== undefined) coordinatorOf.set(r.coordinatorSessionId, r.id)
  const plannerOf = new Map<string, string>()
  for (const j of s.jobs) {
    const latest = latestRunOfJob.get(j.id)
    if (latest) for (const id of j.plannerSessionIds ?? []) plannerOf.set(id, latest.id)
  }
  const replanOf = new Map<string, string>()
  for (const j of s.jobs) if (j.replanning?.sessionId !== undefined) replanOf.set(j.replanning.sessionId, j.replanning.runId)

  /** The Run a session belongs to and why, or null when nothing links it to one. */
  const ownerOf = (x: RunEndSession): { runId: string; pick: RunEndPick } | null => {
    const coordinator = coordinatorOf.get(x.id)
    if (coordinator !== undefined) return { runId: coordinator, pick: { id: x.id, why: 'coordinator' } }
    const d = latestOfSession.get(x.id)
    const dRun = d ? taskRun.get(d.taskId) : undefined
    if (d && dRun !== undefined)
      return { runId: dRun, pick: { id: x.id, why: d.retained ? 'retained' : d.review ? 'reviewer' : 'worker', dispatchId: d.id } }
    const replan = replanOf.get(x.id) ?? plannerOf.get(x.id)
    if (replan !== undefined) return { runId: replan, pick: { id: x.id, why: 'planner' } }
    if (x.mark !== undefined) {
      const marked = runs.has(x.mark) ? x.mark : latestRunOfJob.get(x.mark)?.id
      if (marked !== undefined) return { runId: marked, pick: { id: x.id, why: 'created' } }
    }
    const ids = specIdsOf(x.spec)
    const specRun = ids ? taskRun.get(ids.taskId) : undefined
    if (ids && specRun !== undefined) {
      const recorded = dispatchById.get(ids.dispatchId)
      return { runId: specRun, pick: { id: x.id, why: recorded?.retained ? 'retained' : 'untracked worker', dispatchId: ids.dispatchId } }
    }
    return null
  }

  /** Each finished Run's worktrees: its own, and the folders its workers ran in, never its project's root. */
  let worktrees: Array<{ runId: string; root: string }> | null = null
  const worktreesOfFinished = (): Array<{ runId: string; root: string }> => {
    if (worktrees) return worktrees
    worktrees = []
    for (const run of s.runs) {
      if (!finished(run.id)) continue
      const project = jobOf(s, run)?.cwd
      const roots = new Set<string>()
      if (run.worktree) roots.add(norm(run.worktree))
      const mine = new Set((owned.get(run.id) ?? []).map((t) => t.id))
      for (const d of s.dispatches) if (mine.has(d.taskId) && d.cwd) roots.add(norm(d.cwd))
      if (project !== undefined) roots.delete(norm(project))
      for (const root of roots) if (root !== '') worktrees.push({ runId: run.id, root })
    }
    return worktrees
  }

  const plans = new Map<string, RunEndPlan>()
  const planOf = (runId: string): RunEndPlan => {
    let p = plans.get(runId)
    if (!p) plans.set(runId, (p = { runId, close: [], kept: [] }))
    return p
  }
  for (const x of live) {
    const owner = ownerOf(x)
    if (owner) {
      if (!finished(owner.runId)) continue
      const p = planOf(owner.runId)
      if (owner.pick.why === 'retained') p.kept.push(owner.pick)
      else p.close.push(owner.pick)
      continue
    }
    if (x.cwd === undefined) continue
    const cwd = norm(x.cwd)
    const hit = worktreesOfFinished().find((w) => inside(cwd, w.root))
    if (!hit) continue
    // A marked session with no Run of its own (an agent's `sessions create` outside any Run), in a finished Run's folder
    if (x.mark !== undefined) planOf(hit.runId).close.push({ id: x.id, why: 'in worktree' })
    else planOf(hit.runId).kept.push({ id: x.id, why: 'not started by orchestration' })
  }
  return [...plans.values()]
}

/** The sessions a commit gave orchestration, with the Run or Job each belongs to, for the Host to mark: a coordinator
 *  slot, a Dispatch (a worker, a reviewer, a repair), a planner and a replan session that `prev` did not name. Each list
 *  is read only when the commit replaced it, so a commit that touched none costs nothing. */
export function orchSessionsAdded(prev: OrchState, next: OrchState): Array<{ sessionId: string; owner: string }> {
  const out: Array<{ sessionId: string; owner: string }> = []
  const add = (sessionId: string | undefined, owner: string | undefined, had: (id: string) => boolean): void => {
    if (sessionId === undefined || owner === undefined || isPlaceholderSessionId(sessionId) || had(sessionId)) return
    out.push({ sessionId, owner })
  }
  if (prev.runs !== next.runs) {
    const had = new Set(prev.runs.map((r) => r.coordinatorSessionId))
    for (const r of next.runs) add(r.coordinatorSessionId, r.id, (id) => had.has(id))
  }
  if (prev.dispatches !== next.dispatches) {
    const had = new Set(prev.dispatches.map((d) => d.sessionId))
    const tasks = new Map(next.tasks.map((t) => [t.id, t]))
    for (const d of next.dispatches) {
      const t = tasks.get(d.taskId)
      add(d.sessionId, t?.runId ?? t?.jobId, (id) => had.has(id))
    }
  }
  if (prev.jobs !== next.jobs) {
    const had = new Set(prev.jobs.flatMap((j) => [...(j.plannerSessionIds ?? []), j.replanning?.sessionId]))
    for (const j of next.jobs) {
      for (const id of j.plannerSessionIds ?? []) add(id, j.id, (x) => had.has(x))
      add(j.replanning?.sessionId, j.replanning?.runId, (x) => had.has(x))
    }
  }
  return out
}

/** The Run or Job a caller session works for, by the state, for a session it creates: the Run it coordinates or
 *  replans, the Run or Job of its latest Dispatch, the Job it plans. Null when the state does not name it. */
export function orchOwnerOfCaller(s: OrchState, sessionId: string): string | null {
  if (sessionId === '') return null
  const coordinated = s.runs.find((r) => r.coordinatorSessionId === sessionId)
  if (coordinated) return coordinated.id
  const replan = s.jobs.find((j) => j.replanning?.sessionId === sessionId)
  if (replan) return replan.replanning!.runId
  let d: OrchState['dispatches'][number] | undefined
  for (const x of s.dispatches) if (x.sessionId === sessionId) d = x
  const t = d && s.tasks.find((x) => x.id === d.taskId)
  if (t) return t.runId ?? t.jobId ?? null
  return s.jobs.find((j) => j.plannerSessionIds?.includes(sessionId))?.id ?? null
}

/** What the sweep needs of the Host. `stop` ends a session through the Host's stop path (`stopCoordinator`). */
export interface RunEndSweepContext {
  getState(): OrchState
  live(): RunEndSession[]
  stop(sessionId: string, reason: string): Promise<void>
  lastPersonInputAt(sessionId: string): number | null
  sessionBusy(sessionId: string): boolean | null
  mayStart(): boolean
  nowMs(): number
  log(m: string): void
  activity?(d: ActivityDraft): void
}

type Retry = { tries: number; nextAt: number; capped: number; gaveUp: boolean }
/** dispatchLoop.ts nextTry: the wait doubles from COORDINATOR_STOP_RETRY_MS up to the cap; each wait at the cap counts. */
const nextTry = (prev: Retry | undefined, nowMs: number): Retry => {
  const tries = (prev?.tries ?? 0) + 1
  const wait = Math.min(COORDINATOR_STOP_RETRY_MS * 2 ** (tries - 1), COORDINATOR_STOP_RETRY_MAX_MS)
  return { tries, nextAt: nowMs + wait, capped: (prev?.capped ?? 0) + (wait === COORDINATOR_STOP_RETRY_MAX_MS ? 1 : 0), gaveUp: false }
}

const listed = (picks: readonly RunEndPick[]): string => (picks.length === 0 ? 'none' : picks.map((p) => `${p.id} (${p.why})`).join(', '))

/** The driving Host's pass over finished Runs' leftover sessions. One log line per Run each time it closes anything,
 *  naming what it closed, what the coordinator stop and the worker release end instead, and what it kept and why; a
 *  Run with only kept sessions is logged once. A session still alive after COORDINATOR_STOP_RETRY_CAP_TRIES stops at
 *  the cap is given up on with one log line and one feed line. A failure is logged and never thrown. */
export function createRunEndSweep(c: RunEndSweepContext): { run(): Promise<void> } {
  /** Runs this process saw running: only those wait for their completion check to settle (dispatchLoop's rule). */
  const seenRunning = new Set<string>()
  const retries = new Map<string, Retry>()
  const keptSaid = new Set<string>()
  const log = (m: string): void => {
    try {
      c.log(m)
    } catch {
      /* nowhere to say it */
    }
  }
  return {
    run: async () => {
      try {
        const s = c.getState()
        const owned = tasksByRun(s)
        for (const run of s.runs) if (outcomeOfRun(owned.get(run.id) ?? [], run, s) === 'running') seenRunning.add(run.id)
        const live = c.live()
        const alive = new Set(live.map((x) => x.id))
        for (const id of [...retries.keys()]) if (!alive.has(id)) retries.delete(id)
        const released = new Set(idleWorkersOf(s).map((w) => w.dispatch.id))
        for (const plan of runEndSessions(s, live, owned)) {
          const run = s.runs.find((r) => r.id === plan.runId)!
          const job = jobOf(s, run)
          if (job && seenRunning.has(run.id) && !completionSettled(s, job, run.id)) continue
          const finishedAt = Math.max(...(owned.get(run.id) ?? []).map((t) => Date.parse(t.updatedAt)))
          const closed: RunEndPick[] = []
          const elsewhere: RunEndPick[] = []
          const gaveUp: RunEndPick[] = []
          for (const p of plan.close) {
            const nowMs = c.nowMs()
            const due = graceOver({
              scheduled: job?.schedule !== undefined,
              finishedAt,
              typedAt: c.lastPersonInputAt(p.id),
              busy: c.sessionBusy(p.id),
              nowMs
            })
            if (!due) continue
            // The coordinator stop and the idle-worker release end these, with their own resends (dispatchLoop.ts)
            if (p.why === 'coordinator' || (p.dispatchId !== undefined && released.has(p.dispatchId))) {
              elsewhere.push(p)
              continue
            }
            const retry = retries.get(p.id)
            if (retry && (retry.gaveUp || nowMs < retry.nextAt)) continue
            if (!c.mayStart()) return
            if (retry && retry.capped >= COORDINATOR_STOP_RETRY_CAP_TRIES) {
              retry.gaveUp = true
              gaveUp.push(p)
              continue
            }
            retries.set(p.id, nextTry(retry, nowMs))
            try {
              await c.stop(p.id, `its run ${run.id} finished`)
              closed.push(p)
            } catch (e) {
              log(`run=${run.id}: closing its ${p.why} ${p.id} failed: ${String(e)}; asked again later unless the session is gone by then`)
            }
          }
          if (closed.length > 0 || (plan.close.length === 0 && plan.kept.length > 0 && !keptSaid.has(run.id))) {
            keptSaid.add(run.id)
            log(
              `run=${run.id} finished: closed ${listed(closed)}` +
                (elsewhere.length > 0 ? `; left to the coordinator stop and the worker release ${listed(elsewhere)}` : '') +
                `; kept ${listed(plan.kept)}`
            )
          }
          if (gaveUp.length > 0) {
            log(`run=${run.id}: gave up closing ${listed(gaveUp)} after ${COORDINATOR_STOP_RETRY_CAP_TRIES} stops at the longest wait`)
            try {
              c.activity?.(watchdogActivity(s, run.id, `Could not close ${gaveUp.length} session(s) this finished plan left: ${gaveUp.map((p) => p.id).join(', ')}`))
            } catch (e) {
              log(`run=${run.id}: the feed line for the sessions it left could not be written: ${String(e)}`)
            }
          }
        }
      } catch (e) {
        log(`closing finished runs' sessions failed: ${String(e)}`)
      }
    }
  }
}
