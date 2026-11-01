// Windows window diagnostic (host/windowDiagnostic.ts): off unless app-settings.json says `windowDiagnostic: true`, read
// the same way by the app's store and the Host (as stallWatch.ts does).
import { readAppSettingsObject } from './settingsObject'

/** Only an explicit true turns it on: the file is user-editable, and anything else reads as the default (off). */
export const windowDiagnosticOf = (value: unknown): boolean => value === true

/** The Host's read, per call: the app is the file's only writer. A missing or unreadable file is the default. */
export async function readWindowDiagnosticOn(filePath: string): Promise<boolean> {
  return windowDiagnosticOf((await readAppSettingsObject(filePath).catch(() => null))?.windowDiagnostic)
}
