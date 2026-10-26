// W1-B: the app-wide worker cap from app-settings.json, narrowed the same way by the app's store and the Host's read.
import path from 'node:path'
import { readAppSettingsObject } from './settingsObject'
import { effectiveCap, readAutoLimits } from './autoLimits'
import { MAX_CONCURRENT_WORKERS } from '../orchestration/types'
import { machineSpecs } from './machineSpecs'

/** A whole number from 1 to MAX_CONCURRENT_WORKERS (W6-C: a larger one reads as that cap), or null when not set.
 *  Anything else the user-editable file holds reads as not set. */
export function maxConcurrentWorkersOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? Math.min(value, MAX_CONCURRENT_WORKERS) : null
}

/** The Host's read, per call: the app is the file's only writer. Not set (or a missing file) is what this machine
 *  can handle (`machineSpecs().recommended`), not MAX_CONCURRENT_WORKERS. An unreadable file throws `RepairNeeded`
 *  (readAppSettingsObject).
 *  An auto-limit (auto-limits.json beside it) lowers the answer, never raises it. */
export async function readMaxConcurrentWorkers(filePath: string): Promise<number> {
  const person = maxConcurrentWorkersOf((await readAppSettingsObject(filePath))?.maxConcurrentWorkers) ?? machineSpecs().recommended
  return effectiveCap(person, (await readAutoLimits(path.dirname(filePath))).workers) // T1: auto-limits only lower
}
