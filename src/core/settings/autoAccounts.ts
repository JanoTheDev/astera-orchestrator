// T2 (automatic accounts): "Pick accounts automatically", on unless app-settings.json says `autoAccounts: false`, read
// the same way stallWatch.ts reads its switch. When on, a worker, coordinator or planner starts on the least used
// logged-in account of its provider and rolls on to the next one instead of waiting for a reset
// (accounts/autoAccountOrder.ts). The owner asked for this explicitly and for it to be on by default: that request is
// the enablement docs/dev/CONTEXT.md rule 6 requires before Astera switches accounts beyond the Task's own chain.
// Setting it to false gives back the earlier behaviour exactly (the Task's chain only).
import { readAppSettingsObject } from './settingsObject'

/** Only an explicit false turns it off: the file is user-editable, and anything else reads as the default (on). */
export const autoAccountsOnOf = (value: unknown): boolean => value !== false

/** The Host's read, per call: the app is the file's only writer. A missing or unreadable file is the default. */
export async function readAutoAccountsOn(filePath: string): Promise<boolean> {
  return autoAccountsOnOf((await readAppSettingsObject(filePath).catch(() => null))?.autoAccounts)
}
