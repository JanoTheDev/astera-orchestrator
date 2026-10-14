// Removing a test's fixture folder (load-sensitive tests, 2026-10-14). For tests only.
//
// On Windows a process the test started, or the indexer, can hold a handle on a fixture a moment after the test ends,
// and an `rm` with five 20 ms retries failed with EBUSY, ENOTEMPTY or EPERM after the test itself had passed: the run
// went red over cleanup. This retries through fs.promises.rm, whose retries back off linearly (100, 200, ... 1000 ms,
// about 5.5 s in all; rmSync's do not wait at all on Windows, so there is no synchronous variant), then leaves a fixture
// still held to the sweeper, and says so: vitest.globalSetup.ts removes, when a run ends, the fixtures older than
// STALE_MS. Only a folder the sweeper takes is left (its own rule, isSweptFixtureName, directly under the temp folder);
// any other error, or any other folder, still fails the test.
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isSweptFixtureName } from '../../vitest.globalSetup'

const OPTIONS = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 } as const
const HELD: ReadonlySet<unknown> = new Set(['EBUSY', 'ENOTEMPTY', 'EPERM'])

const sameFolder = (a: string, b: string): boolean =>
  process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b)

/** A held fixture the sweeper will remove. */
const leftToSweeper = (dir: string, err: unknown): boolean =>
  HELD.has((err as { code?: unknown } | null)?.code) &&
  isSweptFixtureName(path.basename(path.resolve(dir))) &&
  sameFolder(path.dirname(path.resolve(dir)), os.tmpdir())

export async function removeFixture(
  dir: string,
  rm: (p: string, o: typeof OPTIONS) => Promise<void> = (p, o) => fs.rm(p, o)
): Promise<void> {
  try {
    await rm(dir, OPTIONS)
  } catch (err) {
    if (!leftToSweeper(dir, err)) throw err
    // A held fixture can be the only sign of a process a test leaked, so it is said
    console.warn(`[fixture] still held, left for the sweeper: ${dir} (${String((err as { code?: unknown }).code)})`)
  }
}
