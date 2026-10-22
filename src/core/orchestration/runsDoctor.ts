// `astera runs doctor` (T8, decision 8): every Run whose stored state disagrees with what is really going on, and the
// repair each one already has elsewhere. Nothing here is a new rule: "nothing can move" is running.ts `stuckOf`, a
// stopped reviewer is `reviewerEnded`, a lost worker is lostGate.ts `lostWithNobody`, a stray session is runEnd.ts
// `runEndSessions`, and the repairs are the load's restart Gate (`interruptStalledTask`), the session-exit path
// (`handleExit`, which closes a Dispatch whose process is gone), the Run-end sweep's stop, and a Gate.
//
// Not checked: a Task left `validating` with no Dispatch. The app's validator runs in-process with no session, so
// "nothing validates it" cannot be told from the state (host/driving.ts `unchecked`). Nor a pending delivery: the Run
// carries no retry schedule on this branch (T2 adds one).
import { t, type Lang } from '../i18n'
import { createGate, jobOf, type OrchState } from './state'
import { interruptStalledTask } from './state'
import { FAILURE_LIMIT, isPlaceholderSessionId, type JobRun } from './types'
import { isTerminal, outcomeOf, reviewerEnded, stuckOf, tasksOwnedBy } from './running'
import { lostWithNobody } from './lostGate'
import { runEndSessions } from './exec/runEnd'
import type { RunStuck } from '../types'

export type DoctorKind = 'stuck' | 'stopped-reviewer' | 'lost-worker' | 'dead-dispatch' | 'stray-session'

export interface DoctorFinding {
  kind: DoctorKind
  runId: string
  taskId?: string
  dispatchId?: string
  sessionId?: string
  /** `stuck` only */
  stuck?: RunStuck
  /** One line: what disagrees */
  detail: string
}

/** A session the Host holds (command.ts HostSession, the fields read here). */
export interface DoctorSession {
  id: string
  alive: boolean
  cwd?: string | null
}

/** Every mismatch in the Runs named. `sessions` absent: no session list (no Host), so the two checks that read
 *  processes (a dead Dispatch, a stray session) are skipped. A Dispatch is dead only when the Host lists its session
 *  as not alive: one it does not list may run elsewhere (another runtime, a Host restarted since), and closing a live
 *  worker's Dispatch would start a second one in its worktree. */
export function diagnoseRuns(s: OrchState, runIds: readonly string[], sessions?: readonly DoctorSession[]): DoctorFinding[] {
  const out: DoctorFinding[] = []
  const wanted = new Set(runIds)
  const runs = s.runs.filter((r) => wanted.has(r.id))
  const lost = lostWithNobody(s)
  const dead = new Set((sessions ?? []).filter((x) => !x.alive).map((x) => x.id))
  for (const run of runs) {
    const tasks = tasksOwnedBy(s, run.id)
    const stuck = run.paused === true ? undefined : stuckOf(s, run, tasks)
    if (stuck)
      out.push({
        kind: 'stuck',
        runId: run.id,
        stuck,
        detail:
          stuck === 'needs-you'
            ? 'reads running, but every unfinished Task waits on the owner'
            : 'reads running, but its failed Tasks have no coordinator and nothing retries them'
      })
    for (const task of tasks) {
      if (task.status === 'reviewing' && reviewerEnded(s.dispatches, task.id))
        out.push({ kind: 'stopped-reviewer', runId: run.id, taskId: task.id, detail: `${task.id} is reviewing, and its reviewer ended` })
    }
    for (const seed of lost)
      if (seed.runId === run.id)
        out.push({
          kind: 'lost-worker',
          runId: run.id,
          taskId: seed.taskId,
          dispatchId: seed.dispatch.id,
          detail: `${seed.taskId} is dispatched, its worker (${seed.dispatch.id}) ended unreported, and no coordinator retries it`
        })
    for (const d of s.dispatches) {
      if (d.outcome || d.endedAt || isPlaceholderSessionId(d.sessionId) || !dead.has(d.sessionId)) continue
      if (!tasks.some((x) => x.id === d.taskId)) continue
      out.push({
        kind: 'dead-dispatch',
        runId: run.id,
        taskId: d.taskId,
        dispatchId: d.id,
        sessionId: d.sessionId,
        detail: `dispatch ${d.id} is open, and its session ${d.sessionId} has exited`
      })
    }
  }
  if (sessions !== undefined) {
    const live = sessions.filter((x) => x.alive).map((x) => ({ id: x.id, ...(x.cwd ? { cwd: x.cwd } : {}) }))
    for (const plan of runEndSessions(s, live))
      if (wanted.has(plan.runId))
        for (const p of plan.close)
          out.push({
            kind: 'stray-session',
            runId: plan.runId,
            sessionId: p.id,
            ...(p.dispatchId !== undefined ? { dispatchId: p.dispatchId } : {}),
            detail: `${p.why} session ${p.id} is alive, and its run has ${outcomeOf(s, plan.runId)}`
          })
  }
  return out
}

