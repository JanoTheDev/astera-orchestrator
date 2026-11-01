import { MAX_CONCURRENT_WORKERS } from '../orchestration/types'

// Measured numbers, copied from knowledge/history/2026-10-31-memory-at-25-agents.md ("Numbers to use").
/** One agent session: Claude 0.66 GB + MCP children 0.10 GB + shims. Idle and thinking are not distinguishable. */
export const MEMORY_PER_AGENT_GB = 0.8
/** The largest observed install/typecheck/test peak (a turbo typecheck of another repository, 7.9 GB). This repository's
 *  own heavy jobs are 0.7-1.5 GB, so auto heavy slots stay at 1-2 on a 31 GB machine. */
export const MEMORY_PER_HEAVY_JOB_GB = 8
/** OS, WSL, Defender, Docker, Discord, the Astera app and Host. Browsers and dev servers that agents leave behind
 *  (about 0.5 GB per agent) are not in it. */
export const RESERVED_MEMORY_GB = 9
/** Commit headroom (%) below which the machine is within seconds of stalling: every sample under 1 GB available had
 *  under 6.5 % headroom. */
export const COMMIT_HEADROOM_PCT = 10

const GB = 1024 ** 3

/** Agents this machine can run at once, from memory alone (agents mostly wait on the network, so the CPU count is no
 *  cap): what is left after the reserve and one heavy job, per agent. Never below 1 nor above MAX_CONCURRENT_WORKERS.
 *  Pure and node-free. `logicalCpus` stays in the specs but does not enter the answer. */
export function recommendedWorkerCap(specs: { totalMemBytes: number; logicalCpus: number }): number {
  // the epsilon keeps a figure that is exactly a whole number (14.4 / 0.8) from rounding down to the one below
  const n = Math.floor((specs.totalMemBytes / GB - RESERVED_MEMORY_GB - MEMORY_PER_HEAVY_JOB_GB) / MEMORY_PER_AGENT_GB + 1e-9)
  return Number.isFinite(n) ? Math.max(1, Math.min(MAX_CONCURRENT_WORKERS, n)) : 1
}
