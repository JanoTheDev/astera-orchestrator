// Moved out of App.tsx unchanged (W9-A): App calls this hook and passes its result on.
import { useRef, useState } from 'react'
import type { CliInstallStatus, SessionKind } from '../../../core/types'
import { createSessionSizeReporters } from '../lib/workspaceMirror'
import { createTouched } from '../lib/touched'
import type { SettingsGroupId } from '../components/settings/settingsIndex'

export function useSettings() {
  const [showSettings, setShowSettings] = useState(false)
  // The CLI tab's install status, as CliSettings last read it, for McpSettings beside it.
  const [cliInstallStatus, setCliInstallStatus] = useState<CliInstallStatus | null>(null)
  // W9-E: the Settings page's group (DESIGN §7); an old tab name maps through groupOfOldTab (settingsIndex.ts)
  const [settingsTab, setSettingsTab] = useState<SettingsGroupId>('general')
  // W9-E: the row openSettings(group, anchor) scrolls to; the page clears it once it has.
  const [settingsAnchor, setSettingsAnchor] = useState<string | null>(null)
  /** Settings fields changed since the modal opened (audit UI-7). */
  const settingsTouched = useRef(createTouched())
  const [wtRoot, setWtRoot] = useState('') // the worktree root in the settings modal
  // 에이전트 권한 모드. **기본이 yolo 라 초기값도 true 다** — false 로 두면 모달이 열리는 순간
  // 꺼진 체크박스가 잠깐 보였다가 켜지고, 그 깜빡임은 사용자가 끈 것으로 읽힌다.
  // Fork W0: the default is 'manual' now, so false; a failed read must not show the bypass as on.
  const [agentYolo, setAgentYolo] = useState(false)
  const [workUnitTrackingEnabled, setWorkUnitTrackingEnabled] = useState(false) // the work unit tracking toggle
  const [agentBrowserEnabled, setAgentBrowserEnabled] = useState(false) // the agent browser toggle
  const [agentAppEnabled, setAgentAppEnabled] = useState(false) // the agent app workspace toggle
  // The mirror panes' sizes, one reporter per session however many panes show it. A size the Host
  // could not take leaves the app at its own size: nothing to tell the person.
  const [mirrorSizes] = useState(() => createSessionSizeReporters((id, size) => void window.api.workspace.size(id, size).catch(() => undefined)))
  // Which kind the new-session and resume dialogs open on. Needed outside the settings modal — both
  // dialogs seed their own selection from it — so it is loaded at mount rather than only while the
  // modal is open.
  const [defaultSessionKind, setDefaultSessionKind] = useState<SessionKind>('terminal')
  /** Whether first-run onboarding has been settled (finished or skipped) — null until main has said.
   *  False only on a machine with no settings file at all, so an update never sees onboarding
   *  (main/appSettingsStore.ts's firstRunAsked carries the whole rule). */
  const [firstRunAsked, setFirstRunAsked] = useState<boolean | null>(null)
  return {
    showSettings, setShowSettings, cliInstallStatus, setCliInstallStatus, settingsTab, setSettingsTab, settingsAnchor, setSettingsAnchor,
    settingsTouched, wtRoot, setWtRoot, agentYolo, setAgentYolo, workUnitTrackingEnabled, setWorkUnitTrackingEnabled,
    agentBrowserEnabled, setAgentBrowserEnabled, agentAppEnabled, setAgentAppEnabled, mirrorSizes,
    defaultSessionKind, setDefaultSessionKind, firstRunAsked, setFirstRunAsked
  }
}