/** The Runs a doctor call looks at: one Run, a Job's Runs, or every Run (`--all`). */
export function doctorRunIds(s: OrchState, a: { run?: string; job?: string; all?: boolean }): string[] | null {
  if (a.run !== undefined) return s.runs.some((r) => r.id === a.run) ? [a.run] : null
  if (a.job !== undefined) return s.jobs.some((j) => j.id === a.job) ? s.runs.filter((r) => r.jobId === a.job).map((r) => r.id) : null
  return s.runs.map((r) => r.id)
}

/** What `--fix` needs: the state doors, the session-exit path and the session stop. */
export interface DoctorFixContext {
  getState(): OrchState
  setState(s: OrchState): Promise<void>
  now(): string
  lang: Lang
  /** command.ts handleExit: closes the Dispatch of a session that exited, as its exit event would have */
  sessionExited(sessionId: string): Promise<void>
  /** Ends a session (the Run-end sweep's stop). Absent: no one holds sessions, a stray one is left. */
  stopSession?(sessionId: string, reason: string): Promise<void>
}

export interface DoctorRepair {
  finding: DoctorFinding
  fixed: boolean
  /** What was done, or why nothing was */
  did: string
}

/** Applies each finding's repair, each on the state as it is then. A `needs-you` Run is the owner's to answer. */
export async function repairFindings(findings: readonly DoctorFinding[], c: DoctorFixContext): Promise<DoctorRepair[]> {
  const out: DoctorRepair[] = []
  for (const f of findings) out.push({ finding: f, ...(await repairOne(f, c)) })
  return out
}

async function repairOne(f: DoctorFinding, c: DoctorFixContext): Promise<{ fixed: boolean; did: string }> {
  switch (f.kind) {
    case 'stuck': {
      if (f.stuck === 'needs-you') return { fixed: false, did: 'left to the owner: answer its open question (inbox)' }
      // Stalled: each failed Task nobody retries gets a Gate, so the owner's answer runs it again (resolveGate)
      const s = c.getState()
      const run = s.runs.find((r) => r.id === f.runId)
      if (!run || stuckOf(s, run) !== 'stalled') return { fixed: false, did: 'no longer stalled' }
      let next = s
      const gated: string[] = []
      for (const task of failedNobodyRetries(next, run)) {
        const r = createGate(next, { taskId: task.id, question: t(c.lang, 'plan.doctor.failedGate', { failures: task.consecutiveFailures, limit: FAILURE_LIMIT }) }, c.now())
        if (!r.ok) continue
        next = r.state
        gated.push(task.id)
      }
      if (gated.length === 0) return { fixed: false, did: 'no Gate could be opened' }
      await c.setState(next)
      return { fixed: true, did: `opened a retry Gate on ${gated.join(', ')}` }
    }
    case 'stopped-reviewer': {
      const s = c.getState()
      const task = s.tasks.find((x) => x.id === f.taskId)
      if (!task || task.status !== 'reviewing' || !reviewerEnded(s.dispatches, task.id)) return { fixed: false, did: 'no longer stopped' }
      const r = interruptStalledTask(s, { taskId: task.id }, c.now())
      if (!r.interrupted) return { fixed: false, did: r.resume ? `left to its convergence Run, which reruns the ${r.resume}` : 'the restart Gate was refused' }
      await c.setState(r.state)
      return { fixed: true, did: 'opened the restart Gate (the review ended unreported)' }
    }
    case 'lost-worker': {
      const s = c.getState()
      if (!lostWithNobody(s).some((x) => x.taskId === f.taskId)) return { fixed: false, did: 'no longer lost' }
      const r = createGate(s, { taskId: f.taskId!, question: t(c.lang, 'jobs.gate.workerLostNoApp', { dispatch: f.dispatchId ?? '' }) }, c.now())
      if (!r.ok) return { fixed: false, did: `the lost-worker Gate was refused: ${r.error}` }
      await c.setState(r.state)
      return { fixed: true, did: 'opened the lost-worker Gate' }
    }
    case 'dead-dispatch':
      await c.sessionExited(f.sessionId!)
      return { fixed: true, did: `closed dispatch ${f.dispatchId} as its session's exit would have` }
    case 'stray-session':
      if (!c.stopSession) return { fixed: false, did: 'nothing here holds sessions' }
      await c.stopSession(f.sessionId!, `its run ${f.runId} finished (runs doctor)`)
      return { fixed: true, did: `closed session ${f.sessionId}` }
  }
}

/** The failed Tasks of a Run with tries left and nothing to retry them (stuckOf's `stalled`), less any already gated. */
function failedNobodyRetries(s: OrchState, run: JobRun): OrchState['tasks'] {
  if (run.coordinatorSessionId !== undefined || run.externalCoordinatorSessionId !== undefined || jobOf(s, run)?.replanning) return []
  return tasksOwnedBy(s, run.id).filter(
    (x) =>
      x.status === 'failed' &&
      !isTerminal(x) &&
      !s.gates.some((g) => g.taskId === x.id && g.status === 'open') &&
      !s.dispatches.some((d) => d.taskId === x.id && !d.outcome && !d.endedAt)
  )
}
