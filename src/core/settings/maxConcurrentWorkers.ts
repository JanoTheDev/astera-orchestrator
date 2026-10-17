// W1-B: the app-wide worker cap from app-settings.json, narrowed the same way by the app's store and the Host's read.
import { readAppSettingsObject } from './settingsObject'

/** A whole number of 1 or more, or null for no cap. Anything else the user-editable file holds reads as no cap, the
 *  default that keeps the behaviour from before the setting existed. */
export function maxConcurrentWorkersOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null
}

/** The Host's read, per call: the app is the file's only writer. A missing file is no cap. An unreadable one throws
 *  `RepairNeeded` (readAppSettingsObject). */
export async function readMaxConcurrentWorkers(filePath: string): Promise<number | null> {
  return maxConcurrentWorkersOf((await readAppSettingsObject(filePath))?.maxConcurrentWorkers)
}
