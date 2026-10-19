// Stall watchdog (orchestration/exec/stallWatch.ts): on unless app-settings.json says `stallWatch: false`, read the
// same way by the app's store and the Host (as freshCoordinator.ts does).
import { readAppSettingsObject } from './settingsObject'

/** Only an explicit false turns it off: the file is user-editable, and anything else reads as the default (on). */
export const stallWatchOnOf = (value: unknown): boolean => value !== false

/** The Host's read, per call: the app is the file's only writer. A missing or unreadable file is the default. */
export async function readStallWatchOn(filePath: string): Promise<boolean> {
  return stallWatchOnOf((await readAppSettingsObject(filePath).catch(() => null))?.stallWatch)
}
