// W9-E: every row of the Settings page, by group (DESIGN §7). Pure, so the search and the old-tab map are testable.
// A row's anchor is the id its wrapper carries (`settings-row-<anchor>`, `data-anchor`), which openSettings(group,
// anchor) scrolls to.
import type { MessageKey } from '../../../../core/i18n'

export const SETTINGS_GROUPS = ['general', 'accounts', 'agents', 'projects', 'integrations', 'notifications', 'advanced'] as const
export type SettingsGroupId = (typeof SETTINGS_GROUPS)[number]

export const GROUP_LABEL: Record<SettingsGroupId, MessageKey> = {
  general: 'settings.group.general',
  accounts: 'settings.group.accounts',
  agents: 'settings.group.agents',
  projects: 'settings.group.projects',
  integrations: 'settings.group.integrations',
  notifications: 'settings.group.notifications',
  advanced: 'settings.group.advanced'
}

export interface SettingsRow {
  anchor: string
  group: SettingsGroupId
  labelKey: MessageKey
  descKey?: MessageKey
}

/** In page order: a group's rows render in this order. */
export const SETTINGS_ROWS: readonly SettingsRow[] = [
  { anchor: 'language', group: 'general', labelKey: 'settings.general.language' },
  { anchor: 'defaultKind', group: 'general', labelKey: 'settings.defaultKind.title', descKey: 'settings.defaultKind.hint' },
  { anchor: 'autoCloseTabs', group: 'general', labelKey: 'settings.autoCloseTabs.label', descKey: 'settings.autoCloseTabs.hint' },
  { anchor: 'theme', group: 'general', labelKey: 'settings.theme.label', descKey: 'settings.theme.hint' },
  { anchor: 'terminalFont', group: 'general', labelKey: 'settings.font.latin', descKey: 'settings.font.hangul' },
  { anchor: 'shortcuts', group: 'general', labelKey: 'settings.tab.shortcuts' },

  { anchor: 'accounts', group: 'accounts', labelKey: 'settings.tab.accounts' },
  { anchor: 'usageGuard', group: 'accounts', labelKey: 'settings.usageGuard.pauseAtLabel', descKey: 'settings.usageGuard.subagentsLabel' },
  { anchor: 'accountMaxSessions', group: 'accounts', labelKey: 'settings.accountMaxSessions.label', descKey: 'settings.accountMaxSessions.hint' },

  { anchor: 'permission', group: 'agents', labelKey: 'settings.agentPermission.label', descKey: 'settings.agentPermission.hint' },
  { anchor: 'maxWorkers', group: 'agents', labelKey: 'settings.maxWorkers.label', descKey: 'settings.maxWorkers.hint' },
  { anchor: 'freshCoordinator', group: 'agents', labelKey: 'settings.freshCoordinator.label', descKey: 'settings.freshCoordinator.hint' },
  { anchor: 'stallWatch', group: 'agents', labelKey: 'settings.stallWatch.label', descKey: 'settings.stallWatch.hint' },
  { anchor: 'startAtLogin', group: 'agents', labelKey: 'settings.startAtLogin.label', descKey: 'settings.startAtLogin.hint' },
  { anchor: 'autoAnswer', group: 'agents', labelKey: 'settings.autoAnswer.label', descKey: 'settings.autoAnswer.hint' },
  { anchor: 'resumeStrategy', group: 'agents', labelKey: 'settings.jobContinuity.label', descKey: 'settings.jobContinuity.hint' },
  { anchor: 'roleModels', group: 'agents', labelKey: 'settings.roleModels.title', descKey: 'settings.roleModels.hint' },
  { anchor: 'voice', group: 'agents', labelKey: 'settings.voice.title', descKey: 'settings.voice.hint' },
  { anchor: 'agentBrowser', group: 'agents', labelKey: 'settings.agentBrowser.label', descKey: 'settings.agentBrowser.hint' },
  { anchor: 'agentApp', group: 'agents', labelKey: 'settings.agentApp.label', descKey: 'settings.agentApp.hint' },

  { anchor: 'projects', group: 'projects', labelKey: 'settings.projects.list', descKey: 'settings.projects.hint' },

  { anchor: 'github', group: 'integrations', labelKey: 'settings.row.github' },
  { anchor: 'slack', group: 'integrations', labelKey: 'settings.row.slack', descKey: 'settings.slack.hint' },
  { anchor: 'telegram', group: 'integrations', labelKey: 'settings.row.telegram', descKey: 'settings.telegram.hint' },
  { anchor: 'cli', group: 'integrations', labelKey: 'settings.row.cli', descKey: 'settings.cli.hint' },
  { anchor: 'mcp', group: 'integrations', labelKey: 'settings.row.mcp', descKey: 'settings.mcp.hint' },
  { anchor: 'remote', group: 'integrations', labelKey: 'settings.tab.remote', descKey: 'settings.remote.hint' },
  { anchor: 'plugins', group: 'integrations', labelKey: 'settings.tab.plugins', descKey: 'settings.plugins.hint' },
  { anchor: 'creativeHub', group: 'integrations', labelKey: 'settings.tab.creativeHub' },

  { anchor: 'notifications', group: 'notifications', labelKey: 'settings.tab.notifications', descKey: 'settings.notifications.hint' },

  { anchor: 'workUnit', group: 'advanced', labelKey: 'settings.workUnit.label', descKey: 'settings.workUnit.hint' },
  { anchor: 'generator', group: 'advanced', labelKey: 'settings.gen.label', descKey: 'settings.gen.hint' },
  { anchor: 'worktreeRoot', group: 'advanced', labelKey: 'settings.worktree.createLocation', descKey: 'settings.worktree.hint' },
  { anchor: 'history', group: 'advanced', labelKey: 'settings.tab.history' },
  { anchor: 'appName', group: 'advanced', labelKey: 'settings.info.appName' },
  { anchor: 'version', group: 'advanced', labelKey: 'settings.info.version' },
  { anchor: 'cliVersions', group: 'advanced', labelKey: 'settings.row.cliVersions' },
  { anchor: 'host', group: 'advanced', labelKey: 'settings.info.host' },
  { anchor: 'accountsCount', group: 'advanced', labelKey: 'settings.info.registeredAccounts' },
  { anchor: 'update', group: 'advanced', labelKey: 'settings.info.update' }
]

