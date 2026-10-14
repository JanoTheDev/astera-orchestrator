// The check runner's plugin kind (plugin Phase 5 C8, C9): a `plugin:` entry is asked of the plugin instead of started in
// a terminal, in order with the run configurations, stopping at the first failure; an `error` is asked once more, and a
// second one settles the round with it (the verdict, not the runner, turns it into a question).
import { describe, it, expect, vi } from 'vitest'
import { TaskValidator, type ValidatorPluginRunner, type ValidatorRunner } from './validator'
import { absPath } from '../../testPaths'
import type { CheckResult } from '../types'
import type { PluginCheckAnswer } from '../pluginChecks'

type Settled = { taskId: string; results: CheckResult[] }

/** Command checks: records starts; the test ends each with onRunExit. */
const fakeRunner = (): ValidatorRunner & { started: { configId: string; runId: string }[] } => {
  const started: { configId: string; runId: string }[] = []
  return {
    started,
    start: async (a) => {
      const runId = `run_${started.length + 1}`
      started.push({ configId: a.configId, runId })
      return { runId, name: a.configId.toUpperCase() }
    },
    output: () => 'out',
    stop: () => {}
  }
}

/** Plugin checks: each configId answers from its own queue of answers (the last one repeats). */
const fakePlugins = (answers: Record<string, Array<Omit<PluginCheckAnswer, 'name'> | 'skip' | Error>>): ValidatorPluginRunner & { asked: string[] } => {
  const asked: string[] = []
  return {
    asked,
    run: async ({ configId }) => {
      const queue = answers[configId] ?? []
      const n = asked.filter((x) => x === configId).length
      asked.push(configId)
      const a = queue[Math.min(n, queue.length - 1)]
      if (a instanceof Error) throw a
      if (a === 'skip') return 'skip'
      return { name: configId.toUpperCase(), ...a }
    }
  }
}

const make = (plugins: ValidatorPluginRunner | undefined, runner: ValidatorRunner = fakeRunner()) => {
  const settled: Settled[] = []
  const cannot: { taskId: string; reason: string }[] = []
  const v = new TaskValidator({
    runner,
    ...(plugins ? { plugins } : {}),
    onSettled: async (a) => void settled.push(a),
    onCannotRun: async (a) => void cannot.push(a)
  })
  return { v, settled, cannot }
}

const strip = (r: CheckResult): Partial<CheckResult> => {
  const { startedAt: _s, endedAt: _e, ...rest } = r
  return rest
}

