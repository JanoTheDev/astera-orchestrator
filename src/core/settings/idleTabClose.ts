// Idle tabs (owner 2026-11-03: "I want to avoid having idle tabs, they take up memory"): the minutes an Astera-started
// worker, reviewer, merge or repair tab with nothing left to do (its Dispatch ended, superseded or unknown to the Host),
// or a planner whose plan was approved, may sit idle at its prompt before it is closed (exec/coordinatorRotate.ts).
// app-settings.json key `idleTabCloseMinutes`, read the same way by the app's store and the Host (as
// workerSilentMinutes.ts does). Hand-opened tabs and chat-mode planners are never closed by it.
import { readAppSettingsObject } from './settingsObject'

export const IDLE_TAB_CLOSE_DEFAULT_MINUTES = 1
export const IDLE_TAB_CLOSE_MIN_MINUTES = 1
export const IDLE_TAB_CLOSE_MAX_MINUTES = 60

/** A whole number of minutes within 1-60. Anything else the user-editable file holds reads as the default. */
export function idleTabCloseMinutesOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return IDLE_TAB_CLOSE_DEFAULT_MINUTES
  return Math.min(IDLE_TAB_CLOSE_MAX_MINUTES, Math.max(IDLE_TAB_CLOSE_MIN_MINUTES, Math.round(value)))
}

/** The Host's read, per call: the app is the file's only writer. A missing or unreadable file is the default. */
export async function readIdleTabCloseMinutes(filePath: string): Promise<number> {
  return idleTabCloseMinutesOf((await readAppSettingsObject(filePath).catch(() => null))?.idleTabCloseMinutes)
}
