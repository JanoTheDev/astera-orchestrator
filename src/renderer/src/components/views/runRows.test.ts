import { describe, it, expect } from 'vitest'
import type { RunConfig, RunStatus } from '../../../../core/types'
import { runRowState, runRowText } from './runRows'

const cfg = (id: string, over: Record<string, unknown> = {}): RunConfig => ({ id, name: id, type: 'shell', command: 'x', ...over }) as unknown as RunConfig
const run = (runId: string, configId: string, status: RunStatus['status'], over: Record<string, unknown> = {}): RunStatus =>
  ({ runId, configId, status, startedAt: 0, ...over }) as RunStatus
const t = (k: string): string => (k === 'run.state.running' ? 'running' : 'stopping')

describe('runRowState', () => {
  const configs = [cfg('a'), cfg('b'), cfg('all', { type: 'compound', members: ['a', 'b'] })]

  it('is idle without any run', () => {
    expect(runRowState([run('r3', 'b', 'running')], configs, 'a')).toEqual({ state: 'idle' })
  })

  it('shows an exited run with its exit code, not idle', () => {
    const r = run('r1', 'a', 'exited', { exitCode: 0 })
    expect(runRowState([r], configs, 'a')).toEqual({ state: 'exited', run: r, failed: false, dismissTargets: ['r1'], outputRunId: 'r1' })
  })

  it('marks a crashed run failed and takes the newest of several ended runs', () => {
    const old = run('r1', 'a', 'exited', { exitCode: 0, startedAt: 1 })
    const crashed = run('r2', 'a', 'exited', { exitCode: 1, startedAt: 2 })
    expect(runRowState([old, crashed], configs, 'a')).toEqual({ state: 'exited', run: crashed, failed: true, dismissTargets: ['r1', 'r2'], outputRunId: 'r2' })
  })

  it('a live run hides the ended ones', () => {
    const s = runRowState([run('r1', 'a', 'exited', { exitCode: 1 }), run('r2', 'a', 'running', { startedAt: 5 })], configs, 'a')
    expect(s).toMatchObject({ state: 'running', outputRunId: 'r2' })
  })

  it('counts running instances and names the ones ⏹ stops', () => {
    const s = runRowState([run('r1', 'a', 'running'), run('r2', 'a', 'running', { startedAt: 1 }), run('r3', 'b', 'running')], configs, 'a')
    expect(s).toEqual({ state: 'running', live: 2, stopTargets: ['r1', 'r2'], outputRunId: 'r2' })
  })

  it('reads a compound through its members', () => {
    expect(runRowState([run('r3', 'b', 'running')], configs, 'all')).toMatchObject({ state: 'running', live: 1 })
  })

  it('says stopping when nothing is left to stop', () => {
    expect(runRowState([run('r1', 'a', 'stopping')], configs, 'a')).toEqual({ state: 'stopping', live: 1, stopTargets: [], outputRunId: 'r1' })
  })
})

describe('runRowText', () => {
  it('is empty when idle', () => expect(runRowText({ state: 'idle' }, t)).toBe(''))
  it('is empty when ended (the exit wording speaks there)', () => {
    const r = run('r1', 'a', 'exited', { exitCode: 1 })
    expect(runRowText({ state: 'exited', run: r, failed: true, dismissTargets: ['r1'], outputRunId: 'r1' }, t)).toBe('')
  })
  it('adds a count for several instances', () => {
    expect(runRowText({ state: 'running', live: 2, stopTargets: [], outputRunId: 'r' }, t)).toBe('running ×2')
    expect(runRowText({ state: 'stopping', live: 1, stopTargets: [], outputRunId: 'r' }, t)).toBe('stopping')
  })
})
