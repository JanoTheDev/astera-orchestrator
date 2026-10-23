import { describe, it, expect } from 'vitest'
import type { RunConfig, RunStatus } from '../../../../core/types'
import { runRowState, runRowText } from './runRows'

const cfg = (id: string, over: Record<string, unknown> = {}): RunConfig => ({ id, name: id, type: 'shell', command: 'x', ...over }) as unknown as RunConfig
const run = (runId: string, configId: string, status: RunStatus['status']): RunStatus => ({ runId, configId, status }) as RunStatus
const t = (k: string): string => (k === 'run.state.running' ? 'running' : 'stopping')

describe('runRowState', () => {
  const configs = [cfg('a'), cfg('b'), cfg('all', { type: 'compound', members: ['a', 'b'] })]

  it('is idle without live runs, finished ones included', () => {
    expect(runRowState([run('r1', 'a', 'exited')], configs, 'a')).toEqual({ state: 'idle' })
  })

  it('counts running instances and names the ones ⏹ stops', () => {
    const s = runRowState([run('r1', 'a', 'running'), run('r2', 'a', 'running'), run('r3', 'b', 'running')], configs, 'a')
    expect(s).toEqual({ state: 'running', live: 2, stopTargets: ['r1', 'r2'] })
  })

  it('reads a compound through its members', () => {
    expect(runRowState([run('r3', 'b', 'running')], configs, 'all')).toMatchObject({ state: 'running', live: 1 })
  })

  it('says stopping when nothing is left to stop', () => {
    expect(runRowState([run('r1', 'a', 'stopping')], configs, 'a')).toEqual({ state: 'stopping', live: 1, stopTargets: [] })
  })
})

describe('runRowText', () => {
  it('is empty when idle', () => expect(runRowText({ state: 'idle' }, t)).toBe(''))
  it('adds a count for several instances', () => {
    expect(runRowText({ state: 'running', live: 2, stopTargets: [] }, t)).toBe('running ×2')
    expect(runRowText({ state: 'stopping', live: 1, stopTargets: [] }, t)).toBe('stopping')
  })
})
