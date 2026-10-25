import { describe, it, expect } from 'vitest'
import type { RunConfig, RunStatus } from '../../../core/types'
import type { RunRowState } from './views/runRows'
import { configActionsOf, toolbarActionsOf } from './runConfigActions'

const ids = (row: RunRowState, seed = false): string[] => configActionsOf(row, { seed }).map((i) => i.id)
const exited = (failed: boolean): RunRowState => ({ state: 'exited', run: {} as RunStatus, failed, dismissTargets: ['r'], outputRunId: 'r' })

describe('configActionsOf', () => {
  it('idle: run, edit, duplicate, delete — no output', () => {
    expect(ids({ state: 'idle' })).toEqual(['run', 'edit', 'duplicate', 'delete'])
  })
  it('running: restart and stop, output', () => {
    expect(ids({ state: 'running', live: 1, stopTargets: ['r'], outputRunId: 'r' })).toEqual(['restart', 'stop', 'edit', 'duplicate', 'delete', 'output'])
  })
  it('stopping: restart is disabled and there is nothing to stop', () => {
    const items = configActionsOf({ state: 'stopping', live: 1, stopTargets: [], outputRunId: 'r' }, { seed: false })
    expect(items.find((i) => i.id === 'restart')?.disabled).toBe(true)
    expect(items.some((i) => i.id === 'stop')).toBe(false)
  })
  it('ended or crashed: run again, show output, dismiss', () => {
    expect(ids(exited(false))).toEqual(['run', 'edit', 'duplicate', 'delete', 'output', 'dismiss'])
    expect(ids(exited(true))).toContain('dismiss')
  })
  it('a detected configuration is not deletable; delete is danger', () => {
    expect(ids({ state: 'idle' }, true)).not.toContain('delete')
    expect(configActionsOf({ state: 'idle' }, { seed: false }).find((i) => i.id === 'delete')?.danger).toBe(true)
  })
})

describe('toolbarActionsOf', () => {
  const cfgs = [{ id: 'a' }, { id: 'b' }] as RunConfig[]
  const run = (runId: string, configId: string, status: string, startedAt: number): RunStatus => ({ runId, configId, status, startedAt }) as RunStatus

  it('names the newest run, every running run and the selection', () => {
    const t = toolbarActionsOf([run('r1', 'a', 'exited', 1), run('r2', 'b', 'running', 2), run('r3', 'a', 'running', 0)], cfgs, 'a')
    expect(t).toEqual({ rerunConfigId: 'b', stopIds: ['r2', 'r3'], editId: 'a', outputRunId: 'r2' })
  })
  it('offers nothing without runs or selection, and no rerun for a deleted configuration', () => {
    expect(toolbarActionsOf([], cfgs, null)).toEqual({ rerunConfigId: undefined, stopIds: [], editId: undefined, outputRunId: undefined })
    expect(toolbarActionsOf([run('r1', 'gone', 'exited', 1)], cfgs, 'zz')).toMatchObject({ rerunConfigId: undefined, editId: undefined, outputRunId: 'r1' })
  })
})
