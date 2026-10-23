// The Run view's rows: one per configuration, with the running state the row shows. Pure (DESIGN-W13 §4, Run).
import type { RunConfig, RunStatus } from '../../../../core/types'
import { toolbarState } from '../../../../core/run/instances'
import { configRowStatus } from '../../../../core/run/menuRows'

export type RunRow = {
  config: RunConfig
  /** Live instances of this configuration (a stopping one still counts: it is the user's process). */
  running: number
  /** What the Stop action ends; empty when nothing of it is running (a compound stops its live members). */
  stopTargets: string[]
}

export function runRows(configs: readonly RunConfig[], runs: readonly RunStatus[]): RunRow[] {
  return configs.map((config) => {
    const status = configRowStatus(runs, config.id)
    return {
      config,
      running: status?.kind === 'running' ? status.count : 0,
      stopTargets: toolbarState([...runs], config.id, [...configs]).stopTargets
    }
  })
}

/** "running", or "2 running" when several instances of one configuration are up. */
export function runStateText(running: number, t: (key: 'run.view.running' | 'run.menu.running', p?: { count: number }) => string): string {
  return running > 1 ? t('run.menu.running', { count: running }) : t('run.view.running')
}
