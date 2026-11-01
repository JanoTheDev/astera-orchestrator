import { describe, expect, it } from 'vitest'
import { MEMORY_PER_AGENT_GB, MEMORY_PER_HEAVY_JOB_GB, RESERVED_MEMORY_GB, recommendedWorkerCap } from './machineCap'

const GB = 1024 ** 3
const cap = (gb: number, cpus: number): number => recommendedWorkerCap({ totalMemBytes: gb * GB, logicalCpus: cpus })

describe('recommendedWorkerCap', () => {
  it('uses the measured numbers from knowledge/history/2026-10-31-memory-at-25-agents.md', () => {
    expect([MEMORY_PER_AGENT_GB, MEMORY_PER_HEAVY_JOB_GB, RESERVED_MEMORY_GB]).toEqual([0.8, 8, 9])
  })
  it.each([
    [31.4, 24, 18],
    [31.4, 4, 18], // no CPU cap: agents wait on the network
    [8, 4, 1], // never below 1
    [2, 2, 1],
    [16, 8, 1],
    [64, 32, 58],
    [256, 128, 100]
  ])('%d GB / %i cores gives %i', (gb, cpus, want) => expect(cap(gb, cpus)).toBe(want))
  it('is 1 for unusable numbers', () => expect(recommendedWorkerCap({ totalMemBytes: NaN, logicalCpus: 8 })).toBe(1))
})
