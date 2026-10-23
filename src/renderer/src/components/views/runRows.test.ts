import { describe, expect, it } from 'vitest'
import type { RunConfig, RunStatus } from '../../../../core/types'
import { runRows, runStateText } from './runRows'

const config = (id: string): RunConfig => ({ id, name: id, type: 'shell', command: 'echo' }) as RunConfig
const run = (runId: string, configId: string, status: RunStatus['status'], startedAt = 1): RunStatus =>
  ({ runId, configId, status, startedAt, projectPath: '/p', projectName: 'p', configName: configId, command: '', seq: 1 }) as RunStatus

describe('runRows', () => {
  it('offers a running run to Stop', () => {
    const [row] = runRows([config('a')], [run('r1', 'a', 'running')])
    expect(row.stopTargets).toEqual(['r1'])
  })

  it('keeps the list order and marks only configurations with a live run', () => {
    const rows = runRows([config('a'), config('b')], [run('r1', 'b', 'running'), run('r0', 'a', 'exited')])
    expect(rows.map((r) => [r.config.id, r.running])).toEqual([['a', 0], ['b', 1]])
  })

  it('counts a stopping run as live but has nothing left to Stop', () => {
    const [row] = runRows([config('a')], [run('r1', 'a', 'stopping')])
    expect(row.running).toBe(1)
    expect(row.stopTargets).toEqual([])
  })
})

describe('runStateText', () => {
  const t = (key: string, p?: { count: number }): string => (p ? `${key}:${p.count}` : key)
  it('says "running" for one instance and the count for several', () => {
    expect(runStateText(1, t)).toBe('run.view.running')
    expect(runStateText(3, t)).toBe('run.menu.running:3')
  })
})
