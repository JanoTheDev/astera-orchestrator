// The suite's own budgets (load-sensitive tests, 2026-10-14). Under load the tests that spawn git, node or PowerShell
// overran 10 s, and vitest's default of one worker per core but one oversubscribed the machine those processes need.
import { describe, it, expect } from 'vitest'
import os from 'node:os'
import config from './vitest.config'
import { workersFor } from './vitest.workers'

describe('vitest.config', () => {
  it('gives a test 30 s and a hook 60 s', () => {
    expect(config.test?.testTimeout).toBe(30_000)
    expect(config.test?.hookTimeout).toBe(60_000)
  })

  it('runs the workers workersFor gives this machine', () => {
    expect(config.test?.maxWorkers).toBe(workersFor(os.availableParallelism()))
  })
})

// Final review I1: a 2-4 core runner keeps vitest's default; only a bigger machine is halved
describe('workersFor', () => {
  it('keeps cores - 1 up to 3, and halves the cores above that', () => {
    expect([1, 2, 3, 4, 6, 8, 20].map(workersFor)).toEqual([1, 1, 2, 3, 3, 4, 10])
  })
})
