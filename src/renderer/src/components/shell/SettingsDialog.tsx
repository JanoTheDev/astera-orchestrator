// Moved out of App.tsx unchanged (W9-A): the JSX is App's, the values come from App's state hooks.
import type { SessionKind } from '../../../../core/types'
import type { Lang, MessageKey } from '../../../../core/i18n'
import { CATALOGS, LANGS } from '../../../../core/i18n'
import { AccountSettings } from '../AccountSettings'
import { HistorySettings } from '../HistorySettings'
import { Select } from '../Select'
import { ShortcutSettings } from '../ShortcutSettings'
import { TerminalFontSettings } from '../TerminalFontSettings'
import { ThemeSettings } from '../ThemeSettings'
import { GeneratorSettings } from '../GeneratorSettings'
import { OrchestratorModelsSettings } from '../OrchestratorModelsSettings'
import { CliSettings } from '../CliSettings'
import { McpSettings } from '../McpSettings'
import { RemoteRuntimesSettings } from '../RemoteRuntimesSettings'
import { PluginsSettings } from '../PluginsSettings'
import { VoiceSettings } from '../command/VoiceSettings'
import { ResumeStrategySettings } from '../ResumeStrategySettings'
import { GithubSettings } from '../GithubSettings'
import { MaxWorkersSetting } from '../MaxWorkersSetting'
import { FreshCoordinatorSetting } from '../FreshCoordinatorSetting'
import { StallWatchSetting } from '../StallWatchSetting'
import { StartAtLoginSetting } from '../StartAtLoginSetting'
import { AutoAnswerSetting } from '../AutoAnswerSetting'
import { UsageGuardSettings } from '../usage/UsageGuardSettings'
import { CreativeHubSettings } from '../CreativeHubSettings'
import { NotificationSettings } from '../NotificationSettings'
import { CliInstallRows } from '../CliInstallRows'
import { formatCheckedAt } from '../../../../core/update/checkFeedback'
import { AUTO_UPDATE } from '../../../../core/update/autoUpdate'
import { toast } from '../../lib/toast'
import { AutoCloseTabsSetting } from '../AutoCloseTabsSetting'
import { X } from 'lucide-react'
import { deleteKey, isMac as isMacPlatform, modKey } from '../../lib/platformKeys'
import { backdropProps } from '../../lib/backdrop'
import { SlackSettings } from '../SlackSettings'
import type { AppState } from '../../state/appState'

// The shortcut list for the settings modal. When a binding changes (the TerminalView key handler or
// the global listener in App), update this list along with it.
// group and desc are kept as MessageKeys and translated with t() at render time (the shortcuts tab of
// the settings modal) — this array is a module-level constant, so t() cannot be called here.
// keys are literal keyboard combinations (e.g. 'Ctrl+C') and are not translated. Two entries are mouse
// gestures rather than key combinations, though, and leaving them as-is would strand text in the
// wrong language — those two clear keys and render a translated label from gestureKey (a MessageKey)
// inside the <kbd> instead.
// Most of the Ctrl-labelled entries below are actually platform-dependent: terminal copy/paste,
// explorer save/select-all/cut/copy/paste/undo are all Cmd on macOS (see MOD below), so they are
// built with MOD rather than a literal 'Ctrl'. The one deliberate exception is 'Ctrl+Enter' (terminal
// newline) — TerminalView.tsx leaves that one alone on both platforms because Claude Code reads
// Ctrl+Enter as a newline regardless of OS. F2 is unchanged across platforms; delete is Cmd+Backspace
// on macOS, whose keyboard has no forward Delete without fn (lib/platformKeys.ts).
const MOD = modKey()
const SHORTCUTS: Array<{
  group: MessageKey
  items: Array<{ keys: string[]; desc: MessageKey; gestureKey?: MessageKey }>
}> = [
  {
    group: 'shortcut.group.terminal',
    items: [
      { keys: ['Ctrl+Enter'], desc: 'shortcut.terminal.newline' },
      { keys: [`${MOD}+C`], desc: 'shortcut.terminal.copyOrInterrupt' },
      { keys: [`${MOD}+V`], desc: 'shortcut.paste' }
    ]
  },
  {
    group: 'shortcut.group.sessionTab',
    items: [
      { keys: [], gestureKey: 'shortcut.gesture.tabDrag', desc: 'shortcut.sessionTab.reorder' }
    ]
  },
  {
    group: 'shortcut.group.pane',
    items: [
      { keys: [], gestureKey: 'shortcut.gesture.tabDrag', desc: 'shortcut.pane.dragSplit' }
    ]
  },
  {
    group: 'shortcut.group.explorer',
    items: [
      { keys: [`${MOD}+S`], desc: 'shortcut.explorer.saveFile' },
      { keys: ['F2'], desc: 'shortcut.explorer.rename' },
      { keys: [isMacPlatform() ? deleteKey() : 'Delete'], desc: 'shortcut.explorer.delete' },
      { keys: [`${MOD}+A`], desc: 'shortcut.explorer.selectAll' },
      { keys: [`${MOD}+X`], desc: 'shortcut.explorer.cut' },
      { keys: [`${MOD}+C`], desc: 'shortcut.explorer.copy' },
      { keys: [`${MOD}+V`], desc: 'shortcut.paste' },
      { keys: [], gestureKey: 'shortcut.gesture.itemDrag', desc: 'shortcut.explorer.move' },
      { keys: [`${MOD}+Z`], desc: 'shortcut.explorer.undo' }
    ]
  }
]

