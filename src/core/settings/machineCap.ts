import { MAX_CONCURRENT_WORKERS } from '../orchestration/types'

const GB = 1024 ** 3
/** Memory kept for the OS and the app itself. */
export const RESERVED_MEMORY_GB = 4
/** What one agent session costs with its build and test tools running. */
export const MEMORY_PER_WORKER_GB = 1.5

/** Workers this machine can run at once: one per logical CPU, as many as fit in memory after the reserve,
 *  never below 1 nor above MAX_CONCURRENT_WORKERS. Pure and node-free. */
export function recommendedWorkerCap(specs: { totalMemBytes: number; logicalCpus: number }): number {
  const byMemory = Math.floor((specs.totalMemBytes / GB - RESERVED_MEMORY_GB) / MEMORY_PER_WORKER_GB)
  const n = Math.min(specs.logicalCpus, byMemory)
  return Number.isFinite(n) ? Math.max(1, Math.min(MAX_CONCURRENT_WORKERS, n)) : 1
}
