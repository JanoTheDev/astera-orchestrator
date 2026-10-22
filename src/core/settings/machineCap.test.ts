import { describe, expect, it } from 'vitest'
import { recommendedWorkerCap } from './machineCap'

const GB = 1024 ** 3
const cap = (gb: number, cpus: number): number => recommendedWorkerCap({ totalMemBytes: gb * GB, logicalCpus: cpus })

describe('recommendedWorkerCap', () => {
  it.each([
    [8, 4, 2],
    [16, 8, 8],
    [32, 16, 16],
    [64, 32, 32],
    [256, 128, 100],
    [2, 2, 1]
  ])('%i GB / %i cores gives %i', (gb, cpus, want) => expect(cap(gb, cpus)).toBe(want))
  it('is 1 for unusable numbers', () => expect(recommendedWorkerCap({ totalMemBytes: NaN, logicalCpus: 8 })).toBe(1))
})
