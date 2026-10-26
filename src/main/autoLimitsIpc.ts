// T6: IPC for Settings › Agents, the lowered limits Astera set itself (core/settings/autoLimits.ts). Registered from
// index.ts beside the account-max-sessions handlers.
import type { IpcMain } from 'electron'
import { readAutoLimits, resetAutoLimits, updateAutoLimits } from '../core/settings/autoLimits'

export function registerAutoLimitsIpc(ipcMain: IpcMain, deps: { profileDir: string }): void {
  ipcMain.handle('settings.getAutoLimits', () => readAutoLimits(deps.profileDir))
  ipcMain.handle('settings.restoreAutoLimits', async () => {
    await updateAutoLimits(deps.profileDir, (cur) => resetAutoLimits(cur, new Date().toISOString()))
  })
}
