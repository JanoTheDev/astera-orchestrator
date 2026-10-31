// T6: IPC for Settings › Agents, the lowered limits Astera set itself (core/settings/autoLimits.ts). Registered from
// index.ts beside the account-max-sessions handlers.
import type { IpcMain } from 'electron'
import { readAutoLimits, resetAutoLimit, resetAutoLimits, updateAutoLimits } from '../core/settings/autoLimits'
import type { AgentLimits } from '../core/types'

const WHATS = ['workers', 'heavy', 'checks'] as const

/** The value arrives from the renderer, so it is checked here. */
export function limitKindOf(v: unknown): (typeof WHATS)[number] | null {
  return WHATS.find((w) => w === v) ?? null
}

export function registerAutoLimitsIpc(ipcMain: IpcMain, deps: {
    profileDir: string
    agentLimits: () => AgentLimits
    getMinWorkers: () => number | null
    setMinWorkers: (n: number | null) => Promise<void>
  }): void {
  ipcMain.handle('settings.getAutoLimits', () => readAutoLimits(deps.profileDir))
  ipcMain.handle('settings.getMinWorkersUnderPressure', () => deps.getMinWorkers())
  ipcMain.handle('settings.setMinWorkersUnderPressure', (_e, n: unknown) => deps.setMinWorkers(typeof n === 'number' ? n : null))
  ipcMain.handle('settings.agentLimits', () => deps.agentLimits())
  ipcMain.handle('settings.restoreAutoLimit', async (_e, what: unknown) => {
    const kind = limitKindOf(what)
    if (!kind) throw new Error(`Unknown limit: ${String(what)}`)
    await updateAutoLimits(deps.profileDir, (cur) => resetAutoLimit(cur, kind, new Date().toISOString()))
  })
  ipcMain.handle('settings.restoreAutoLimits', async () => {
    await updateAutoLimits(deps.profileDir, (cur) => resetAutoLimits(cur, new Date().toISOString()))
  })
}
