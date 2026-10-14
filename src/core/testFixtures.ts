// Removing a test's fixture folder (load-sensitive tests, 2026-10-14). For tests only.
//
// On Windows a process the test started, or the indexer, can hold a handle on a fixture a moment after the test ends,
// and an `rm` with five 20 ms retries failed with EBUSY, ENOTEMPTY or EPERM after the test itself had passed: the run
// went red over cleanup. These retry for about a second, then leave a still-held `astera-` fixture to the sweeper
// (vitest.globalSetup.ts removes stale `astera-*` folders at the start of the next run). Any other error, or a folder the
// sweeper would not take, still fails the test.
import { promises as fs, rmSync } from 'node:fs'
import path from 'node:path'

const OPTIONS = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 } as const
const HELD: ReadonlySet<unknown> = new Set(['EBUSY', 'ENOTEMPTY', 'EPERM'])
const SWEPT = 'astera-'

const tolerated = (dir: string, err: unknown): boolean =>
  HELD.has((err as { code?: unknown } | null)?.code) && path.basename(path.resolve(dir)).startsWith(SWEPT)

export async function removeFixture(
  dir: string,
  rm: (p: string, o: typeof OPTIONS) => Promise<void> = (p, o) => fs.rm(p, o)
): Promise<void> {
  try {
    await rm(dir, OPTIONS)
  } catch (err) {
    if (!tolerated(dir, err)) throw err
  }
}

export function removeFixtureSync(dir: string): void {
  try {
    rmSync(dir, OPTIONS)
  } catch (err) {
    if (!tolerated(dir, err)) throw err
  }
}
