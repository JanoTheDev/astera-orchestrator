// How many workers the suite runs (load-sensitive tests, 2026-10-14). On this 20-core machine vitest's default, one
// per core but one, oversubscribed the tests that spawn git, node and PowerShell; half as many kept the suite's time
// within the shared machine's noise (157 s once at 10, 187-197 s after the other fixes, 145-185 s at 19 before). A 2-4
// core runner keeps the default (1, 2, 3): its Windows job is every PR's critical path (485 s at 3 workers), and it
// was not where the oversubscription was.

/** Workers for a machine with `cores` cores: vitest's own `cores - 1` up to 3, half the cores above that. */
export function workersFor(cores: number): number {
  return Math.max(1, Math.min(cores - 1, 3), Math.round(cores / 2))
}