/** "7m", "2h" — a coarse uptime is all this row needs; it is a sign of life, not a metric, which is
 *  also why the unit is not translated. */
const hostUptime = (startedAt: string | null): string => {
  if (!startedAt) return '—'
  const ms = Date.now() - new Date(startedAt).getTime()
  const minutes = Math.max(0, Math.round(ms / 60_000))
  return minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`
}

/** The value the "System" row carries. Empty string, because Select keys rows by string and null is
 *  not one — it is mapped back to null on the way out. Same convention as TerminalFontSettings. */
const SYSTEM_LANG = ''

export type SettingsDialogProps = Pick<
  AppState,
  'accounts' | 'agentAppEnabled' | 'agentBrowserEnabled' | 'agentYolo' | 'appVersion' | 'autoCloseEndedPlanTabs' |
  'cli' | 'cliInstallStatus' | 'defaultSessionKind' | 'hostHolding' | 'hostRestarting' | 'hostStatus' |
  'installUpdate' | 'keyOverrides' | 'restartHost' | 'setAgentAppEnabled' | 'setAgentBrowserEnabled' |
  'setAgentYolo' | 'setAutoCloseEndedPlanTabs' | 'setCheckClickedAt' | 'setCli' | 'setCliInstallStatus' |
  'setCliInstalled' | 'setDefaultSessionKind' | 'setKeyOverrides' | 'setLang' | 'setPairedChanged' |
  'setSettingsTab' | 'setShowSettings' | 'setWorkUnitTrackingEnabled' | 'setWtRoot' | 'settingsTab' |
  'settingsTouched' | 'showSettings' | 'storedLang' | 'systemLang' | 't' | 'update' | 'updateChecking' |
  'workUnitTrackingEnabled' | 'wtRoot'
>

export function SettingsDialog(p: SettingsDialogProps): React.JSX.Element {
  const {
    accounts, agentAppEnabled, agentBrowserEnabled, agentYolo, appVersion, autoCloseEndedPlanTabs, cli,
    cliInstallStatus, defaultSessionKind, hostHolding, hostRestarting, hostStatus, installUpdate, keyOverrides,
    restartHost, setAgentAppEnabled, setAgentBrowserEnabled, setAgentYolo, setAutoCloseEndedPlanTabs,
    setCheckClickedAt, setCli, setCliInstallStatus, setCliInstalled, setDefaultSessionKind, setKeyOverrides, setLang,
    setPairedChanged, setSettingsTab, setShowSettings, setWorkUnitTrackingEnabled, setWtRoot, settingsTab,
    settingsTouched, showSettings, storedLang, systemLang, t, update, updateChecking, workUnitTrackingEnabled,
    wtRoot
  } = p
  return (
    <>
      {showSettings && (
        <div className="modal-backdrop" {...backdropProps(() => setShowSettings(false))}>
          <div className="modal settings" onClick={(e) => e.stopPropagation()}>
            <div className="settings-header">
              <h2>{t('settings.title')}</h2>
              <button
                className="settings-close"
                aria-label={t('common.close')}
                title={t('common.close')}
                onClick={() => setShowSettings(false)}
              >
                <X size={14} />
              </button>
            </div>
            <div className="settings-body">
              <nav className="settings-nav">
                {(
                  [
                    ['general', t('settings.tab.general')],
                    ['appearance', t('settings.tab.appearance')],
                    ['accounts', t('settings.tab.accounts')],
                    ['creativeHub', t('settings.tab.creativeHub')],
                    // 에이전트와 How It Works — 둘 다 일반에서 갈라져 나왔고, 계정 바로 뒤가
                    // 제자리다: 어느 계정으로 무엇을 띄울지 정한 다음에 오는 이야기다.
                    // How It Works 의 이름은 사이드바·탭과 같은 키를 쓴다(새 문구를 만들지 않는다).
                    ['agent', t('settings.tab.agent')],
                    // The astera command has a tab of its own (2026-09-30): it is for a person's own
                    // terminal, not a setting of the agents the app runs. A name like GitHub's, untranslated.
                    ['cli', 'CLI'],
                    // Remote Runtimes (remote runtime design Phase 6): pairing with another computer, and this one as a Runtime.
                    ['remote', t('settings.tab.remote')],
                    // Plugins (plugin runtime design slice 2d, spec §30): beside the other ways in to the Host.
                    ['plugins', t('settings.tab.plugins')],
                    ['hiw', t('hiw.title')],
                    ['shortcuts', t('settings.tab.shortcuts')],
                    ['slack', 'Slack'],
                    ['notifications', t('settings.tab.notifications')],
                    ['github', 'GitHub'],
                    ['worktree', 'Worktree'],
                    ['history', t('settings.tab.history')],
                    ['info', t('settings.tab.info')]
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    className={`settings-nav-item ${settingsTab === key ? 'active' : ''}`}
                    onClick={() => setSettingsTab(key)}
                  >
                    {label}
                  </button>
                ))}
              </nav>
              <div className="settings-content">
                {settingsTab === 'general' && (
                  // .settings-stack 은 '기능 하나 = 굵은 제목 + 바로 아래 설명' 으로 읽히게 하는
                  // 배치다. 일반·에이전트·How It Works 세 탭이 같이 쓴다 — 셋 다 토글과 설명이
                  // 번갈아 오는 모양이라서다. 제목과 설명은 .settings-group 으로 붙인다.
                  <div className="settings-stack">
                    <div className="settings-row">
                      <span>{t('settings.general.language')}</span>
                      <Select
                        className="settings-lang-select"
                        items={[
                          {
                            value: SYSTEM_LANG,
                            label: t('settings.general.language.system', {
                              lang: CATALOGS[systemLang].nativeName
                            })
                          },
                          // Each language is written in its own language, so it can be found without
                          // knowing the current one. Not a translation target.
                          ...LANGS.map((l) => ({ value: l, label: CATALOGS[l].nativeName }))
                        ]}
                        value={storedLang ?? SYSTEM_LANG}
                        onChange={(v) => setLang(v === SYSTEM_LANG ? null : (v as Lang))}
                        ariaLabel={t('settings.general.language')}
                      />
                    </div>
                    {/* Which kind the two session dialogs open on. A plain enum with nothing coupled
                        to it, so — unlike the resume-strategy pair below, which earns its own
                        component exactly because setting one can flip the other — a settings-row
                        beside the language row is all this needs. It seeds each dialog's own
                        selection and nothing else: picking the other kind inside the dialog belongs
                        to that session and is not written back here. */}
                    <div className="settings-row">
                      <span>{t('settings.defaultKind.title')}</span>
                      <Select
                        items={[
                          { value: 'terminal', label: t('settings.defaultKind.terminal') },
                          { value: 'chat', label: t('settings.defaultKind.chat') }
                        ]}
                        value={defaultSessionKind}
                        onChange={(v) => {
                          const next = v as SessionKind
                          const prev = defaultSessionKind
                          settingsTouched.current.touch('defaultKind')
                          setDefaultSessionKind(next) // an optimistic update — reverted below on failure
                          void window.api.settings.setDefaultSessionKind(next).catch((err) => {
                            setDefaultSessionKind(prev)
                            toast.error(
                              t('settings.defaultKind.saveFailed', {
                                detail: err instanceof Error ? err.message : String(err)
                              })
                            )
                          })
                        }}
                        ariaLabel={t('settings.defaultKind.title')}
                      />
                    </div>
                    <p className="settings-hint">{t('settings.defaultKind.hint')}</p>
                    {/* W7-F (#84): an ended plan's tabs close on their own */}
                    <AutoCloseTabsSetting on={autoCloseEndedPlanTabs} onChange={setAutoCloseEndedPlanTabs} />
                  </div>
                )}
                {settingsTab === 'cli' && (
                  <div className="settings-stack">
                    {/* The astera command: installing it, and on Windows the user PATH (CliSettings).
                        Its status also decides the MCP registration lines (McpSettings). */}
                    <CliSettings onStatus={setCliInstallStatus} />
                    <McpSettings cliStatus={cliInstallStatus} />
                  </div>
                )}
                {settingsTab === 'agent' && (
                  <div className="settings-stack">
                    {/* 권한 모드 — 이 탭의 첫 칸이다. 이 토글이 정하는 것은 Job 워커가 승인을
                        묻는가이다. 같은 optimistic-update-then-revert 관례를 쓴다. 명령줄 도구는
                        CLI 탭으로 옮겼다. */}
                    <div className="settings-group">
                      <label className="settings-row">
                        <span>{t('settings.agentPermission.label')}</span>
                        <input
                          type="checkbox"
                          checked={agentYolo}
                          onChange={(e) => {
                            const next = e.target.checked
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
                        />
                      </label>
                      <span className="settings-hint">{t('settings.agentPermission.hint')}</span>
                    </div>
                    {/* W1-B: the app-wide Job worker cap. */}
                    <MaxWorkersSetting />
                    <FreshCoordinatorSetting />
                    <StallWatchSetting />
                    <StartAtLoginSetting />
                    <AutoAnswerSetting />
                    {/* W6-G */}
                    <UsageGuardSettings />
                    {/* 작업 이어가기와 재개 전략 — 권한 모드 바로 아래에 둔다. 이어가기는 Job 이
                        재시작을 건너 살아남게 하는 것이라 위 칸과 한 갈래이고, 재개 전략은 그것이
                        켜질 때 함께 움직인다(spec §3). 그 둘이 한 컴포넌트인 이유는 그 파일에 있다. */}
                    <ResumeStrategySettings />
                    {/* Orchestrator W1-A: the model each Job role and task difficulty starts on. */}
                    <OrchestratorModelsSettings accounts={accounts} />
                    {/* W3-B: the local whisper.cpp the command bar's push-to-talk runs on */}
                    <VoiceSettings />
                    {/* Agent browser — same settings-row/settings-hint/label shape and the same
                        optimistic-update-then-revert as the two above. Off by default: it installs a
                        skill into every account and starts the local server. */}
                    <div className="settings-group">
                      <label className="settings-row">
                        <span>{t('settings.agentBrowser.label')}</span>
                        <input
                          type="checkbox"
                          checked={agentBrowserEnabled}
                          onChange={(e) => {
                            const next = e.target.checked
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
                        />
                      </label>
                      <span className="settings-hint">{t('settings.agentBrowser.hint')}</span>
                    </div>
                    {/* Agent app workspace: the same shape and the same optimistic update as the
                        agent browser above. Off by default: it installs a skill into every account
                        and lets the agent launch this project's app on a hidden desktop. */}
                    <div className="settings-group">
                      <label className="settings-row">
                        <span>{t('settings.agentApp.label')}</span>
                        <input
                          type="checkbox"
                          checked={agentAppEnabled}
                          onChange={(e) => {
                            const next = e.target.checked
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
                        />
                      </label>
                      <span className="settings-hint">{t('settings.agentApp.hint')}</span>
                    </div>
                  </div>
                )}
                {/* How It Works — 추적과 설명 생성은 한 기능의 두 손잡이다(README 도 그렇게 묶어
                    설명한다). 탭 이름이 곧 기능 이름이라 안에 제목을 또 세우지 않는다 — 다른 어느
                    탭도 그러지 않는다. 추적이 먼저다: 그것이 모으는 것이 설명 생성의 입력이다. */}
                {settingsTab === 'hiw' && (
                  <div className="settings-stack">
                    {/* Work unit tracking — same settings-row/settings-hint/label shape as the toggles
                        in the agent tab, and the same optimistic-update-then-revert-on-failure
                        behaviour. Off by default: nothing is read from before the moment this is
                        turned on. */}
                    <div className="settings-group">
                      <label className="settings-row">
                        <span>{t('settings.workUnit.label')}</span>
                        <input
                          type="checkbox"
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
                    <GeneratorSettings />
                  </div>
                )}
                {settingsTab === 'appearance' && (
                  <>
                    <ThemeSettings />
                    <TerminalFontSettings />
                  </>
                )}
                {settingsTab === 'accounts' && <AccountSettings accounts={accounts} />}
                {settingsTab === 'creativeHub' && <CreativeHubSettings />}
                {settingsTab === 'info' && (
                  <>
                    <div className="settings-row">
                      <span>{t('settings.info.appName')}</span>
                      <span>Astera</span>
                    </div>
                    <div className="settings-row">
                      <span>{t('settings.info.version')}</span>
                      <span>{appVersion || '…'}</span>
                    </div>
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
                    <div className="settings-row">
                      <span>{t('settings.info.registeredAccounts')}</span>
                      <span>{accounts.length}</span>
                    </div>
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
                  </>
                )}
                {settingsTab === 'shortcuts' && (
                  <ShortcutSettings overrides={keyOverrides} onChanged={setKeyOverrides} />
                )}
                {settingsTab === 'shortcuts' &&
                  SHORTCUTS.map((g) => (
                    <div className="shortcut-group" key={g.group}>
                      <div className="shortcut-group-title">{t(g.group)}</div>
                      {g.items.map((it) => (
                        <div className="shortcut-row" key={it.desc}>
                          <span className="shortcut-keys">
                            {it.gestureKey ? (
                              <kbd>{t(it.gestureKey)}</kbd>
                            ) : (
                              it.keys.map((k, i) => (
                                <span key={k}>
                                  {i > 0 && <span className="shortcut-or">{t('common.or')}</span>}
                                  <kbd>{k}</kbd>
                                </span>
                              ))
                            )}
                          </span>
                          <span className="shortcut-desc">{t(it.desc, { mod: MOD })}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                {/* Kept while Settings is open (final review M-6): switching tabs unmounted it and dropped what was typed. */}
                <div hidden={settingsTab !== 'slack'}>
                  <SlackSettings />
                </div>
                {settingsTab === 'notifications' && <NotificationSettings />}
                {settingsTab === 'github' && <GithubSettings />}
                {settingsTab === 'remote' && <RemoteRuntimesSettings onChanged={() => setPairedChanged((n) => n + 1)} />}
                {settingsTab === 'plugins' && <PluginsSettings />}
                {settingsTab === 'worktree' && (
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
                )}
                {settingsTab === 'history' && <HistorySettings />}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