describe('a plugin check in the check runner', () => {
  it('asks the plugin and records its answer', async () => {
    const plugins = fakePlugins({ 'plugin:a': [{ status: 'passed', summary: 'ok' }] })
    const { v, settled } = make(plugins)
    v.enqueue({ taskId: 't1', cwd: absPath('w1'), configIds: ['plugin:a'] })
    await vi.waitFor(() => expect(settled).toHaveLength(1))
    expect(settled[0].results.map(strip)).toEqual([{ configId: 'plugin:a', name: 'PLUGIN:A', status: 'passed', summary: 'ok' }])
    expect(settled[0].results[0].startedAt).toBeDefined()
    expect(settled[0].results[0].endedAt).toBeDefined()
  })

  it('runs in order with the run configurations and stops at a plugin’s failure', async () => {
    const runner = fakeRunner()
    const plugins = fakePlugins({ 'plugin:a': [{ status: 'failed', summary: '1 leftover', diagnostics: [{ file: 'a.ts', line: 3, message: 'adds console.log' }] }] })
    const { v, settled } = make(plugins, runner)
    v.enqueue({ taskId: 't1', cwd: absPath('w1'), configIds: ['npm-test', 'plugin:a', 'lint'] })
    await vi.waitFor(() => expect(runner.started).toHaveLength(1))
    v.onRunExit({ runId: 'run_1', exitCode: 0 })
    await vi.waitFor(() => expect(settled).toHaveLength(1))
    expect(settled[0].results.map(strip)).toEqual([
      { configId: 'npm-test', name: 'NPM-TEST', status: 'passed', exitCode: 0, outputTail: 'out' },
      { configId: 'plugin:a', name: 'PLUGIN:A', status: 'failed', summary: '1 leftover', diagnostics: [{ file: 'a.ts', line: 3, message: 'adds console.log' }] },
      { configId: 'lint', name: 'lint', status: 'not-run' }
    ])
    expect(runner.started).toHaveLength(1)
  })

  it('goes on to the next check after a plugin’s pass', async () => {
    const runner = fakeRunner()
    const plugins = fakePlugins({ 'plugin:a': [{ status: 'passed', summary: 'ok' }] })
    const { v, settled } = make(plugins, runner)
    v.enqueue({ taskId: 't1', cwd: absPath('w1'), configIds: ['plugin:a', 'lint'] })
    await vi.waitFor(() => expect(runner.started).toHaveLength(1))
    expect(runner.started[0].configId).toBe('lint')
    v.onRunExit({ runId: 'run_1', exitCode: 0 })
    await vi.waitFor(() => expect(settled).toHaveLength(1))
    expect(settled[0].results.map((r) => r.status)).toEqual(['passed', 'passed'])
  })

  it('asks an error once more, and records the answer that follows', async () => {
    const plugins = fakePlugins({ 'plugin:a': [{ status: 'error', summary: 'down' }, { status: 'passed', summary: 'ok' }] })
    const { v, settled, cannot } = make(plugins)
    v.enqueue({ taskId: 't1', cwd: absPath('w1'), configIds: ['plugin:a'] })
    await vi.waitFor(() => expect(settled).toHaveLength(1))
    expect(plugins.asked).toEqual(['plugin:a', 'plugin:a'])
    expect(settled[0].results.map(strip)).toEqual([{ configId: 'plugin:a', name: 'PLUGIN:A', status: 'passed', summary: 'ok' }])
    expect(cannot).toEqual([])
  })

  it('settles the round with a second error, the checks after it not run', async () => {
    const plugins = fakePlugins({ 'plugin:a': [{ status: 'error', summary: 'down' }, { status: 'error', summary: 'still down' }] })
    const { v, settled, cannot } = make(plugins)
    v.enqueue({ taskId: 't1', cwd: absPath('w1'), configIds: ['plugin:a', 'lint'] })
    await vi.waitFor(() => expect(settled).toHaveLength(1))
    expect(settled[0].results.map(strip)).toEqual([
      { configId: 'plugin:a', name: 'PLUGIN:A', status: 'error', summary: 'still down' },
      { configId: 'lint', name: 'lint', status: 'not-run' }
    ])
    expect(cannot).toEqual([])
  })

  it('counts the retry per check: each of two plugins gets its own', async () => {
    const plugins = fakePlugins({
      'plugin:a': [{ status: 'error', summary: 'a down' }, { status: 'passed', summary: 'a ok' }],
      'plugin:b': [{ status: 'error', summary: 'b down' }, { status: 'passed', summary: 'b ok' }]
    })
    const { v, settled } = make(plugins)
    v.enqueue({ taskId: 't1', cwd: absPath('w1'), configIds: ['plugin:a', 'plugin:b'] })
    await vi.waitFor(() => expect(settled).toHaveLength(1))
    expect(plugins.asked).toEqual(['plugin:a', 'plugin:a', 'plugin:b', 'plugin:b'])
    expect(settled[0].results.map((r) => r.status)).toEqual(['passed', 'passed'])
  })

  it('asks a plugin named twice in one list once a round', async () => {
    const plugins = fakePlugins({ 'plugin:a': [{ status: 'passed', summary: 'ok' }] })
    const { v, settled } = make(plugins)
    v.enqueue({ taskId: 't1', cwd: absPath('w1'), configIds: ['plugin:a', 'plugin:a'] })
    await vi.waitFor(() => expect(settled).toHaveLength(1))
    expect(plugins.asked).toEqual(['plugin:a'])
    expect(settled[0].results).toHaveLength(1)
  })

  it('leaves quietly when the Task no longer needs its checks, and the folder’s queue moves on', async () => {
    const plugins = fakePlugins({ 'plugin:a': ['skip'], 'plugin:b': [{ status: 'passed', summary: 'ok' }] })
    const { v, settled, cannot } = make(plugins)
    v.enqueue({ taskId: 't1', cwd: absPath('w1'), configIds: ['plugin:a'] })
    v.enqueue({ taskId: 't2', cwd: absPath('w1'), configIds: ['plugin:b'] })
    await vi.waitFor(() => expect(settled).toHaveLength(1))
    expect(settled[0].taskId).toBe('t2')
    expect(cannot).toEqual([])
    expect(v.holds('t1')).toBe(false)
  })

  it('puts a check it could not ask to a person, as a run it could not start, and moves on', async () => {
    const plugins = fakePlugins({ 'plugin:a': [new Error('the path is not allowed')], 'plugin:b': [{ status: 'passed', summary: 'ok' }] })
    const { v, settled, cannot } = make(plugins)
    v.enqueue({ taskId: 't1', cwd: absPath('w1'), configIds: ['plugin:a'] })
    v.enqueue({ taskId: 't2', cwd: absPath('w1'), configIds: ['plugin:b'] })
    await vi.waitFor(() => expect(settled).toHaveLength(1))
    expect(cannot).toEqual([{ taskId: 't1', reason: 'Error: the path is not allowed' }])
    expect(settled[0].taskId).toBe('t2')
  })

  it('answers error, twice, where no plugin runner is wired', async () => {
    const { v, settled } = make(undefined)
    v.enqueue({ taskId: 't1', cwd: absPath('w1'), configIds: ['plugin:a'] })
    await vi.waitFor(() => expect(settled).toHaveLength(1))
    expect(settled[0].results.map(strip)).toEqual([{ configId: 'plugin:a', name: 'plugin:a', status: 'error', summary: 'plugin checks cannot run here' }])
  })

  it('carries the results a person let the round go on with in front of the checks it runs', async () => {
    const plugins = fakePlugins({ 'plugin:c': [{ status: 'passed', summary: 'ok' }] })
    const { v, settled } = make(plugins)
    const done: CheckResult[] = [
      { configId: 'npm-test', name: 'Tests', status: 'passed' },
      { configId: 'plugin:b', name: 'B', status: 'not-run', skipped: true, summary: 'Skipped by a person: down' }
    ]
    v.enqueue({ taskId: 't1', cwd: absPath('w1'), configIds: ['plugin:c'], done })
    await vi.waitFor(() => expect(settled).toHaveLength(1))
    expect(settled[0].results.map((r) => r.configId)).toEqual(['npm-test', 'plugin:b', 'plugin:c'])
  })

  it('settles at once a carried round with nothing left to run', async () => {
    const { v, settled, cannot } = make(fakePlugins({}))
    const done: CheckResult[] = [{ configId: 'plugin:b', name: 'B', status: 'not-run', skipped: true, summary: 'Skipped by a person: down' }]
    v.enqueue({ taskId: 't1', cwd: absPath('w1'), configIds: [], done })
    await vi.waitFor(() => expect(settled).toHaveLength(1))
    expect(settled[0].results).toEqual(done)
    expect(cannot).toEqual([])
  })

  it('holds the Task while its plugin is asked, and only its own folder', async () => {
    let answer: (a: PluginCheckAnswer) => void = () => {}
    const plugins: ValidatorPluginRunner = { run: () => new Promise((r) => (answer = r)) }
    const runner = fakeRunner()
    const { v, settled } = make(plugins, runner)
    v.enqueue({ taskId: 't1', cwd: absPath('w1'), configIds: ['plugin:a'] })
    v.enqueue({ taskId: 't2', cwd: absPath('w2'), configIds: ['lint'] })
    await vi.waitFor(() => expect(runner.started).toHaveLength(1))
    expect(v.holds('t1')).toBe(true)
    answer({ name: 'A', status: 'passed', summary: 'ok' })
    await vi.waitFor(() => expect(settled).toHaveLength(1))
    expect(v.holds('t1')).toBe(false)
  })
})
