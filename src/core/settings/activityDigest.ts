// W3-A: how often the activity digest goes out, from app-settings.json, narrowed the same way by the app's store and
// the Host's read (as maxConcurrentWorkers.ts does).
import { readAppSettingsObject } from './settingsObject'

export const ACTIVITY_DIGEST_DEFAULT_MINUTES = 30
export const ACTIVITY_DIGEST_MAX_MINUTES = 24 * 60

/** Minutes between digests: a whole number from 0 (none) to a day. Anything else the user-editable file holds reads as
 *  the default. */
export function activityDigestMinutesOf(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= ACTIVITY_DIGEST_MAX_MINUTES
    ? value
    : ACTIVITY_DIGEST_DEFAULT_MINUTES
}

/** The Host's read, per call: the app is the file's only writer. A missing or unreadable file is the default. */
export async function readActivityDigestMinutes(filePath: string): Promise<number> {
  return activityDigestMinutesOf((await readAppSettingsObject(filePath).catch(() => null))?.activityDigestMinutes)
}
