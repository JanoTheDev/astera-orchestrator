// A Run view row's state (DESIGN-W13 §4): what the row says about its configuration's live runs. A compound owns no run
// of its own, so it reads its members' (the same expansion ▶ and ⏹ use).
import type { RunConfig, RunStatus } from '../../../../core/types'
import { actedConfigIds } from '../../../../core/run/instances'
import { exitWording } from '../../../../core/sessions/exitWording'

/** `outputRunId` is the newest run of the row, the one Show output opens. `exited`: nothing is live and a run ended —
 *  `run` is the newest of them, `failed` is exitWording's danger tone (a crash), `dismissTargets` every ended run
 *  Dismiss drops (dropping only the newest would let the next older one take its place). */
export type RunRowState =
  | { state: 'idle' }
  | { state: 'running' | 'stopping'; live: number; stopTargets: string[]; outputRunId: string }
  | { state: 'exited'; run: RunStatus; failed: boolean; dismissTargets: string[]; outputRunId: string }

const newest = (runs: readonly RunStatus[]): RunStatus => runs.reduce((a, b) => (b.startedAt >= a.startedAt ? b : a))

export function runRowState(runs: readonly RunStatus[], configs: readonly RunConfig[], configId: string): RunRowState {
  const acted = new Set(actedConfigIds(configs, configId))
  const mine = runs.filter((r) => acted.has(r.configId))
  if (mine.length === 0) return { state: 'idle' }
  const live = mine.filter((r) => r.status !== 'exited')
  if (live.length === 0) {
    const run = newest(mine)
    const failed = exitWording(run.exitCode, { closedByAstera: run.closedByAstera, closeReason: run.closeReason }).tone === 'danger'
    return { state: 'exited', run, failed, dismissTargets: mine.map((r) => r.runId), outputRunId: run.runId }
  }
  const running = live.filter((r) => r.status === 'running')
  return {
    state: running.length > 0 ? 'running' : 'stopping',
    live: live.length,
    stopTargets: running.map((r) => r.runId),
    outputRunId: newest(live).runId
  }
}

/** The word on the row: "running", "running ×2" with several instances, "stopping", or nothing when idle or ended
 *  (an ended row reads its exit wording instead, see exitWording). */
export function runRowText(row: RunRowState, t: (key: 'run.state.running' | 'run.state.stopping') => string): string {
  if (row.state === 'idle' || row.state === 'exited') return ''
  const word = t(row.state === 'running' ? 'run.state.running' : 'run.state.stopping')
  return row.live > 1 ? `${word} ×${row.live}` : word
}
