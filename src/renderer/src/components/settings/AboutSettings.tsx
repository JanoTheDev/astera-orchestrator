// T28: Settings › About (DESIGN-W11 §9): what a buyer looks for in one place. The app's name and mark, its version and
// build version, the Host and CLI versions, how it updates (mode for a build made from a checkout, channel for a
// release build), crash reports, the license row, and the open source licenses. The info card and the update row
// moved here from Advanced (W9-E) with their anchors, so the settings search finds them as before.
import { useEffect, useState } from 'react'
import { useSetting } from '../../hooks/useSetting'
import { CliInstallRows } from '../CliInstallRows'
import { formatCheckedAt } from '../../../../core/update/checkFeedback'
import { AUTO_UPDATE } from '../../../../core/update/autoUpdate'
import { isSourceStatus, modeHintKey, sourceCard } from '../../../../core/update/sourceView'
import type { UpdateChannel, UpdateMode } from '../../../../core/types'
import type { CrashReportsSetting } from '../../../../core/crash/report'
import logoUrl from '../../assets/mark.svg'
import { toast } from '../../lib/toast'
import { SettingRow, type GroupProps } from './SettingRow'
import { LicensesView } from './LicensesView'
import { Button, Select } from '../ui'

const UPDATE_CHANNELS: readonly UpdateChannel[] = ['stable', 'beta']
const CRASH_CHOICES: readonly CrashReportsSetting[] = ['ask', 'never']

/** "1.4.14" out of "1.4.14-build.202610220705.ab0021b": the release a local build was made from. */
export const releaseVersionOf = (v: string): string => v.replace(/-build\..*$/, '')

const UPDATE_MODES: readonly UpdateMode[] = ['off', 'notify', 'build', 'install-when-idle']

/** The updates card of a build made from a git checkout: where it stands, what is new, and how automatic it is. */
function SourceUpdateCard({
  update, updateChecking, installUpdate, setCheckClickedAt, t
}: Pick<GroupProps, 'update' | 'updateChecking' | 'installUpdate' | 'setCheckClickedAt' | 't'>): React.JSX.Element | null {
  const [mode, setMode] = useSetting<UpdateMode>('updateMode', () => window.api.settings.getUpdateMode(), 'build')
  const [open, setOpen] = useState(false)
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

export function AboutSettings(p: GroupProps): React.JSX.Element | null {
  const {
    shown, only, accounts, appVersion, cli, hostHolding, hostRestarting, hostStatus, installUpdate, restartHost,
    setCheckClickedAt, setCli, setCliInstalled, t, update, updateChecking
  } = p
  const [channel, setChannel] = useSetting<UpdateChannel>('updateChannel', () => window.api.settings.getUpdateChannel(), 'stable')
  const [crash, setCrash] = useSetting<CrashReportsSetting>('crashReports', () => window.api.settings.getCrashReports(), 'ask')
  const [copied, setCopied] = useState(false)
  const [licensesOpen, setLicensesOpen] = useState(false)
  // The Copied word goes back to Copy after a moment, so a second copy is visible too.
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  if (!shown) return null
  const copyBuild = (): void => {
    window.api.clipboard.writeText(appVersion)
    setCopied(true)
  }
  const changeChannel = (next: UpdateChannel): void => {
    const prev = channel
    setChannel(next) // optimistic; the updater reads it on its next check
    void window.api.settings.setUpdateChannel(next).catch((err) => {
      setChannel(prev)
      toast.error(t('about.channel.saveFailed', { detail: err instanceof Error ? err.message : String(err) }))
    })
  }
  const changeCrash = (next: CrashReportsSetting): void => {
    const prev = crash
    setCrash(next)
    void window.api.settings.setCrashReports(next).catch((err) => {
      setCrash(prev)
      toast.error(t('about.crash.saveFailed', { detail: err instanceof Error ? err.message : String(err) }))
    })
  }
  return (
    <>
      {/* W11: about, versions, Host and updates read as one card. */}
      <div className="settings-stack">
        <SettingRow a="appName" only={only}>
          <div className="settings-row">
            <span>{t('settings.info.appName')}</span>
            <span className="about-name">
              <img src={logoUrl} alt="" width={20} height={20} />
              Astera
            </span>
          </div>
        </SettingRow>
        <SettingRow a="version" only={only}>
          <div className="settings-row">
            <span>{t('settings.info.version')}</span>
            <span>{appVersion ? releaseVersionOf(appVersion) : '…'}</span>
          </div>
        </SettingRow>
        <SettingRow a="buildVersion" only={only}>
          <div className="settings-row">
            <span>{t('about.buildVersion')}</span>
            <span className="about-copy">
              <code className="about-code">{appVersion || '…'}</code>
              <Button size="sm" disabled={!appVersion} aria-label={t('about.copyVersion')} onClick={copyBuild}>
                {copied ? t('about.copied') : t('about.copy')}
              </Button>
            </span>
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
        {!AUTO_UPDATE || isSourceStatus(update) ? null : (
          <SettingRow a="updateChannel" only={only}>
            <div className="settings-group">
              <div className="settings-row">
                <span>{t('about.updateChannel')}</span>
                <Select
                  ariaLabel={t('about.updateChannel')}
                  value={channel}
                  onChange={(v) => changeChannel(v as UpdateChannel)}
                  items={UPDATE_CHANNELS.map((c) => ({ value: c, label: t(`about.channel.${c}` as const) }))}
                />
              </div>
              <span className="settings-hint">{t('about.channel.hint')}</span>
            </div>
          </SettingRow>
        )}
        <SettingRow a="crashReports" only={only}>
          <div className="settings-group">
            <div className="settings-row">
              <span>{t('about.crashReports')}</span>
              <Select
                ariaLabel={t('about.crashReports')}
                value={crash}
                onChange={(v) => changeCrash(v as CrashReportsSetting)}
                items={CRASH_CHOICES.map((c) => ({ value: c, label: t(`about.crash.${c}` as const) }))}
              />
            </div>
            <span className="settings-hint">{t('about.crash.hint')}</span>
          </div>
        </SettingRow>
        {/* The seam for paid licensing: docs/product/licensing.md names this row. Nothing is checked today. */}
        <SettingRow a="license" only={only}>
          <div className="settings-row">
            <span>{t('about.license')}</span>
            <span>{t('about.license.personal')}</span>
          </div>
        </SettingRow>
        <SettingRow a="licenses" only={only}>
          <div className="settings-group">
            <div className="settings-row">
              <span>{t('about.licenses.title')}</span>
              <Button onClick={() => setLicensesOpen(true)}>{t('about.licenses.open')}</Button>
            </div>
            <span className="settings-hint">{t('about.licenses.hint')}</span>
          </div>
        </SettingRow>
      </div>
      {licensesOpen && <LicensesView t={t} onClose={() => setLicensesOpen(false)} />}
    </>
  )
}
