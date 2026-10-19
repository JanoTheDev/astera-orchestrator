// W9-J: remove a delivered plan's ready worktrees on delivery. On unless app-settings.json says `autoCleanWorktrees:
// false`, read the same way by the app's store and the Host (as stallWatch.ts does).
import { readAppSettingsObject } from './settingsObject'

/** Only an explicit false turns it off: the file is user-editable, and anything else reads as the default (on). */
export const autoCleanWorktreesOf = (value: unknown): boolean => value !== false

/** The Host's read, per call: the app is the file's only writer. A missing or unreadable file is the default. */
export async function readAutoCleanWorktrees(filePath: string): Promise<boolean> {
  return autoCleanWorktreesOf((await readAppSettingsObject(filePath).catch(() => null))?.autoCleanWorktrees)
}
