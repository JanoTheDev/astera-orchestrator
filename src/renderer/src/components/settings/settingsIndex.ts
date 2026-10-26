// W9-E: every row of the Settings page, by group (DESIGN §7). Pure, so the search and the old-tab map are testable.
// A row's anchor is the id its wrapper carries (`settings-row-<anchor>`, `data-anchor`), which openSettings(group,
// anchor) scrolls to.
import type { MessageKey } from '../../../../core/i18n'

export const SETTINGS_GROUPS = ['general', 'accounts', 'agents', 'projects', 'integrations', 'notifications', 'advanced', 'about'] as const
export type SettingsGroupId = (typeof SETTINGS_GROUPS)[number]

export const GROUP_LABEL: Record<SettingsGroupId, MessageKey> = {
  general: 'settings.group.general',
  accounts: 'settings.group.accounts',
  agents: 'settings.group.agents',
  projects: 'settings.group.projects',
  integrations: 'settings.group.integrations',
  notifications: 'settings.group.notifications',
  advanced: 'settings.group.advanced',
  about: 'settings.group.about'
}

export type SettingsLevel = 'basic' | 'advanced'

export interface SettingsRow {
  anchor: string
  group: SettingsGroupId
  labelKey: MessageKey
  descKey?: MessageKey
  /** `basic` rows show in simple mode; `advanced` ones only with Advanced mode, a group's "Show advanced settings" link or a search hit. */
  level: SettingsLevel
}

