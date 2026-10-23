// W9-E: Agents (DESIGN §7) — the old agent tab without the usage guard (that is Accounts & usage now). The JSX is the
// settings modal's, moved unchanged.
import { OrchestratorModelsSettings } from '../OrchestratorModelsSettings'
import { VoiceSettings } from '../command/VoiceSettings'
import { ResumeStrategySettings } from '../ResumeStrategySettings'
import { MaxWorkersSetting } from '../MaxWorkersSetting'
import { HeavyJobsSetting } from '../HeavyJobsSetting'
import { FreshCoordinatorSetting } from '../FreshCoordinatorSetting'
import { StallWatchSetting } from '../StallWatchSetting'
import { StartAtLoginSetting } from '../StartAtLoginSetting'
import { AutoAnswerSetting } from '../AutoAnswerSetting'
import { toast } from '../../lib/toast'
import { SettingRow, type GroupProps } from './SettingRow'
import { Switch } from '../ui'
import { SettingItem } from './SettingItem'

export function AgentsSettings(p: GroupProps): React.JSX.Element | null {
  const {
    shown, only, accounts, agentAppEnabled, agentBrowserEnabled, agentYolo, setAgentAppEnabled, setAgentBrowserEnabled,
    setAgentYolo, settingsTouched, t
  } = p
  if (!shown) return null
  return (
    <div className="settings-stack">
      {/* 권한 모드 — 이 탭의 첫 칸이다. 이 토글이 정하는 것은 Job 워커가 승인을
          묻는가이다. 같은 optimistic-update-then-revert 관례를 쓴다. 명령줄 도구는
          CLI 탭으로 옮겼다. */}
      <SettingRow a="permission" only={only} modified={agentYolo}>
        <SettingItem title={t('settings.agentPermission.label')} hint={t('settings.agentPermission.hint')} control={<Switch aria-label={t('settings.agentPermission.label')}
              checked={agentYolo}
              onChange={(next) => {
                settingsTouched.current.touch('agentYolo')
                setAgentYolo(next)
                void window.api.settings
                  .setAgentPermissionMode(next ? 'yolo' : 'manual')
                  .catch((err) => {
                    setAgentYolo(!next)
                    toast.error(
                      t('settings.agentPermission.saveFailed', {
                        detail: err instanceof Error ? err.message : String(err)
                      })
                    )
                  })
              }}
            />} />
      </SettingRow>
      {/* W1-B: the app-wide Job worker cap. */}
      <SettingRow a="maxWorkers" only={only}>
        <MaxWorkersSetting />
      </SettingRow>
      <SettingRow a="heavyJobs" only={only}>
        <HeavyJobsSetting />
      </SettingRow>
      <SettingRow a="freshCoordinator" only={only}>
        <FreshCoordinatorSetting />
      </SettingRow>
      <SettingRow a="stallWatch" only={only}>
        <StallWatchSetting />
      </SettingRow>
      <SettingRow a="startAtLogin" only={only}>
        <StartAtLoginSetting />
      </SettingRow>
      <SettingRow a="autoAnswer" only={only}>
        <AutoAnswerSetting />
      </SettingRow>
      {/* 작업 이어가기와 재개 전략 — 권한 모드 바로 아래에 둔다. 이어가기는 Job 이
          재시작을 건너 살아남게 하는 것이라 위 칸과 한 갈래이고, 재개 전략은 그것이
          켜질 때 함께 움직인다(spec §3). 그 둘이 한 컴포넌트인 이유는 그 파일에 있다. */}
      <SettingRow a="resumeStrategy" only={only}>
        <ResumeStrategySettings />
      </SettingRow>
      {/* Orchestrator W1-A: the model each Job role and task difficulty starts on. */}
      <SettingRow a="roleModels" only={only}>
        <OrchestratorModelsSettings accounts={accounts} />
      </SettingRow>
      {/* W3-B: the local whisper.cpp the command bar's push-to-talk runs on */}
      <SettingRow a="voice" only={only}>
        <VoiceSettings />
      </SettingRow>
      {/* Agent browser — same settings-row/settings-hint/label shape and the same
          optimistic-update-then-revert as the two above. Off by default: it installs a
          skill into every account and starts the local server. */}
      <SettingRow a="agentBrowser" only={only} modified={agentBrowserEnabled}>
        <SettingItem title={t('settings.agentBrowser.label')} hint={t('settings.agentBrowser.hint')} control={<Switch aria-label={t('settings.agentBrowser.label')}
              checked={agentBrowserEnabled}
              onChange={(next) => {
                settingsTouched.current.touch('agentBrowser')
                setAgentBrowserEnabled(next)
                void window.api.settings.setAgentBrowserEnabled(next).catch((err) => {
                  setAgentBrowserEnabled(!next)
                  toast.error(
                    t('settings.agentBrowser.saveFailed', {
                      detail: err instanceof Error ? err.message : String(err)
                    })
                  )
                })
              }}
            />} />
      </SettingRow>
      {/* Agent app workspace: the same shape and the same optimistic update as the
          agent browser above. Off by default: it installs a skill into every account
          and lets the agent launch this project's app on a hidden desktop. */}
      <SettingRow a="agentApp" only={only} modified={agentAppEnabled}>
        <SettingItem title={t('settings.agentApp.label')} hint={t('settings.agentApp.hint')} control={<Switch aria-label={t('settings.agentApp.label')}
              checked={agentAppEnabled}
              onChange={(next) => {
                settingsTouched.current.touch('agentApp')
                setAgentAppEnabled(next)
                void window.api.settings.setAgentAppEnabled(next).catch((err) => {
                  setAgentAppEnabled(!next)
                  toast.error(
                    t('settings.agentApp.saveFailed', {
                      detail: err instanceof Error ? err.message : String(err)
                    })
                  )
                })
              }}
            />} />
      </SettingRow>
    </div>
  )
}
