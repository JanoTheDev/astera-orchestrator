// Which actions a run configuration offers, by state: the Run view's right-click menu and the toolbar's ⋮ menu. Pure, so
// the node-only suite reaches it; the components own the labels, icons and handlers.
import type { RunConfig, RunStatus } from '../../../core/types'
import type { RunRowState } from './views/runRows'

export type ConfigAction = 'run' | 'restart' | 'stop' | 'edit' | 'duplicate' | 'delete' | 'output' | 'dismiss'

export interface ConfigActionItem {
  id: ConfigAction
  disabled?: boolean
  danger?: boolean
}

/** The right-click menu of one configuration row. A detected (seed) configuration cannot be deleted: removeItem
 *  refuses it, so the item is left out rather than offered and ignored. */
export function configActionsOf(row: RunRowState, o: { seed: boolean }): ConfigActionItem[] {
  const items: ConfigActionItem[] = []
  if (row.state === 'running' || row.state === 'stopping') items.push({ id: 'restart', disabled: row.state === 'stopping' })
  else items.push({ id: 'run' })
  if (row.state === 'running') items.push({ id: 'stop' })
  items.push({ id: 'edit' }, { id: 'duplicate' })
  if (!o.seed) items.push({ id: 'delete', danger: true })
  if (row.state !== 'idle') items.push({ id: 'output' })
  if (row.state === 'exited') items.push({ id: 'dismiss' })
  return items
}

export type ToolbarAction = 'rerun' | 'stopAll' | 'edit' | 'output'

export interface ToolbarActions {
  /** The configuration of the project's newest run, when it still exists (a run outlives a deleted configuration). */
  rerunConfigId?: string
  /** Every running run of the project. */
  stopIds: string[]
  /** The selected configuration. */
  editId?: string
  /** The project's newest run. */
  outputRunId?: string
}

export function toolbarActionsOf(runs: readonly RunStatus[], configs: readonly RunConfig[], selectedId: string | null): ToolbarActions {
  const last = runs.length > 0 ? runs.reduce((a, b) => (b.startedAt >= a.startedAt ? b : a)) : undefined
  return {
    rerunConfigId: last && configs.some((c) => c.id === last.configId) ? last.configId : undefined,
    stopIds: runs.filter((r) => r.status === 'running').map((r) => r.runId),
    editId: selectedId && configs.some((c) => c.id === selectedId) ? selectedId : undefined,
    outputRunId: last?.runId
  }
}
