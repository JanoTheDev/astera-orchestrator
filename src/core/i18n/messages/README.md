# i18n catalogs, one file per area

Each locale is a folder: `ko/` (the source, sets the key type), `en/` (complete: `Record` over the ko keys),
`ja/` and `es/` (partial: a missing key falls back to English, then Korean). Every folder has one file per
area below, and `<locale>/index.ts` spreads them into one catalog (`import { en } from './messages/en'`).
A key lives in the same area in every locale; `en/<area>.ts` is typed by `ko/<area>.ts`, so a key placed in
the wrong area, or missing from en, fails typecheck.

A key's area is the screen whose files use it. Paths are under `src/renderer/src/components/` unless noted.

| Area | Files it serves |
|---|---|
| common | keys used by two or more areas, or by `ui/`, Select, ContextMenu, ToastHost, ConfirmHost, `lib/`, `state/`, `hooks/`, `App.tsx`, `i18n/I18nProvider` |
| core | keys used only outside `src/renderer` (`src/core`, `src/main`, `src/host`, `src/cli`, `src/pluginHost`, `packages/`) |
| shell | shell/Titlebar, ActivityBar, SideBar, Panel, ProjectSwitcher, StatusBar, shellView, useShell, navigation, viewTabs; `views/`; usage/UsageStrip, usageView, runOut |
| start | pages/StartPage, startLogic; NewModal; ScheduleRuleFields; ScheduleFields; `intake/` |
| plans | pages/PlansPage; plan/MainPlan, mainPlanView, PlanList, PlanRow, planList, Coordinator, coordinator; SourceChip |
| plan | pages/PlanPage; plan/PlanHeader, PlanOverview, PlanOverviewSection, PlanWaves, TaskBoard, PlanGraph, PlanFiles, PlanChanges, PlanJournal, PlanTalk, planTalk, QuestionAnswer, AutoApproveToggle, planBoard, planCommands, planPage, usePlanLive, usePlanPage; GateAnswer; TaskLinkChips; ChangedFilesBlock |
| agents | pages/AgentsPage; `wall/`; shell/Content; PaneGrid; TerminalView; TerminalBody; WorkbenchTabs; RunTabStrip; `conversation/`; SessionStateBanners; RemoteTerminalView; ProviderBadge; ResumeGlyph; agentOverlay |
| files | FileExplorer, ChangedList, ExplorerRow, explorerRows, explorerChanged, ExplorerLoading, FileEditor, FileFindBar, fileFind, FileIcon, FolderGlyph, MediaViewer, MarkdownPreview, MarkdownSplit, DiffView, `attribution/`, LocalHistoryDialog |
| worktrees | views/ScmView; WorktreeCreateStatus; `worktrees/`; BranchGlyph |
| accounts | AccountPanel, AccountSettings, AccountRow, AccountSignIn, AccountSelect, accountSelectItems, AccountUsageMeter, settings/AccountsUsageSettings, usage/UsageGuardSettings |
| settings | settings/SettingsPage, SettingRow, settingsIndex, GeneralSettings, AgentsSettings, NotificationsSettings, AdvancedSettings; shell/SettingsDialog; ThemeSettings, TerminalFontSettings, ShortcutSettings, AutoCloseTabsSetting, AutoAnswerSetting, FreshCoordinatorSetting, MaxWorkersSetting, OrchestratorModelsSettings, ResumeStrategySettings, StallWatchSetting, StartAtLoginSetting, TabSummariesSetting, NotificationSettings, GeneratorSettings, HistorySettings, command/VoiceSettings, activity/ActivityDigestSetting, activity/AlertSoundSetting |
| integrations | settings/ProjectsSettings, IntegrationsSettings; projects/ProjectSettings, projectAnchor; `delivery/`; GithubSettings, SlackSettings, TelegramSettings, CliSettings, McpSettings, PluginsSettings, pluginsList, pluginsText, RemoteRuntimesSettings (This computer as a Runtime), remoteRuntimesText, CreativeHubSettings, creativeHub, HiggsfieldSettings |
| onboarding | `onboarding/`; CliMissingScreen; CliInstallRows; HostRuntimeNotice; MachineSteps; `src/renderer/src/hooks/useCliInstall` |
| inbox | `inbox/`; activity/ActivityPanel, activityView, useActivityFeed; shell/NotificationBell |
| update | UpdateGate; the `update.*` keys used by `state/useWorkbench`, `state/useWorkbenchState` (installUpdate) and `lib/quitConfirm` (the update toasts and confirm) |
| errors | ErrorBoundary; `search/`; ui/EmptyState |
| overlays | `command/` (except VoiceSettings); QuickSwitcher; SourceJobModal; NewSessionDialog; RemoteSessionsDialog; NewTaskModal; CreatePrDialog; ResumeDialog; TranscriptPreviewModal; projects/AddProjectDialog, NewProjectDialog; shell/Overlays |
| tools | JobsView, JobIcons, RunPanel, RunToolbar, RunToolRail, RunConfigForm, RunConfigManager, RunConfigMenu, RunTypePicker, RunDetailJournal, RunFindBar, RuntimeSelector, ConfigRefList, EnvTable, BottomPanel, CompletionBlock, CompletionChecks, PrBadge, PushBadge, checkText |
| history | HistoryBrowser, RecordDetail, UnderstandingView, UnderstandingIcons, FlowDiagram, BrowserPane, browserSlot, AppMirrorPane, AnnotationTray, AnnotationPopover |
| about | settings/AboutSettings, LicensesView (the Settings › About group, its group label `settings.group.about`) |
| devices | views/DevicesView; `devices/` (DeviceDetail, AddDeviceModal, MigratePanel, devicesView, useDevices) |
| crash, help | empty for now |
| review | `review/` (ReviewView, ChangeMapView: the change map, the code panel and the hunk actions) |
| prs | views/PullRequestsView, views/pullRequests |
| misc | keys nothing uses |

A key built at runtime from a prefix (`` t(`plan.outcome.${x}`) ``) sits with the files that build it.

## Rules

- A Task edits only its own area files, in all four locales. A new string gets en, es, ja and ko text.
- A key a second area needs is copied into that area under its own key, or moved to `common` by the owner of
  `common`. Never import another area's file.
- `coverage.test.ts` fails when es, ja or ko lacks a key en has. `../coverageAllowlist.ts` lists the keys es and
  ja had not translated yet when the test was added; it only shrinks.
