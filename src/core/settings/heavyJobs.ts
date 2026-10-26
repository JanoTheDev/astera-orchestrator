// Heavy-job slots: how many heavy jobs (full suite, Electron, dist build, a Task's heavy check) the machine runs at
// once (core/orchestration/heavyLock.ts). 1 keeps a small laptop safe; a bigger machine can take more.
import path from 'node:path'
import { readAppSettingsObject } from './settingsObject'
import { effectiveCap, readAutoLimits } from './autoLimits'

export const HEAVY_JOBS_DEFAULT = 1
export const HEAVY_JOBS_MAX = 8

/** A whole number >= 1 (a larger one than HEAVY_JOBS_MAX reads as that cap), or null when not set or invalid. */
export function heavyJobsAtOnceOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? Math.min(value, HEAVY_JOBS_MAX) : null
}

/** A non-app process's read (CLI, Host, source updater), per call. Never throws: a missing, invalid or unreadable
 *  file is HEAVY_JOBS_DEFAULT, the safe answer for a heavy job. */
export async function readHeavyJobsAtOnce(filePath: string): Promise<number> {
  try {
    const person = heavyJobsAtOnceOf((await readAppSettingsObject(filePath))?.heavyJobsAtOnce) ?? HEAVY_JOBS_DEFAULT
    return effectiveCap(person, (await readAutoLimits(path.dirname(filePath))).heavy) // T1: auto-limits only lower
  } catch {
    return HEAVY_JOBS_DEFAULT
  }
}
