// W9-E: Advanced (DESIGN §7) — How It Works work unit and generator (hiw), worktree location (worktree), history,
// and about/version/updates/host status (info). The JSX is the settings modal's, moved unchanged.
import { HistorySettings } from '../HistorySettings'
import { GeneratorSettings } from '../GeneratorSettings'
import { CliInstallRows } from '../CliInstallRows'
import { formatCheckedAt } from '../../../../core/update/checkFeedback'
import { AUTO_UPDATE } from '../../../../core/update/autoUpdate'
import { isSourceStatus, modeHintKey, sourceCard } from '../../../../core/update/sourceView'
import type { UpdateMode } from '../../../../core/types'
import { useEffect, useState } from 'react'
import { toast } from '../../lib/toast'
import { SettingRow, type GroupProps } from './SettingRow'
import { Button, Icon, Select, Switch, Tooltip } from '../ui'

const UPDATE_MODES: readonly UpdateMode[] = ['off', 'notify', 'build', 'install-when-idle']

/** The updates card of a build made from a git checkout: where it stands, what is new, and how automatic it is. */
function SourceUpdateCard({
  update, updateChecking, installUpdate, setCheckClickedAt, t
}: Pick<GroupProps, 'update' | 'updateChecking' | 'installUpdate' | 'setCheckClickedAt' | 't'>): React.JSX.Element | null {
  const [mode, setMode] = useState<UpdateMode>('build')
  const [open, setOpen] = useState(false)
  useEffect(() => {
    void window.api.settings.getUpdateMode().then(setMode).catch(() => {})
  }, [])
  if (!update) return null
  const card = sourceCard(update)
  const changeMode = (next: UpdateMode): void => {
    const prev = mode
    setMode(next) // optimistic; the updater reads the mode on its next tick, no restart
    void window.api.settings.setUpdateMode(next).catch((err) => {
      setMode(prev)
      toast.error(t('update.ui.modeSaveFailed', { detail: err instanceof Error ? err.message : String(err) }))
    })
  }
  const status = updateChecking
    ? t('update.info.checking')
    : card.phase === 'building'
      ? card.buildStep === 'waiting' ? t('update.tb.buildWaiting') : t('update.tb.building', { step: update.message ?? '' })
      : card.phase === 'ready'
        ? t('update.ui.ready', { count: card.behind })
        : card.phase === 'changes'
          ? t('update.ui.changes', { count: card.behind })
          : card.phase === 'upToDate'
            ? t('update.ui.upToDate')
            : ''
  return (
    <div className="settings-group">
      <div className="settings-row">
        <span className="update-label">{t('settings.info.update')}</span>
        <span className="update-cell">
          <span className="update-note">
            {t('update.ui.build')} <code style={{ fontFamily: 'var(--mono)' }}>{card.commit}</code>
            {update.checkedAt !== null && ` · ${t('update.ui.checkedAt', { time: formatCheckedAt(update.checkedAt) })}`}
          </span>
        </span>
      </div>
      <div className="settings-row">
        <span>{status}</span>
        <span className="update-cell">
          {card.showRestart && (
            <Button variant="primary" onClick={() => void installUpdate()}>{t('update.ui.restart')}</Button>
          )}
          {card.showBuild && (
            <Button variant="primary" onClick={() => void window.api.update.download()}>{t('update.ui.buildNow')}</Button>
          )}
          <Button
            disabled={updateChecking || card.phase === 'building'}
            onClick={() => {
              setCheckClickedAt(Date.now())
              void window.api.update.check()
            }}
          >
            {updateChecking ? t('update.info.checking') : t('update.info.checkButton')}
          </Button>
        </span>
      </div>
      {card.manualOnly && card.behind > 0 && <span className="settings-hint">{t('update.info.manualOnly')}</span>}
      {card.error && <span className="update-note update-err" title={card.error}>{t('update.ui.lastError', { message: card.error })}</span>}
      {card.commits.length > 0 && (
        <div>
          <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? t('update.ui.hideChanges') : t('update.ui.showChanges', { count: card.behind })}
          </Button>
          {open && (
            <ul className="settings-hint" style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
              {card.commits.map((c) => (
                <li key={c.sha}>
                  <code style={{ fontFamily: 'var(--mono)' }}>{c.sha.slice(0, 7)}</code> {c.subject}
                </li>
              ))}
              {card.more > 0 && <li>{t('update.ui.moreChanges', { count: card.more })}</li>}
            </ul>
          )}
        </div>
      )}
      {/* a div, not a label: a label re-forwards the click to the listbox and it reopens as it closes */}
      <div className="settings-row">
        <span>{t('update.ui.mode')}</span>
        <Select
          ariaLabel={t('update.ui.mode')}
          value={mode}
          onChange={(v) => changeMode(v as UpdateMode)}
          items={UPDATE_MODES.map((m) => ({ value: m, label: t(`update.ui.mode.${m}` as never) }))}
        />
      </div>
      <span className="settings-hint">{t(modeHintKey(mode))}</span>
    </div>
  )
}

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
              <Button type="button" disabled={hostRestarting} onClick={() => void restartHost()}>
                {hostRestarting ? t('settings.info.hostRestarting') : t('settings.info.hostRestartNow')}
              </Button>
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
          {isSourceStatus(update) ? (
            <SourceUpdateCard
              update={update} updateChecking={updateChecking} installUpdate={installUpdate}
              setCheckClickedAt={setCheckClickedAt} t={t}
            />
          ) : (
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
                    <Button onClick={() => void installUpdate()}>
                      {t('update.info.restartInstallVersion', { version: update.version ?? '' })}
                    </Button>
                  )}
                  {/* 'manual' follows 'downloaded' on macOS when Squirrel turns the build
                      down. The label has to change with it: offering "restart and install"
                      for something restarting cannot install is what made this look broken
                      — and the reason goes next to it, because a button that quietly does
                      something else than it says is no better than one that does nothing. */}
                  {update?.state === 'manual' && (
                    <>
                      <Button onClick={() => void installUpdate()}>
                        {t('update.info.manualInstallVersion', { version: update.version ?? '' })}
                      </Button>
                      <span className="update-note">{t('update.info.manualWhy')}</span>
                    </>
                  )}
                  <Button
                    disabled={updateChecking}
                    onClick={() => {
                      setCheckClickedAt(Date.now())
                      void window.api.update.check()
                    }}
                  >
                    {updateChecking ? t('update.info.checking') : t('update.info.checkButton')}
                  </Button>
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
                      <Button onClick={() => void window.api.update.download()}>
                        {t('update.info.downloadVersion', { version: update.version ?? '' })}
                      </Button>
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
          )}
        </SettingRow>
      </div>
    </>
  )
}
