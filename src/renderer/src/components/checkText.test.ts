// The check words (plugin Phase 5c, C13): a chip's tooltip in the run's graph and a check's verdict in its completion
// block, in all four languages.
import { describe, it, expect } from 'vitest'
import { CATALOGS, LANGS } from '../../../core/i18n'
import { GLYPH, checkChoicesOf, checkTooltip, checkVerdict } from './checkText'

const t = (key: string, p?: Record<string, string | number>): string => (p ? `${key} ${JSON.stringify(p)}` : key)

describe('checkVerdict', () => {
  it('says a command check’s exit code, a plugin’s failure without one, a check that could not be made, and a skipped one', () => {
    expect(checkVerdict({ status: 'passed' }, t)).toBe('jobs.convergence.check.passed')
    expect(checkVerdict({ status: 'failed', exitCode: 2 }, t)).toBe('jobs.convergence.check.failed {"code":2}')
    expect(checkVerdict({ status: 'failed' }, t)).toBe('jobs.convergence.check.failedNoCode')
    expect(checkVerdict({ status: 'timed-out' }, t)).toBe('jobs.convergence.check.timedOut')
    expect(checkVerdict({ status: 'error' }, t)).toBe('jobs.convergence.check.error')
    expect(checkVerdict({ status: 'not-run' }, t)).toBe('jobs.convergence.check.notRun')
    expect(checkVerdict({ status: 'not-run', skipped: true }, t)).toBe('jobs.convergence.check.skipped')
  })
})

describe('checkTooltip', () => {
  it('names the check, its verdict, its time and a flip; a check that could not be made reads so, not "not run"', () => {
    expect(checkTooltip({ configId: 'plugin:d', name: 'D', status: 'error' }, 'error', t)).toBe('D — jobs.convergence.check.error')
    expect(checkTooltip({ configId: 'c', name: 'Tests', status: 'failed', exitCode: 1, durationMs: 18_000, unstable: true }, 'failed', t)).toBe(
      'Tests — jobs.convergence.check.failed {"code":1} (18.0s), jobs.convergence.check.unstable'
    )
    expect(checkTooltip({ configId: 'c', name: 'Tests', status: 'failed' }, 'retrying', t)).toBe('Tests — jobs.convergence.check.retrying')
    expect(GLYPH.error).toBe('!')
  })
})

describe('checkChoicesOf', () => {
  it('offers the run configurations, then the check plugins as Plugin: name, with a status when not running', () => {
    const configs = [{ id: 'cfg_t', name: 'npm test' }]
    const plugins = [
      { id: 'astera-debug-leftovers', name: 'Debug leftovers', status: 'running' },
      { id: 'astera-guard', name: 'Guard', status: 'stopped' }
    ]
    expect(checkChoicesOf(configs, plugins, t)).toEqual([
      { id: 'cfg_t', name: 'npm test' },
      { id: 'plugin:astera-debug-leftovers', name: 'jobs.task.checkPlugin {"name":"Debug leftovers"}' },
      { id: 'plugin:astera-guard', name: 'jobs.task.checkPluginStatus {"name":"Guard","status":"settings.plugins.status.stopped"}' }
    ])
  })

  it('plugins not read yet add nothing, so the run configurations are offered at once', () => {
    expect(checkChoicesOf([{ id: 'cfg_t', name: 'npm test' }], null, t)).toEqual([{ id: 'cfg_t', name: 'npm test' }])
  })
})

describe('the check words', () => {
  it('are in all four languages', () => {
    const keys = [
      'jobs.convergence.check.failedNoCode',
      'jobs.convergence.check.error',
      'jobs.convergence.check.skipped',
      'jobs.convergence.node.unavailable',
      'jobs.task.checkPlugin',
      'jobs.task.checkPluginStatus',
      'jobs.task.checksRuntimePlugins'
    ]
    for (const key of keys) for (const lang of LANGS) expect((CATALOGS[lang].messages as Record<string, string>)[key], `${lang} ${key}`).toBeTruthy()
  })
})