/** In page order: a group's rows render in this order. */
export const SETTINGS_ROWS: readonly SettingsRow[] = [
  { anchor: 'language', group: 'general', labelKey: 'settings.general.language', level: 'basic' },
  { anchor: 'advancedMode', group: 'general', labelKey: 'settings.basic.advancedMode.label', descKey: 'settings.basic.advancedMode.hint', level: 'basic' },
  { anchor: 'defaultKind', group: 'general', labelKey: 'settings.defaultKind.title', descKey: 'settings.defaultKind.hint', level: 'advanced' },
  { anchor: 'autoCloseTabs', group: 'general', labelKey: 'settings.autoCloseTabs.label', descKey: 'settings.autoCloseTabs.hint', level: 'advanced' },
  { anchor: 'onboarding', group: 'general', labelKey: 'onboarding.settings.replay', descKey: 'onboarding.settings.replayHint', level: 'basic' },
  { anchor: 'theme', group: 'general', labelKey: 'settings.theme.label', descKey: 'settings.theme.hint', level: 'basic' },
  { anchor: 'terminalFont', group: 'general', labelKey: 'settings.font.latin', descKey: 'settings.font.hangul', level: 'advanced' },
  { anchor: 'shortcuts', group: 'general', labelKey: 'settings.tab.shortcuts', level: 'advanced' },

  { anchor: 'accounts', group: 'accounts', labelKey: 'settings.tab.accounts', level: 'basic' },
  { anchor: 'usageGuard', group: 'accounts', labelKey: 'settings.usageGuard.pauseAtLabel', descKey: 'settings.usageGuard.subagentsLabel', level: 'advanced' },
  { anchor: 'accountMaxSessions', group: 'accounts', labelKey: 'settings.accountMaxSessions.label', descKey: 'settings.accountMaxSessions.hint', level: 'advanced' },

  { anchor: 'permission', group: 'agents', labelKey: 'settings.agentPermission.label', descKey: 'settings.agentPermission.hint', level: 'advanced' },
  { anchor: 'maxWorkers', group: 'agents', labelKey: 'settings.maxWorkers.label', descKey: 'settings.maxWorkers.hint', level: 'advanced' },
  { anchor: 'heavyJobs', group: 'agents', labelKey: 'settings.heavyJobs.label', descKey: 'settings.heavyJobs.hint', level: 'advanced' },
  { anchor: 'approvalDefault', group: 'agents', labelKey: 'settings.approvalDefault.label', descKey: 'settings.approvalDefault.hint', level: 'advanced' },
  { anchor: 'freshCoordinator', group: 'agents', labelKey: 'settings.freshCoordinator.label', descKey: 'settings.freshCoordinator.hint', level: 'advanced' },
  { anchor: 'stallWatch', group: 'agents', labelKey: 'settings.stallWatch.label', descKey: 'settings.stallWatch.hint', level: 'advanced' },
  { anchor: 'startAtLogin', group: 'agents', labelKey: 'settings.startAtLogin.label', descKey: 'settings.startAtLogin.hint', level: 'advanced' },
  { anchor: 'autoAnswer', group: 'agents', labelKey: 'settings.autoAnswer.label', descKey: 'settings.autoAnswer.hint', level: 'advanced' },
  { anchor: 'resumeStrategy', group: 'agents', labelKey: 'settings.jobContinuity.label', descKey: 'settings.jobContinuity.hint', level: 'advanced' },
  { anchor: 'roleModels', group: 'agents', labelKey: 'settings.roleModels.title', descKey: 'settings.roleModels.hint', level: 'advanced' },
  { anchor: 'instructions', group: 'agents', labelKey: 'settings.row.instructions', descKey: 'settings.instructions.hint', level: 'advanced' },
  { anchor: 'voice', group: 'agents', labelKey: 'settings.voice.title', descKey: 'settings.voice.hint', level: 'advanced' },
  { anchor: 'agentBrowser', group: 'agents', labelKey: 'settings.agentBrowser.label', descKey: 'settings.agentBrowser.hint', level: 'advanced' },
  { anchor: 'agentApp', group: 'agents', labelKey: 'settings.agentApp.label', descKey: 'settings.agentApp.hint', level: 'advanced' },

  { anchor: 'projects', group: 'projects', labelKey: 'settings.projects.list', descKey: 'settings.projects.hint', level: 'basic' },

  { anchor: 'github', group: 'integrations', labelKey: 'settings.row.github', level: 'advanced' },
  { anchor: 'slack', group: 'integrations', labelKey: 'settings.row.slack', descKey: 'settings.slack.hint', level: 'advanced' },
  { anchor: 'telegram', group: 'integrations', labelKey: 'settings.row.telegram', descKey: 'settings.telegram.hint', level: 'advanced' },
  { anchor: 'discord', group: 'integrations', labelKey: 'settings.row.discord', descKey: 'settings.discord.hint', level: 'advanced' },
  { anchor: 'cli', group: 'integrations', labelKey: 'settings.row.cli', descKey: 'settings.cli.hint', level: 'advanced' },
  { anchor: 'mcp', group: 'integrations', labelKey: 'settings.row.mcp', descKey: 'settings.mcp.hint', level: 'advanced' },
  { anchor: 'finder', group: 'integrations', labelKey: 'settings.row.finder', descKey: 'settings.finder.hint', level: 'advanced' },
  { anchor: 'remote', group: 'integrations', labelKey: 'settings.tab.remote', descKey: 'settings.remote.hint', level: 'basic' },
  { anchor: 'plugins', group: 'integrations', labelKey: 'settings.tab.plugins', descKey: 'settings.plugins.hint', level: 'advanced' },
  { anchor: 'creativeHub', group: 'integrations', labelKey: 'settings.tab.creativeHub', level: 'advanced' },

  { anchor: 'notifications', group: 'notifications', labelKey: 'settings.tab.notifications', descKey: 'settings.notifications.hint', level: 'basic' },

  { anchor: 'workUnit', group: 'advanced', labelKey: 'settings.workUnit.label', descKey: 'settings.workUnit.hint', level: 'advanced' },
  { anchor: 'generator', group: 'advanced', labelKey: 'settings.gen.label', descKey: 'settings.gen.hint', level: 'advanced' },
  { anchor: 'worktreeRoot', group: 'advanced', labelKey: 'settings.worktree.createLocation', descKey: 'settings.worktree.hint', level: 'advanced' },
  { anchor: 'history', group: 'advanced', labelKey: 'settings.tab.history', level: 'advanced' },

  { anchor: 'appName', group: 'about', labelKey: 'settings.info.appName', level: 'basic' },
  { anchor: 'version', group: 'about', labelKey: 'settings.info.version', level: 'basic' },
  { anchor: 'buildVersion', group: 'about', labelKey: 'about.buildVersion', level: 'basic' },
  { anchor: 'cliVersions', group: 'about', labelKey: 'settings.row.cliVersions', level: 'advanced' },
  { anchor: 'host', group: 'about', labelKey: 'settings.info.host', level: 'advanced' },
  { anchor: 'accountsCount', group: 'about', labelKey: 'settings.info.registeredAccounts', level: 'advanced' },
  { anchor: 'update', group: 'about', labelKey: 'settings.info.update', level: 'basic' },
  { anchor: 'updateChannel', group: 'about', labelKey: 'about.updateChannel', descKey: 'about.channel.hint', level: 'basic' },
  { anchor: 'crashReports', group: 'about', labelKey: 'about.crashReports', descKey: 'about.crash.hint', level: 'basic' },
  { anchor: 'license', group: 'about', labelKey: 'about.license', level: 'basic' },
  { anchor: 'licenses', group: 'about', labelKey: 'about.licenses.title', descKey: 'about.licenses.hint', level: 'basic' }
]

/** Whether a group has a row simple mode shows (a group without one leaves the nav until Advanced mode). */
export const groupHasBasic = (g: SettingsGroupId): boolean => SETTINGS_ROWS.some((r) => r.group === g && r.level === 'basic')

/** Whether a row is on screen. A search shows exactly its hits, advanced ones included; otherwise the advanced rows wait for
 *  Advanced mode or their group's "Show advanced settings" link. */
export function rowVisible(anchor: string, showAdvanced: boolean, only: ReadonlySet<string> | null): boolean {
  if (only !== null) return only.has(anchor)
  return showAdvanced || SETTINGS_ROWS.find((r) => r.anchor === anchor)?.level !== 'advanced'
}

/** The groups with at least one row on screen: the settings editor lists exactly these in its table of contents. */
export function groupsShown(showAdvanced: boolean, only: ReadonlySet<string> | null): Set<SettingsGroupId> {
  return new Set(SETTINGS_ROWS.filter((r) => rowVisible(r.anchor, showAdvanced, only)).map((r) => r.group))
}

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
  info: { group: 'about', anchor: 'appName' }
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
