// The permission mode from app-settings.json, read by a process that is not the app (the Host).
import type { AgentPermissionMode } from '../types'
import { readAppSettingsObject } from './settingsObject'
import { readRoleModelSettings, type RoleModelSettings } from '../orchestration/roleModels'

/** The store's own narrowing. Fork (orchestrator W0): only the explicit 'yolo' turns the bypass on; upstream read
 *  everything but 'manual' as 'yolo'. Workers then wait at permission prompts until the person opts in. */
export function agentPermissionModeOf(value: unknown): AgentPermissionMode {
  return value === 'yolo' ? 'yolo' : 'manual'
}

/**
 * Read only; not AppSettingsStore.load, which copies a file it cannot parse to `.bak`, and the app is
 * the file's only writer.
 *
 * - **Missing file: 'manual'** in this fork (upstream D12 chose 'yolo' so a headless worker does not stop at its
 *   first command; this fork never turns the bypass on by default, SECURITY-AUDIT.md item 2).
 * - **A valid file** narrows the field the way `load` does: only 'yolo' is yolo.
 * - **Unreadable, or not a JSON object: it throws** with a message that says what to do. It does not
 *   answer 'yolo', because the file may have said 'manual', and answering the bypass would start the
 *   Host's workers with permissions off. The caller refuses the spawn. The same rule
 *   readSkillSettings (main/appSettingsStore.ts) and accountsFile.ts apply.
 *
 * Shares its file read with `readAgentAppEnabled` (`readAppSettingsObject`, preflight ruling F5).
 */
export async function readAgentPermissionMode(filePath: string): Promise<AgentPermissionMode> {
  const parsed = await readAppSettingsObject(filePath)
  return agentPermissionModeOf(parsed?.agentPermissionMode)
}

/** Orchestrator W1-A: the role models, for the Host's start paths. Same file read as above; a broken
 *  file throws here too, and the caller (workerStart.ts's settingsFor) falls back to the defaults. */
export async function readRoleModelsSetting(filePath: string): Promise<RoleModelSettings> {
  return readRoleModelSettings((await readAppSettingsObject(filePath))?.roleModels)
}
