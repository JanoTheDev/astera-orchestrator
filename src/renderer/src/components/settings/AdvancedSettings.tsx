// W9-E: Advanced (DESIGN §7) — How It Works work unit and generator (hiw), worktree location (worktree) and history.
// The about/version/updates/host status (info) rows moved to AboutSettings (T28). The JSX is the settings modal's, moved unchanged.
import { HistorySettings } from '../HistorySettings'
import { GeneratorSettings } from '../GeneratorSettings'
import { toast } from '../../lib/toast'
import { SettingRow, type GroupProps } from './SettingRow'
import { Button, Icon, Switch, Tooltip } from '../ui'

export function AdvancedSettings(p: GroupProps): React.JSX.Element | null {
  const { shown, only, setWorkUnitTrackingEnabled, setWtRoot, settingsTouched, t, workUnitTrackingEnabled, wtRoot } = p
  if (!shown) return null
  return (
    <>
      {/* How It Works — 추적과 설명 생성은 한 기능의 두 손잡이다(README 도 그렇게 묶어
          설명한다). 탭 이름이 곧 기능 이름이라 안에 제목을 또 세우지 않는다 — 다른 어느
          탭도 그러지 않는다. 추적이 먼저다: 그것이 모으는 것이 설명 생성의 입력이다. */}
      <div className="settings-stack">
        {/* Work unit tracking — same settings-row/settings-hint/label shape as the toggles
            in the agent tab, and the same optimistic-update-then-revert-on-failure
            behaviour. Off by default: nothing is read from before the moment this is
            turned on. */}
        <SettingRow a="workUnit" only={only}>
          <div className="settings-group">
            <label className="settings-row">
              <span>{t('settings.workUnit.label')}</span>
              <Switch
                checked={workUnitTrackingEnabled}
                onChange={(next) => {
                  settingsTouched.current.touch('workUnits')
                  setWorkUnitTrackingEnabled(next) // an optimistic update — reverted below on failure
                  void window.api.settings.setWorkUnitTrackingEnabled(next).catch((err) => {
                    setWorkUnitTrackingEnabled(!next)
                    toast.error(
                      t('settings.workUnit.saveFailed', {
                        detail: err instanceof Error ? err.message : String(err)
                      })
                    )
                  })
                }}
              />
            </label>
            <span className="settings-hint">{t('settings.workUnit.hint')}</span>
          </div>
        </SettingRow>
        <SettingRow a="generator" only={only}>
          <GeneratorSettings />
        </SettingRow>
      </div>
      <SettingRow a="worktreeRoot" only={only}>
        <div className="settings-worktree">
          {/* "Worktree" stays a word on screen; the tooltip says what it is (DESIGN-W11 plain words). */}
          <span className="settings-field-label settings-worktree-label">
            {t('settings.worktree.createLocation')}
            <Tooltip content={t('settings.worktree.tooltip')}>
              <span className="settings-worktree-info" tabIndex={0} role="img" aria-label={t('settings.worktree.tooltip')}>
                <Icon name="info" size={14} />
              </span>
            </Tooltip>
          </span>
          <div className="worktree-root-cell">
            <span className="worktree-root-path" title={wtRoot}>
              {wtRoot || '…'}
            </span>
            <Button
              size="sm"
              icon={<Icon name="folder" />}
              onClick={() =>
                void window.api.system.pickFolder().then(async (dir) => {
                  if (!dir) return
                  // Said when it fails, not left unhandled (audit UI-14).
                  try {
                    await window.api.worktrees.setRoot(dir)
                    setWtRoot(dir)
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : String(err))
                  }
                })
              }
            >
              {t('settings.worktree.change')}
            </Button>
          </div>
          <span className="settings-hint">
            {t('settings.worktree.hint')}
          </span>
        </div>
      </SettingRow>
      <SettingRow a="history" only={only}>
        <HistorySettings />
      </SettingRow>
    </>
  )
}
