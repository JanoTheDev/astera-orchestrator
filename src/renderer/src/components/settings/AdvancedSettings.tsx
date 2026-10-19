// W9-E: Advanced (DESIGN §7) — How It Works work unit and generator (hiw), worktree location (worktree), history,
// and about/version/updates/host status (info). The JSX is the settings modal's, moved unchanged.
import { HistorySettings } from '../HistorySettings'
import { GeneratorSettings } from '../GeneratorSettings'
import { CliInstallRows } from '../CliInstallRows'
import { formatCheckedAt } from '../../../../core/update/checkFeedback'
import { AUTO_UPDATE } from '../../../../core/update/autoUpdate'
import { toast } from '../../lib/toast'
import { SettingRow, type GroupProps } from './SettingRow'

/** "7m", "2h" — a coarse uptime is all this row needs; it is a sign of life, not a metric, which is
 *  also why the unit is not translated. */
const hostUptime = (startedAt: string | null): string => {
  if (!startedAt) return '—'
  const ms = Date.now() - new Date(startedAt).getTime()
  const minutes = Math.max(0, Math.round(ms / 60_000))
  return minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`
}

export function AdvancedSettings(p: GroupProps): React.JSX.Element | null {
  const {
    shown, only, accounts, appVersion, cli, hostHolding, hostRestarting, hostStatus, installUpdate, restartHost,
    setCheckClickedAt, setCli, setCliInstalled, setWorkUnitTrackingEnabled, setWtRoot, settingsTouched, t, update,
    updateChecking, workUnitTrackingEnabled, wtRoot
  } = p
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
              <input
                type="checkbox" role="switch" className="ui-toggle"
                checked={workUnitTrackingEnabled}
                onChange={(e) => {
                  const next = e.target.checked
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
          <label className="settings-field-label">{t('settings.worktree.createLocation')}</label>
          <div className="worktree-root-cell">
            <span className="worktree-root-path" title={wtRoot}>
              {wtRoot || '…'}
            </span>
            <button
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
            </button>
          </div>
          <span className="settings-hint">
            {t('settings.worktree.hint')}
          </span>
        </div>
      </SettingRow>
      <SettingRow a="history" only={only}>
        <HistorySettings />
      </SettingRow>
      {/* W11: about, versions, Host and updates read as one card. */}
      <div className="settings-stack">
        <SettingRow a="appName" only={only}>
          <div className="settings-row">
            <span>{t('settings.info.appName')}</span>
            <span>Astera</span>
          </div>
        </SettingRow>
        <SettingRow a="version" only={only}>
          <div className="settings-row">
            <span>{t('settings.info.version')}</span>
            <span>{appVersion || '…'}</span>
          </div>
        </SettingRow>
        <SettingRow a="cliVersions" only={only}>
          {/* The two CLI rows, now with an install button each. Both answers are refreshed
              after one succeeds: the entry gate above reads existence, these rows read the
              version off the runnability check. */}
          <CliInstallRows
            cli={cli}
            onInstalled={(installed) => {
              setCliInstalled(installed)
              void window.api.system.checkCli().then(setCli)
            }}
          />
        </SettingRow>
        <SettingRow a="host" only={only}>
          <div className="settings-row">
            <span>{t('settings.info.host')}</span>
            {/* Three separate lines rather than one string joined with separators. Each of
                them varies in length on its own, and while they were one run of text the
                restart button sat at the end of it — so where the button appeared depended on
                how much the Host happened to be holding, which is not something a person
                should have to read past to find it. */}
            <span className="host-row-detail">
              {hostStatus?.connected ? (
                <>
                  <span>
                    {t('settings.info.hostConnected', {
                      protocol: hostStatus.protocol ?? 0,
                      uptime: hostUptime(hostStatus.startedAt)
                    })}
                  </span>
                  {/* The Host outlived an update and still runs the previous version. Said
                      here because this row is the one place its version is on screen, and
                      the automatic replacement (host-replacement design §4) is otherwise
                      invisible until it happens. The same amber the status bar's own notice
                      uses, so the two read as one fact rather than two. */}
                  {hostStatus.outdated && (
                    <span className="host-row-outdated">
                      {t('settings.info.hostOutdated', {
                        host: hostStatus.hostVersion ?? '?',
                        app: appVersion
                      })}
                    </span>
                  )}
                  {/* The files this Host runs from are missing some of what it needs. It is
                      running now and will stall at its next spawn, which is a state nobody
                      could see before (2026-09-22) — so it is said here, in the same amber,
                      beside the version it belongs to. */}
                  {hostStatus.runtimeIncomplete && (
                    <span className="host-row-outdated">{t('settings.info.hostRuntimeIncomplete')}</span>
                  )}
                  {/* Drawn only once the Host has answered. Until then the row is the
                      connection facts alone, which is the whole truth it has: a count here
                      before the answer would be an invented one. */}
                  {hostHolding && (
                    <span>
                      {t('settings.info.hostHolding', {
                        sessions: hostHolding.sessions,
                        chats: hostHolding.chats,
                        terminals: hostHolding.terminals,
                        runs: hostHolding.runs
                      })}
                    </span>
                  )}
                </>
              ) : hostStatus?.unresponsive ? (
                <>
                  {/* Two sentences, not one. The first is what is wrong and the second is
                      what is happening about it — work is continuing inside the app, and it
                      ends with the app. A person reading only "응답 없음" would not know
                      either half, which is what the 2026-09-22 morning looked like. */}
                  <span className="host-row-outdated">
                    {t('settings.info.hostUnresponsive', { detail: hostStatus.problem ?? '' })}
                  </span>
                  <span>{t('settings.info.hostUnresponsiveWhat')}</span>
                </>
              ) : (
                <span>
                  {hostStatus?.problem
                    ? t('settings.info.hostNotConnectedWhy', { detail: hostStatus.problem })
                    : t('settings.info.hostNotConnected')}
                </span>
              )}
            </span>
            {/* A sibling of the text, not its tail — .settings-row's space-between then keeps
                it at the row's right edge whether the text above it runs to one line or
                three. Not waiting for the automatic replacement; confirms with the holdings,
                because the count is the only honest part of the offer.

                Three reasons to offer it now, and the third is the one that cannot wait:
                an unresponsive Host has no automatic replacement behind it, because every
                rule that would replace one needs the Host to answer what it is holding
                first (design F5). */}
            {((hostStatus?.connected && (hostStatus.outdated || hostStatus.runtimeIncomplete)) || hostStatus?.unresponsive) && (
              <button type="button" disabled={hostRestarting} onClick={() => void restartHost()}>
                {hostRestarting ? t('settings.info.hostRestarting') : t('settings.info.hostRestartNow')}
              </button>
            )}
          </div>
        </SettingRow>
        <SettingRow a="accountsCount" only={only}>
          <div className="settings-row">
            <span>{t('settings.info.registeredAccounts')}</span>
            <span>{accounts.length}</span>
          </div>
        </SettingRow>
        <SettingRow a="update" only={only}>
          <div className="settings-row">
            {/* When the check time widens the cell, the label used to break across lines in a narrow modal */}
            <span className="update-label">{t('settings.info.update')}</span>
            <span className="update-cell">
              {/* Fork: no updater in this build, so there is nothing to check (core/update/autoUpdate.ts) */}
              {!AUTO_UPDATE ? (
                <span className="update-note">{t('update.info.manualOnly')}</span>
              ) : update?.state === 'downloading' ? (
                <span className="update-note">{t('update.info.downloading', { percent: update.percent ?? 0 })}</span>
              ) : (
                <>
                  {/* The check button stays even with a version already downloaded — when a
                      newer one appears you have to be able to skip the staged build and go to
                      that instead. If a re-check finds a newer version, autoDownload replaces
                      the staged file and this button's version changes with it. */}
                  {/* Through installUpdate, like every other install path: it quits the
                      app, so the person is told what that costs their running sessions
                      first. */}
                  {update?.state === 'downloaded' && (
                    <button onClick={() => void installUpdate()}>
                      {t('update.info.restartInstallVersion', { version: update.version ?? '' })}
                    </button>
                  )}
                  {/* 'manual' follows 'downloaded' on macOS when Squirrel turns the build
                      down. The label has to change with it: offering "restart and install"
                      for something restarting cannot install is what made this look broken
                      — and the reason goes next to it, because a button that quietly does
                      something else than it says is no better than one that does nothing. */}
                  {update?.state === 'manual' && (
                    <>
                      <button onClick={() => void installUpdate()}>
                        {t('update.info.manualInstallVersion', { version: update.version ?? '' })}
                      </button>
                      <span className="update-note">{t('update.info.manualWhy')}</span>
                    </>
                  )}
                  <button
                    disabled={updateChecking}
                    onClick={() => {
                      setCheckClickedAt(Date.now())
                      void window.api.update.check()
                    }}
                  >
                    {updateChecking ? t('update.info.checking') : t('update.info.checkButton')}
                  </button>
                  {/* The result text is hidden while checking — 'Checking…' and the previous
                      result showing at once contradict each other. Even when the result is
                      always the same because it is up to date, the check time changes, so the
                      press is visible. */}
                  {!updateChecking && update?.state === 'uptodate' && update.checkedAt !== null && (
                    <span className="update-note">
                      {t('update.info.upToDateAt', { time: formatCheckedAt(update.checkedAt) })}
                    </span>
                  )}
                  {/* autoDownload normally carries 'available' straight on to 'downloading',
                      so this button covers the window before that starts and a download that
                      failed. It is the only such trigger that does not depend on a campaign —
                      the other two callers of update.download(), the toast and UpdateGate,
                      open only when policy.json carries one. */}
                  {!updateChecking && update?.state === 'available' && (
                    <>
                      <button onClick={() => void window.api.update.download()}>
                        {t('update.info.downloadVersion', { version: update.version ?? '' })}
                      </button>
                      <span className="update-note">{t('update.info.available', { version: update.version ?? '' })}</span>
                    </>
                  )}
                  {!updateChecking && update?.state === 'error' && (
                    <span className="update-note update-err" title={update.message}>
                      {t('update.info.checkFailed')}
                    </span>
                  )}
                </>
              )}
            </span>
          </div>
        </SettingRow>
      </div>
    </>
  )
}
