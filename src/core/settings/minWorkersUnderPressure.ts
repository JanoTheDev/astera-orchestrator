// The floor the load monitor (host/loadMonitor.ts) never lowers the agent cap below while the machine is strained.
// app-settings.json key `minWorkersUnderPressure`. Node-free: the Settings screen shows the same floor.
import { MAX_CONCURRENT_WORKERS } from '../orchestration/types'

/** A whole number >= 1 (a larger one than MAX_CONCURRENT_WORKERS reads as that cap), or null when not set.
 *  Anything else the user-editable file holds reads as not set. */
export function minWorkersUnderPressureOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? Math.min(value, MAX_CONCURRENT_WORKERS) : null
}

/** The floor in force: the setting, or half the person's own agent limit (rounded up) when it is not set; never
 *  above the person's limit and never below 1. */
export function minWorkersFloor(personWorkers: number, setting: number | null): number {
  const own = Math.max(1, Math.floor(personWorkers))
  return Math.max(1, Math.min(own, setting ?? Math.ceil(own / 2)))
}
