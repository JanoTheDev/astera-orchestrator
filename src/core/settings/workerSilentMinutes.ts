// T12 silent workers (orchestration/exec/stallWatch.ts): the minutes a dispatched worker may show no activity before it
// is nudged, and again before its last turn is read. app-settings.json key `workerSilentMinutes`, read the same way by
// the app's store and the Host (as freshCoordinator.ts does).
import { readAppSettingsObject } from './settingsObject'

export const WORKER_SILENT_DEFAULT_MINUTES = 8
export const WORKER_SILENT_MIN_MINUTES = 2
export const WORKER_SILENT_MAX_MINUTES = 60

/** A number of minutes, rounded and kept within 2-60. Anything else the user-editable file holds reads as the default. */
export function workerSilentMinutesOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return WORKER_SILENT_DEFAULT_MINUTES
  return Math.min(WORKER_SILENT_MAX_MINUTES, Math.max(WORKER_SILENT_MIN_MINUTES, Math.round(value)))
}

/** The Host's read, per call: the app is the file's only writer. A missing or unreadable file is the default. */
export async function readWorkerSilentMinutes(filePath: string): Promise<number> {
  return workerSilentMinutesOf((await readAppSettingsObject(filePath).catch(() => null))?.workerSilentMinutes)
}
