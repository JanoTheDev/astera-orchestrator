// T28: "Restart the Host when idle" (on by default). On, an outdated Host holds new starts, lets the working agents
// finish their turn and restarts on the new build with a handover (core/host/hostUpdateState.ts); off, it is replaced
// only once nothing works (main/ipc.ts hostReplaceDue). Its own small file in the profile: only the app reads it.
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

export const HOST_RESTART_WHEN_IDLE_FILE = 'host-restart-when-idle.json'

/** On by default; only an explicit false (the file is user-editable) turns it off. */
export function hostRestartWhenIdleOf(value: unknown): boolean {
  return value !== false
}

/** A missing or damaged file is on. Sync: read once when the app wires the Host. */
export function readHostRestartWhenIdle(profileDir: string): boolean {
  try {
    return hostRestartWhenIdleOf((JSON.parse(readFileSync(path.join(profileDir, HOST_RESTART_WHEN_IDLE_FILE), 'utf8')) as { hostRestartWhenIdle?: unknown } | null)?.hostRestartWhenIdle)
  } catch {
    return true
  }
}

export async function writeHostRestartWhenIdle(profileDir: string, on: boolean): Promise<void> {
  await writeFile(path.join(profileDir, HOST_RESTART_WHEN_IDLE_FILE), JSON.stringify({ hostRestartWhenIdle: on }) + '\n', 'utf8')
}