/** Rows whose label or description contains the query, case-insensitively, in page order. An empty query is every row. */
export function filterSettings(rows: readonly SettingsRow[], query: string, t: (key: MessageKey) => string): SettingsRow[] {
  const q = query.trim().toLocaleLowerCase()
  if (!q) return [...rows]
  return rows.filter((r) => t(r.labelKey).toLocaleLowerCase().includes(q) || (r.descKey !== undefined && t(r.descKey).toLocaleLowerCase().includes(q)))
}

/** The tabs of the settings modal before W9-E. */
export const OLD_SETTINGS_TABS = [
  'general', 'appearance', 'accounts', 'creativeHub', 'agent', 'cli', 'remote', 'plugins', 'hiw', 'shortcuts', 'slack',
  'notifications', 'github', 'worktree', 'history', 'info'
] as const
export type OldSettingsTab = (typeof OLD_SETTINGS_TABS)[number]

const OLD_TAB: Record<OldSettingsTab, { group: SettingsGroupId; anchor: string }> = {
  general: { group: 'general', anchor: 'language' },
  appearance: { group: 'general', anchor: 'theme' },
  accounts: { group: 'accounts', anchor: 'accounts' },
  creativeHub: { group: 'integrations', anchor: 'creativeHub' },
  agent: { group: 'agents', anchor: 'permission' },
  cli: { group: 'integrations', anchor: 'cli' },
  remote: { group: 'integrations', anchor: 'remote' },
  plugins: { group: 'integrations', anchor: 'plugins' },
  hiw: { group: 'advanced', anchor: 'workUnit' },
  shortcuts: { group: 'general', anchor: 'shortcuts' },
  slack: { group: 'integrations', anchor: 'slack' },
  notifications: { group: 'notifications', anchor: 'notifications' },
  github: { group: 'integrations', anchor: 'github' },
  worktree: { group: 'advanced', anchor: 'worktreeRoot' },
  history: { group: 'advanced', anchor: 'history' },
  info: { group: 'advanced', anchor: 'appName' }
}

/** Where an old tab's content lives now, so a caller still passing an old name lands on it. */
export const groupOfOldTab = (tab: OldSettingsTab): { group: SettingsGroupId; anchor: string } => OLD_TAB[tab]

const isGroup = (g: string): g is SettingsGroupId => (SETTINGS_GROUPS as readonly string[]).includes(g)

/** openSettings' target: a group passes through, an old tab name maps to its group, and its anchor unless one was given. */
export function settingsTarget(group: SettingsGroupId | OldSettingsTab, anchor?: string): { group: SettingsGroupId; anchor: string | null } {
  if (isGroup(group)) return { group, anchor: anchor ?? null }
  const old = groupOfOldTab(group)
  return { group: old.group, anchor: anchor ?? old.anchor }
}
