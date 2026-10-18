// W1-B: the app-wide worker cap from app-settings.json, narrowed the same way by the app's store and the Host's read.
import { readAppSettingsObject } from './settingsObject'
import { MAX_CONCURRENT_WORKERS } from '../orchestration/types'

/** A whole number from 1 to MAX_CONCURRENT_WORKERS (W6-C: a larger one reads as that cap), or null when not set.
 *  Anything else the user-editable file holds reads as not set. The scheduler reads not set as MAX_CONCURRENT_WORKERS
 *  (`workerCapOf`, schedule.ts). */
export function maxConcurrentWorkersOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? Math.min(value, MAX_CONCURRENT_WORKERS) : null
}

/** The Host's read, per call: the app is the file's only writer. A missing file is not set. An unreadable one throws
 *  `RepairNeeded` (readAppSettingsObject). */
export async function readMaxConcurrentWorkers(filePath: string): Promise<number | null> {
  return maxConcurrentWorkersOf((await readAppSettingsObject(filePath))?.maxConcurrentWorkers)
}
