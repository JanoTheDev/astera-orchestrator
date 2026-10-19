// W9-I: console summaries on/off (DESIGN §4), from app-settings.json, narrowed the same way by the app's store and the
// Host's read (as activityDigest.ts does).
import { readAppSettingsObject } from './settingsObject'

/** On by default; only an explicit false (the file is user-editable) turns it off. */
export function tabSummariesOf(value: unknown): boolean {
  return value !== false
}

/** The Host's read, per call: the app is the file's only writer. A missing or unreadable file is on. */
export async function readTabSummaries(filePath: string): Promise<boolean> {
  return tabSummariesOf((await readAppSettingsObject(filePath).catch(() => null))?.tabSummaries)
}
