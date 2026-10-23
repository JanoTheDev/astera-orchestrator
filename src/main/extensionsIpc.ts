// IPC for the MCP & skills finder (main/extensions.ts), the `extensions.*` channels behind
// window.api.extensions. Registered from index.ts right after registerIpc.

import type { IpcMain } from 'electron'
import { makeExtensions, runClientCli } from './extensions'
import { DEFAULT_SKILL_REPO, isRepo } from '../core/extensions/skillsCatalog'
import type { ProviderDescriptor } from '../core/providers/descriptor'
import type { Provider } from '../core/providers/meta'
import type { Account, ExtensionError, SkillRepos } from '../core/types'

export interface ExtensionsIpcDeps {
  accounts(): Account[]
  descriptors: Record<Provider, ProviderDescriptor>
  homeDir: string
  settings: { getSkillRepos(): string[]; setSkillRepos(repos: string[]): Promise<void> }
}

export function registerExtensionsIpc(ipcMain: IpcMain, deps: ExtensionsIpcDeps): void {
  const ext = makeExtensions({
    accounts: deps.accounts,
    descriptors: deps.descriptors,
    homeDir: deps.homeDir,
    platform: process.platform,
    env: process.env,
    fetch: globalThis.fetch,
    run: runClientCli,
    skillRepos: () => deps.settings.getSkillRepos()
  })
  const repos = (): SkillRepos => ({ default: DEFAULT_SKILL_REPO, added: deps.settings.getSkillRepos() })

  ipcMain.handle('extensions.mcpSearch', (_e, query: unknown, cursor: unknown) => ext.mcpSearch(query, cursor))
  ipcMain.handle('extensions.mcpInstalled', () => ext.mcpInstalled())
  ipcMain.handle('extensions.mcpInstall', (_e, req: unknown) => ext.mcpInstall(req))
  ipcMain.handle('extensions.mcpRemove', (_e, accountId: unknown, name: unknown) => ext.mcpRemove(accountId, name))
  ipcMain.handle('extensions.skillsSearch', (_e, query: unknown) => ext.skillsSearch(query))
  ipcMain.handle('extensions.skillsInstalled', () => ext.skillsInstalled())
  ipcMain.handle('extensions.skillsInstall', (_e, req: unknown) => ext.skillsInstall(req))
  ipcMain.handle('extensions.skillsRemove', (_e, accountId: unknown, name: unknown) => ext.skillsRemove(accountId, name))
  ipcMain.handle('extensions.skillReposGet', () => repos())
  ipcMain.handle('extensions.skillReposSet', async (_e, added: unknown): Promise<{ ok: true; repos: SkillRepos } | ExtensionError> => {
    if (!Array.isArray(added)) return { ok: false, error: 'invalid', message: 'a list of owner/repo' }
    const bad = added.find((r) => typeof r !== 'string' || !isRepo(r.trim()))
    if (bad !== undefined) return { ok: false, error: 'invalid', message: `${String(bad)} is not owner/repo` }
    await deps.settings.setSkillRepos(added.map((r: string) => r.trim()).filter((r) => r !== DEFAULT_SKILL_REPO))
    return { ok: true, repos: repos() }
  })
}
