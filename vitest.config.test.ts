// The suite's own budgets (load-sensitive tests, 2026-10-14). Under load the tests that spawn git, node or PowerShell
// overran 10 s, and vitest's default of one worker per core but one oversubscribed the machine those processes need.
import { describe, it, expect } from 'vitest'
import config from './vitest.config'

describe('vitest.config', () => {
  it('gives a test 30 s and a hook 60 s', () => {
    expect(config.test?.testTimeout).toBe(30_000)
    expect(config.test?.hookTimeout).toBe(60_000)
  })

  it('runs half as many workers as there are cores', () => {
    expect(config.test?.maxWorkers).toBe('50%')
  })

  it('runs this file', () => {
    expect(config.test?.include).toContain('vitest.config.test.ts')
  })
})
