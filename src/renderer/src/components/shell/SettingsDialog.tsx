// Moved out of App.tsx unchanged (W9-A): the JSX is App's, the values come from App's state hooks.
// W9-E: Settings is a page now (components/settings/SettingsPage.tsx), drawn as a full-width layer under the title bar
// rather than a modal: no backdrop, Back or Esc returns to what was on screen. This wrapper stays until W9-B's page
// router mounts SettingsPage directly.
import type { AppState } from '../../state/appState'
import { SettingsPage } from '../settings/SettingsPage'

export type SettingsDialogProps = Pick<
  AppState,
  'accounts' | 'agentAppEnabled' | 'agentBrowserEnabled' | 'agentYolo' | 'appVersion' | 'autoCloseEndedPlanTabs' |
  'cli' | 'cliInstallStatus' | 'defaultSessionKind' | 'hostHolding' | 'hostRestarting' | 'hostStatus' |
  'installUpdate' | 'keyOverrides' | 'restartHost' | 'setAgentAppEnabled' | 'setAgentBrowserEnabled' |
  'setAgentYolo' | 'setAutoCloseEndedPlanTabs' | 'setCheckClickedAt' | 'setCli' | 'setCliInstallStatus' |
  'setCliInstalled' | 'setDefaultSessionKind' | 'setKeyOverrides' | 'setLang' | 'setPairedChanged' |
  'setSettingsTab' | 'setShowSettings' | 'setRemoteDialog' | 'setWorkUnitTrackingEnabled' | 'setWtRoot' | 'settingsTab' |
  'settingsTouched' | 'showSettings' | 'storedLang' | 'systemLang' | 't' | 'update' | 'updateChecking' |
  'workUnitTrackingEnabled' | 'wtRoot' |
  // W9-E: the anchor openSettings scrolls to, and the Projects group
  'settingsAnchor' | 'setSettingsAnchor' | 'projectAnchor' | 'setProjectDialog' | 'workspaceTree'
>

export function SettingsDialog(p: SettingsDialogProps): React.JSX.Element | null {
  if (!p.showSettings) return null
  return <SettingsPage {...p} onClose={() => p.setShowSettings(false)} />
}
