// The lost-worker Tasks nobody else will look after (design D6, plan ruling R16).
//
// A worker that exits unreported while no app is attached is closed by `handleExit`, and its
// `onDispatchLost` is dropped (it is FIRE_AND_FORGET with no app). The Task then stays `dispatched`
// over a lost Dispatch forever. The Host cannot read the app's journal (D8), so it cannot resume one;
// what it can do is hand the Task to a person with a Gate. Which Tasks: the ones `candidates()` names
// — the reconciler's own rule, so "lost" means one thing in both processes — **in a Run nobody drives**:
// no coordinator slot and not app-driven (`drivenByAppAlone`). A Run with a coordinator is left to it: it
// sees the closed Dispatch and starts again with `--retry-of`. An app-driven Run is the stall watchdog's
// (exec/stallWatch.ts), which starts it again the same way: a plan the Host drives alone must not stop on
// an owner Gate because a worker died with the laptop.
//
// The caller decides *when* (only while the Host drives and no app is attached, N5, and since Phase 3R only
// while no Host recovery owns recovery: the journal off, remote runtime design §2.6); this decides *which*. Pure.
import { candidates, type LostAttemptSeed } from '../recovery/candidates'
import { drivenByAppAlone, jobOf, type OrchState } from './state'
import type { JobRun } from './types'

/** Whether something starts a lost worker's Task again: the Run's coordinator, or the app's loop for a Run it drives alone. */
export function lostRetriedIn(s: OrchState, run: JobRun): boolean {
  return !!run.coordinatorSessionId || drivenByAppAlone(jobOf(s, run), run)
}

/** R16: the lost-worker Tasks nobody else will look after — candidates() in Runs nobody drives. */
export function lostWithNobody(s: OrchState): LostAttemptSeed[] {
  return candidates(s).filter((seed) => {
    const run = s.runs.find((r) => r.id === seed.runId)
    return run !== undefined && !lostRetriedIn(s, run)
  })
}

/** The other half: lost-worker Tasks in a driven Run, which are started again (`--retry-of`): by its coordinator, else by
 *  the stall watchdog (exec/stallWatch.ts), which retries the ones it leaves. */
export function lostWithDriver(s: OrchState): LostAttemptSeed[] {
  return candidates(s).filter((seed) => s.runs.some((r) => r.id === seed.runId && lostRetriedIn(s, r)))
}
