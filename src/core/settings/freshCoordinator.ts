// Coordinator rotation: the context use (%) at which a plan's coordinator is replaced by a fresh session, from
// app-settings.json, narrowed the same way by the app's store and the Host's read (as activityDigest.ts does).
import { readAppSettingsObject } from './settingsObject'

export const FRESH_COORDINATOR_DEFAULT_PCT = 70

/** Percent of the context window: a whole number from 0 (check off) to 100. Anything else the user-editable file holds
 *  reads as the default. */
export function freshCoordinatorPctOf(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100
    ? value
    : FRESH_COORDINATOR_DEFAULT_PCT
}

/** The Host's read, per call: the app is the file's only writer. A missing or unreadable file is the default. */
export async function readFreshCoordinatorPct(filePath: string): Promise<number> {
  return freshCoordinatorPctOf((await readAppSettingsObject(filePath).catch(() => null))?.freshCoordinatorContextPct)
}
