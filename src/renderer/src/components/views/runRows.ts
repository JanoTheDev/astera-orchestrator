// A Run view row's state (DESIGN-W13 §4): what the row says about its configuration's live runs. A compound owns no run
// of its own, so it reads its members' (the same expansion ▶ and ⏹ use).
import type { RunConfig, RunStatus } from '../../../../core/types'
import { actedConfigIds } from '../../../../core/run/instances'

export type RunRowState = { state: 'idle' } | { state: 'running' | 'stopping'; live: number; stopTargets: string[] }

export function runRowState(runs: readonly RunStatus[], configs: readonly RunConfig[], configId: string): RunRowState {
  const acted = new Set(actedConfigIds(configs, configId))
  const live = runs.filter((r) => acted.has(r.configId) && r.status !== 'exited')
  if (live.length === 0) return { state: 'idle' }
  const running = live.filter((r) => r.status === 'running')
  return { state: running.length > 0 ? 'running' : 'stopping', live: live.length, stopTargets: running.map((r) => r.runId) }
}

/** The word on the row: "running", "running ×2" with several instances, "stopping", or nothing when idle. */
export function runRowText(row: RunRowState, t: (key: 'run.state.running' | 'run.state.stopping') => string): string {
  if (row.state === 'idle') return ''
  const word = t(row.state === 'running' ? 'run.state.running' : 'run.state.stopping')
  return row.live > 1 ? `${word} ×${row.live}` : word
}
