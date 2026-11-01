// T6: IPC for Settings › Agents, the lowered limits Astera set itself (core/settings/autoLimits.ts). Registered from
// index.ts beside the account-max-sessions handlers.
import type { IpcMain } from 'electron'
import { AutoLimitsReadOnlyError, readAutoLimits, resetAutoLimit, resetAutoLimits, updateAutoLimits, type AutoLimits } from '../core/settings/autoLimits'
import type { AgentLimits, RestoreAutoLimitResult } from '../core/types'

const WHATS = ['workers', 'heavy', 'checks'] as const

/** A restore on a read-only auto-limits.json answers `{ locked: true }` (the file is the owner's to unlock) instead of
 *  failing with a raw error; any other failure is thrown. */
async function restore(profileDir: string, fn: (cur: AutoLimits) => AutoLimits): Promise<RestoreAutoLimitResult> {
  try {
    await updateAutoLimits(profileDir, fn)
    return { locked: false }
  } catch (err) {
    if (err instanceof AutoLimitsReadOnlyError) return { locked: true }
    throw err
  }
}

/** The value arrives from the renderer, so it is checked here. */
export function limitKindOf(v: unknown): (typeof WHATS)[number] | null {
  return WHATS.find((w) => w === v) ?? null
}

export function registerAutoLimitsIpc(ipcMain: IpcMain, deps: {
    profileDir: string
    agentLimits: () => AgentLimits
    getMinWorkers: () => number | null
    setMinWorkers: (n: number | null) => Promise<void>
    getAutoLower: () => 'on' | 'floor' | 'off'
    setAutoLower: (mode: unknown) => Promise<void>
  }): void {
  ipcMain.handle('settings.getAutoLimits', () => readAutoLimits(deps.profileDir))
  ipcMain.handle('settings.getMinWorkersUnderPressure', () => deps.getMinWorkers())
  ipcMain.handle('settings.setMinWorkersUnderPressure', (_e, n: unknown) => deps.setMinWorkers(typeof n === 'number' ? n : null))
  ipcMain.handle('settings.getAutoLowerLimits', () => deps.getAutoLower())
  ipcMain.handle('settings.setAutoLowerLimits', (_e, mode: unknown) => deps.setAutoLower(mode))
  ipcMain.handle('settings.agentLimits', () => deps.agentLimits())
  ipcMain.handle('settings.restoreAutoLimit', async (_e, what: unknown) => {
    const kind = limitKindOf(what)
    if (!kind) throw new Error(`Unknown limit: ${String(what)}`)
    return restore(deps.profileDir, (cur) => resetAutoLimit(cur, kind, new Date().toISOString()))
  })
  ipcMain.handle('settings.restoreAutoLimits', async () => {
    return restore(deps.profileDir, (cur) => resetAutoLimits(cur, new Date().toISOString()))
  })
}
