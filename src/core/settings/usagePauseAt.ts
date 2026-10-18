// W6-G: the usage guard's threshold from app-settings.json, as the Host reads it (the app's store narrows the same way).
import { usagePauseAtOf, USAGE_PAUSE_AT_DEFAULT } from '../orchestration/usageGuard'
import { readAppSettingsObject } from './settingsObject'

/** Per call (the app is the file's only writer). A missing or unreadable file is the default: the guard keeps guarding. */
export async function readUsagePauseAt(filePath: string): Promise<number> {
  try {
    return usagePauseAtOf((await readAppSettingsObject(filePath))?.usagePauseAt)
  } catch {
    return USAGE_PAUSE_AT_DEFAULT
  }
}
