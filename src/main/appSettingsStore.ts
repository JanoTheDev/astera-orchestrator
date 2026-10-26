import { promises as fs } from 'node:fs'
import path from 'node:path'
import { isLang, type Lang } from '../core/i18n'
import { sanitizeFontFamily } from '../core/terminal/font'
import type { TerminalFont } from '../core/terminal/font'
import { DEFAULT_THEME_ID, isThemeId, themeIdOf, type ThemeId } from '../core/theme/themes'
import type { AgentPermissionMode, McpAccess, ResumeStrategy, SessionKind, UpdateChannel, UpdateMode } from '../core/types'
import { DEFAULT_UPDATE_MODE, isUpdateMode } from '../core/update/sourceUpdate'
import { DEFAULT_UPDATE_CHANNEL, updateChannelOf } from '../core/update/updateChannel'
import { applyContinuityToggle } from '../core/continuity/settings'
import {
  readGeneratorSettings,
  writableGeneratorSettings,
  type GeneratorSettings
} from '../core/understanding/generatorSettings'
import { readRoleModelSettings, type RoleModelSettings } from '../core/orchestration/roleModels'
import { readVoiceSettings, type VoiceSettings } from '../core/intents/speech'
import {
  DESKTOP_NOTIFY_DEFAULTS,
  readDesktopNotify,
  writableDesktopNotify,
  type DesktopNotifySettings
} from '../core/notify/settings'
import type { SkillSettings } from '../core/orchestration/skills'
import { settingsObjectOf } from '../core/settings/settingsObject'
import { agentPermissionModeOf } from '../core/settings/agentPermissionMode'
import { maxConcurrentWorkersOf } from '../core/settings/maxConcurrentWorkers'
import { HEAVY_JOBS_DEFAULT, heavyJobsAtOnceOf } from '../core/settings/heavyJobs'
import { machineSpecs } from '../core/settings/machineSpecs'
import { effectiveCap, readAutoLimitsSync } from '../core/settings/autoLimits'
// W6-G usage guards
import { maxSubagentsPerSessionOf, SUBAGENT_CAP_DEFAULT } from '../core/sessions/subagentCap'
import { usagePauseAtOf, USAGE_PAUSE_AT_DEFAULT } from '../core/orchestration/usageGuard'
import { accountMaxSessionsOf } from '../core/settings/accountMaxSessions'
import { ACTIVITY_DIGEST_DEFAULT_MINUTES, activityDigestMinutesOf } from '../core/settings/activityDigest'
import { tabSummariesOf } from '../core/settings/tabSummaries'
import { approvalDefaultOf, type ApprovalMode } from '../core/settings/approvalDefault'
import { FRESH_COORDINATOR_DEFAULT_PCT, freshCoordinatorPctOf } from '../core/settings/freshCoordinator'
import { stallWatchOnOf } from '../core/settings/stallWatch'
import { crashReportsOf, type CrashReportsSetting } from '../core/crash/report' // T27
import { startAtLoginOf } from '../core/settings/startAtLogin'
import { autoAnswerOnOf } from '../core/orchestration/exec/autoAnswer'
import { autoCleanWorktreesOf } from '../core/settings/autoCleanWorktrees'
import { mcpAccessOf } from '../core/settings/mcpAccess'
import { mcpSessionsOf } from '../core/settings/mcpSessions'
import { mcpGithubWriteOf } from '../core/settings/mcpGithubWrite'
import { GITHUB_DEFAULTS, githubDefaultsOf, type GithubDefaults } from '../core/settings/githubDefaults'
import { MCP_HTTP_DEFAULT_PORT, mcpHttpOf, type McpHttpSettings } from '../core/settings/mcpHttp'
import { RepairNeeded } from '../core/settings/repairNeeded'
import { skillReposOf } from '../core/extensions/skillsCatalog'

/** The three settings that gate Astera's agent skills when the file does not say otherwise — a
 *  missing file, a corrupt one, or an absent key. */
export const SKILL_SETTINGS_DEFAULTS: SkillSettings = {
  workUnitTrackingEnabled: false,
  agentBrowserEnabled: false,
  agentAppEnabled: false,
  resumeStrategy: 'original'
}

/** The skill gates out of a parsed settings object, narrowed the way `load` narrows them. */
function skillSettingsOf(parsed: Record<string, unknown>): SkillSettings {
  return {
    // Narrowed to === true — values like 'yes' or 1 must not slip through as truthy and turn an
    // experimental feature on. It is the whole point of these toggles: default (and any untrusted
    // file content) reads as off, so the feature stays off until the user explicitly turns it on.
    workUnitTrackingEnabled: parsed.workUnitTrackingEnabled === true,
    agentBrowserEnabled: parsed.agentBrowserEnabled === true,
    agentAppEnabled: parsed.agentAppEnabled === true,
    // Narrowed to === 'smart' — the file is user-editable, so anything else ('ask', 42, null) reads as 'original'
    resumeStrategy: parsed.resumeStrategy === 'smart' ? 'smart' : 'original'
  }
}

/**
 * The skill gates from `filePath`, **read-only**, for `astera skills` in the CLI process.
 *
 * `load` cannot be that read: on a file it cannot parse it copies it to `.bak`, and the app is the
 * file's only writer. So this shares `load`'s parse and narrowing and differs only in what a bad
 * file means:
 *
 * - **Missing file: the defaults**, as `load` reads it — a profile that has never saved a setting.
 * - **Unreadable or not a JSON object: it throws** with a message that says what to do. It does not
 *   answer the defaults, because "every skill is off" would be a confident false answer about a
 *   setting that may be on — and `persist` writes in place, so a read racing it can see a torn file.
 *   Retrying, or opening Astera (which repairs it), is the answer. The same rule accountsFile.ts
 *   applies to accounts.json.
 */
export async function readSkillSettings(filePath: string): Promise<SkillSettings> {
  let text: string
  try {
    text = await fs.readFile(filePath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ...SKILL_SETTINGS_DEFAULTS }
    throw new RepairNeeded(`app-settings.json could not be read (${String(err)}); open Astera to repair it`, 'app-settings.json')
  }
  try {
    return skillSettingsOf(settingsObjectOf(text))
  } catch {
    throw new RepairNeeded('app-settings.json is not a valid settings file; open Astera to repair it', 'app-settings.json')
  }
}

/** App-wide settings persistence. Holds the language, the id of the dismissed update campaign, the
 *  work unit tracking toggle, the agent browser toggle, the Job Continuity
 *  toggle, the resume strategy, the terminal font, the theme, the default session kind, and the
 *  desktop notification flags.
 *  A null lang means the user has never picked one explicitly — the caller derives it with
 *  pickInitialLang(app.getLocale()). The derived value is not stored. */
export class AppSettingsStore {
  private lang: Lang | null = null
  /** The update campaign the user dismissed. The basis for not showing the same campaign again. */
  private dismissedCampaignId: string | null = null
  private workUnitTrackingEnabled = SKILL_SETTINGS_DEFAULTS.workUnitTrackingEnabled
  private agentBrowserEnabled = SKILL_SETTINGS_DEFAULTS.agentBrowserEnabled
  private agentAppEnabled = SKILL_SETTINGS_DEFAULTS.agentAppEnabled
  /** Ruling F62 — whether the one-time pause for work the old orchestration toggle had parked has
   *  already run on this profile. Written once and never cleared; see `orchAlwaysOnMigration`. It is
   *  also what tells `persist` to stop carrying `orchestrationEnabled` (ruling F67). */
  private orchAlwaysOnMigrated = false
  /** **What the settings file said about the old orchestration toggle when it was last read** —
   *  'on' when it carried `orchestrationEnabled: true`, 'off' when the file existed and did not, and
   *  'unknown' for a profile with no settings file and for one recovered from corruption. Those last
   *  two cannot say what the toggle was, and this codebase does not act on absent evidence, so they
   *  are not 'off'.
   *
   *  Three values rather than a boolean because `persist` has to be able to write the key back
   *  (ruling F67) and only 'on' was ever written. */
  private oldOrchestrationToggle: 'on' | 'off' | 'unknown' = 'unknown'
  /** Job Continuity (spec §3). Off by default; enabling it can also set resumeStrategy — see
   *  setJobContinuityEnabled. */
  private jobContinuityEnabled = false
  /** PR-status background polling (design doc §4, the fallback lever). Default on; the narrowing
   *  is inverted from the toggles above — the file is user-editable, so only an explicit false
   *  reads as off, and anything else (absent, corrupt) reads as on. */
  private githubPolling = true
  /** W1-B: how many Job workers may be open at once across every plan. null: no cap (the default, and
   *  the behaviour from before the setting). Written only when set. */
  private maxConcurrentWorkers: number | null = null
  private heavyJobsAtOnce = HEAVY_JOBS_DEFAULT
  /** W6-G: subagents at once per Claude tab (1–10), and the usage percent at which no new worker starts on an
   *  account. The subagent hook and the Host read the file themselves, narrowed by the same functions. Written only
   *  when not the default. */
  private maxSubagentsPerSession = SUBAGENT_CAP_DEFAULT
  private usagePauseAt = USAGE_PAUSE_AT_DEFAULT
  /** T5b: live sessions per account at most ({} = no cap). Written only when not empty. */
  private accountMaxSessions: Record<string, number> = {}
  /** W3-A: minutes between activity digests, 0 for none. Written only when it is not the default. */
  private activityDigestMinutes = ACTIVITY_DIGEST_DEFAULT_MINUTES
  private freshCoordinatorContextPct = FRESH_COORDINATOR_DEFAULT_PCT
  private approvalDefault: ApprovalMode | undefined = undefined
  /** Stall watchdog (orchestration/exec/stallWatch.ts): on by default; only an explicit false turns it off. */
  private stallWatch = true
  /** T27 crash reports (core/crash): 'ask' by default; only an explicit 'never' turns the prompt off. */
  private crashReports: CrashReportsSetting = 'ask'
  /** T23 (main/autostart.ts): on by default; only an explicit false turns it off. */
  private startAtLogin = true
  /** T21 (orchestration/exec/autoAnswer.ts): on by default; only an explicit false turns it off. */
  private autoAnswer = true
  /** W9-J: remove a delivered plan's ready worktrees; on by default. */
  private autoCleanWorktrees = true
  /** W6-B: the chime with a notice that needs the owner. On by default; only an explicit false (the file is
   *  user-editable) turns it off, as githubPolling. */
  private alertSound = true
  /** W7-F (#84): an ended plan's session tabs close on their own. On by default; only an explicit false turns it off. */
  private autoCloseEndedPlanTabs = true
  /** W9-I: a short summary card when a tab ends (DESIGN §4). On by default; only an explicit false turns it off. */
  private tabSummaries = true
  /** 설명을 누가·무엇으로 만드는가. 비어 있으면 생성하지 않는다 (설계 D2) */
  private generator: GeneratorSettings = {}
  /** Orchestrator W1-A: per-provider role and difficulty models. Empty = the built-in defaults. */
  private roleModels: RoleModelSettings = {}
  /** W3-B voice: the owner's whisper.cpp binary and model. Empty = voice not set up. */
  private voice: VoiceSettings = {}
  private resumeStrategy: ResumeStrategy = SKILL_SETTINGS_DEFAULTS.resumeStrategy
  /** 에이전트를 권한 확인 없이 띄우는가. **기본은 'yolo'** — 그 근거는 AgentPermissionMode 에 있다.
   *  githubPolling 과 같은 방향의 좁히기다: 기본이 켜짐인 값이라 파일에 명시된 'manual' 만 끈다.
   *  Fork W0: reversed. The default is 'manual', and only an explicit 'yolo' in the file turns the bypass on. */
  private agentPermissionMode: AgentPermissionMode = 'manual' // fork W0: never bypass by default
  /** What an MCP client may do through `astera mcp serve` (MCP design M5). Default 'control'; only
   *  the two narrower values are written to the file. */
  private mcpAccess: McpAccess = 'control'
  /** Whether an MCP client may see and use sessions (MCP P1 design §5). Off by default; only true is written. */
  private mcpSessions = false
  /** Whether an MCP client may act on GitHub: push, open pull requests, rerun CI, make Jobs from
   *  issues (MCP P2-B design). Off by default; only true is written. */
  private mcpGithubWrite = false
  /** What a new project does about GitHub (core/settings/githubDefaults.ts). */
  private githubDefaults: GithubDefaults = { ...GITHUB_DEFAULTS }
  /** MCP over HTTP (MCP HTTP design §2). Off by default; written only while a field differs from its default. */
  private mcpHttp: McpHttpSettings = mcpHttpOf(undefined)
  /** GitHub repos (`owner/repo`) the skills finder searches besides its default one. Written only when non-empty. */
  private skillRepos: string[] = []
  private terminalFont: TerminalFont = { latin: null, hangul: null }
  private theme: ThemeId = DEFAULT_THEME_ID
  /** Which kind the new-session and resume dialogs open on — a terminal session or a 대화 one. It
   *  seeds the dialog's own selection and nothing more: changing the kind inside the dialog applies
   *  to that session alone and is not written back here.
   *
   *  It replaces `conversationDefault`, which decided what a *terminal* session's tab showed first
   *  (the terminal or the conversation view). Both were labelled with the same two words, and the
   *  one people reached for when they wanted new sessions to be 대화 was this one — so the old key is
   *  carried over on load rather than asked again, and the per-tab toggle in the tab bar is what now
   *  chooses a terminal session's view. */
  private defaultSessionKind: SessionKind = 'terminal'
  /** How the source update channel acts on its own (src/core/update/sourceUpdate.ts). Written only when not the default. */
  private updateMode: UpdateMode = DEFAULT_UPDATE_MODE
  /** The releases updater's track (src/core/update/updateChannel.ts). Written only when beta. */
  private updateChannel: UpdateChannel = DEFAULT_UPDATE_CHANNEL
  /**
   * Whether this person has already been asked, once, what a new session should open on.
   *
   * **True by default, and the file says so only when it is false** — the same one-sided narrowing
   * githubPolling and agentPermissionMode use, and here it is what tells a new install from an old
   * one. An installation that predates this question has a settings file with no such key, and
   * reading that absence as "already asked" is the whole point: someone who has been using the app
   * for months must not be interrupted by a first-run question. Only the absence of the **file**
   * means a first run.
   */
  private firstRunAsked = true
  /** The onboarding step a first run had reached, so a restart mid-way resumes there. Only meaningful
   *  while firstRunAsked is false: finishing or skipping onboarding marks it asked and drops this. */
  private onboardingStep: string | null = null
  /** Desktop notifications, one flag per event. Written and read as one object, so the four move
   *  together and there is one place that knows what a missing file means. */
  private desktopNotify: DesktopNotifySettings = { ...DESKTOP_NOTIFY_DEFAULTS }
  /** Whether the last load recovered from a damaged file and the person has not been told yet. */
  private recoveryNotice = false

  constructor(public readonly filePath: string) {}

  // T1: the Host-written auto-limits, re-read from the tiny file when the cache is older than 5 s.
  private autoCache: { at: number; value: ReturnType<typeof readAutoLimitsSync> } | null = null
  private autoLimits(): ReturnType<typeof readAutoLimitsSync> {
    const now = Date.now()
    if (!this.autoCache || now - this.autoCache.at > 5000) this.autoCache = { at: now, value: readAutoLimitsSync(path.dirname(this.filePath)) }
    return this.autoCache.value
  }

  async load(): Promise<{ recovered: boolean }> {
    try {
      const parsed = settingsObjectOf(await fs.readFile(this.filePath, 'utf8'))
      // The three skill gates are read by the same function `readSkillSettings` uses, so the CLI's
      // `astera skills` and this store cannot narrow them differently.
      const gates = skillSettingsOf(parsed)
      const v = (parsed as { lang?: unknown }).lang
      this.lang = isLang(v) ? v : null
      const dismissed = (parsed as { dismissedCampaignId?: unknown }).dismissedCampaignId
      this.dismissedCampaignId =
        typeof dismissed === 'string' && dismissed.trim() ? dismissed : null
      this.workUnitTrackingEnabled = gates.workUnitTrackingEnabled
      this.agentBrowserEnabled = gates.agentBrowserEnabled
      this.agentAppEnabled = gates.agentAppEnabled
      // **The absence of the key is what says "off"**, not a stored `false`: `persist` omitted falsy
      // values, so `orchestrationEnabled` was only ever written when it was on. A profile that never
      // used the feature at all reads the same way, which costs nothing — the pause finds no parked
      // work there and writes the marker. Because that absence is the whole signal, `persist` carries
      // the key back until the migration has run (ruling F67, and the comment at that line).
      this.oldOrchestrationToggle =
        (parsed as { orchestrationEnabled?: unknown }).orchestrationEnabled === true ? 'on' : 'off'
      this.orchAlwaysOnMigrated =
        (parsed as { orchAlwaysOnMigrated?: unknown }).orchAlwaysOnMigrated === true
      this.jobContinuityEnabled =
        (parsed as { jobContinuityEnabled?: unknown }).jobContinuityEnabled === true
      this.githubPolling = (parsed as { githubPolling?: unknown }).githubPolling !== false
      // The same function the Host's read uses (readMaxConcurrentWorkers), so the two cannot differ.
      this.maxConcurrentWorkers = maxConcurrentWorkersOf(
        (parsed as { maxConcurrentWorkers?: unknown }).maxConcurrentWorkers
      )
      // The same function the CLI's and Host's read uses (readHeavyJobsAtOnce)
      this.heavyJobsAtOnce = heavyJobsAtOnceOf((parsed as { heavyJobsAtOnce?: unknown }).heavyJobsAtOnce) ?? HEAVY_JOBS_DEFAULT
      this.maxSubagentsPerSession = maxSubagentsPerSessionOf((parsed as { maxSubagentsPerSession?: unknown }).maxSubagentsPerSession)
      this.usagePauseAt = usagePauseAtOf((parsed as { usagePauseAt?: unknown }).usagePauseAt)
      this.accountMaxSessions = accountMaxSessionsOf((parsed as { accountMaxSessions?: unknown }).accountMaxSessions)
      // The same function the Host's read uses (readActivityDigestMinutes)
      this.activityDigestMinutes = activityDigestMinutesOf(
        (parsed as { activityDigestMinutes?: unknown }).activityDigestMinutes
      )
      this.freshCoordinatorContextPct = freshCoordinatorPctOf(
        (parsed as { freshCoordinatorContextPct?: unknown }).freshCoordinatorContextPct
      )
      this.approvalDefault = approvalDefaultOf((parsed as { approvalDefault?: unknown }).approvalDefault)
      this.stallWatch = stallWatchOnOf((parsed as { stallWatch?: unknown }).stallWatch)
      this.crashReports = crashReportsOf((parsed as { crashReports?: unknown }).crashReports) // T27
      this.startAtLogin = startAtLoginOf((parsed as { startAtLogin?: unknown }).startAtLogin)
      this.autoAnswer = autoAnswerOnOf((parsed as { autoAnswer?: unknown }).autoAnswer)
      this.autoCleanWorktrees = autoCleanWorktreesOf((parsed as { autoCleanWorktrees?: unknown }).autoCleanWorktrees)
      this.alertSound = (parsed as { alertSound?: unknown }).alertSound !== false
      this.autoCloseEndedPlanTabs = (parsed as { autoCloseEndedPlanTabs?: unknown }).autoCloseEndedPlanTabs !== false // W7-F (#84)
      this.tabSummaries = tabSummariesOf((parsed as { tabSummaries?: unknown }).tabSummaries) // W9-I
      // Narrowed on read, like generator and terminalFont and for the same reason: the file is
      // user-editable, and the narrowing is per flag's own default (see readDesktopNotify).
      this.desktopNotify = readDesktopNotify((parsed as { desktopNotify?: unknown }).desktopNotify)
      // Sanitised on read like terminalFont, and for the same reason: the file is user-editable and
      // these values become CLI arguments. Anything that does not survive reads as "not set", which
      // means the CLI default (or, for the account, no generation at all).
      this.generator = readGeneratorSettings((parsed as { generator?: unknown }).generator)
      this.roleModels = readRoleModelSettings((parsed as { roleModels?: unknown }).roleModels)
      this.voice = readVoiceSettings((parsed as { voice?: unknown }).voice)
      this.resumeStrategy = gates.resumeStrategy
      // Fork W0: only the explicit 'yolo' turns the bypass on; anything else the user-editable file holds
      // reads as 'manual'.
      // The same function the Host's read uses (readAgentPermissionMode), so the two cannot differ.
      this.agentPermissionMode = agentPermissionModeOf(
        (parsed as { agentPermissionMode?: unknown }).agentPermissionMode
      )
      // The same function the Host's read uses (readMcpAccess), so the two cannot differ.
      this.mcpAccess = mcpAccessOf((parsed as { mcpAccess?: unknown }).mcpAccess)
      // The same function the Host's read uses (readMcpSessions): only an explicit true turns it on.
      this.mcpSessions = mcpSessionsOf((parsed as { mcpSessions?: unknown }).mcpSessions)
      // Likewise the Host's readMcpGithubWrite: only an explicit true turns it on.
      this.mcpGithubWrite = mcpGithubWriteOf((parsed as { mcpGithubWrite?: unknown }).mcpGithubWrite)
      this.githubDefaults = githubDefaultsOf((parsed as { githubDefaults?: unknown }).githubDefaults)
      // The same function the Host's readMcpHttp uses, so the two cannot differ.
      this.mcpHttp = mcpHttpOf((parsed as { mcpHttp?: unknown }).mcpHttp)
      this.skillRepos = skillReposOf((parsed as { skillRepos?: unknown }).skillRepos)
      // Sanitised on read as well as on write: the file is user-editable, and the value ends up in a
      // CSS font-family string. Anything that does not survive is treated as unset.
      const font = (parsed as { terminalFont?: unknown }).terminalFont
      this.terminalFont =
        font !== null && typeof font === 'object' && !Array.isArray(font)
          ? {
              latin: sanitizeFontFamily((font as { latin?: unknown }).latin),
              hangul: sanitizeFontFamily((font as { hangul?: unknown }).hangul)
            }
          : { latin: null, hangul: null }
      const theme = (parsed as { theme?: unknown }).theme
      this.theme = themeIdOf(theme) // old ids → night, light → day (DESIGN.md §13)
      // Narrowed to === 'chat' — the file is user-editable, so anything else reads as the default
      // 'terminal', the same one-sided narrowing agentPermissionMode uses above. With the new key
      // absent the old one it replaced is read instead: its 'conversation' meant "open on the
      // conversation, not the terminal", which is what picking 대화 here now does.
      const kindRaw = parsed as { defaultSessionKind?: unknown; conversationDefault?: unknown }
      this.defaultSessionKind =
        kindRaw.defaultSessionKind === undefined
          ? kindRaw.conversationDefault === 'conversation'
            ? 'chat'
            : 'terminal'
          : kindRaw.defaultSessionKind === 'chat'
            ? 'chat'
            : 'terminal'
      // A file that exists is an app that has been used before — unless it says outright that the
      // question is still open, which is what a first run that wrote settings before answering leaves
      // behind. See the field's own note for why the absence means the opposite here.
      const mode = (parsed as { updateMode?: unknown }).updateMode
      this.updateMode = isUpdateMode(mode) ? mode : DEFAULT_UPDATE_MODE
      this.updateChannel = updateChannelOf((parsed as { updateChannel?: unknown }).updateChannel)
      this.firstRunAsked = (parsed as { firstRunAsked?: unknown }).firstRunAsked !== false
      const step = (parsed as { onboardingStep?: unknown }).onboardingStep
      this.onboardingStep = !this.firstRunAsked && typeof step === 'string' ? step : null
      return { recovered: false }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.lang = null
        this.dismissedCampaignId = null
        this.workUnitTrackingEnabled = SKILL_SETTINGS_DEFAULTS.workUnitTrackingEnabled
        this.agentBrowserEnabled = SKILL_SETTINGS_DEFAULTS.agentBrowserEnabled
        this.agentAppEnabled = SKILL_SETTINGS_DEFAULTS.agentAppEnabled
        // No file means no toggle to have been off, and no orchestration state to have parked —
        // this profile has never run anything. The F62 pause must not fire here.
        this.oldOrchestrationToggle = 'unknown'
        this.orchAlwaysOnMigrated = false
        this.jobContinuityEnabled = false
        this.githubPolling = true
        this.maxConcurrentWorkers = null
        this.heavyJobsAtOnce = HEAVY_JOBS_DEFAULT
        this.maxSubagentsPerSession = SUBAGENT_CAP_DEFAULT
        this.usagePauseAt = USAGE_PAUSE_AT_DEFAULT
        this.accountMaxSessions = {}
        this.activityDigestMinutes = ACTIVITY_DIGEST_DEFAULT_MINUTES
        this.freshCoordinatorContextPct = FRESH_COORDINATOR_DEFAULT_PCT
        this.approvalDefault = undefined
        this.stallWatch = true
        this.crashReports = 'ask'
        this.startAtLogin = true
        this.autoAnswer = true
        this.autoCleanWorktrees = true
        this.alertSound = true
        this.autoCloseEndedPlanTabs = true
        this.tabSummaries = true
        this.desktopNotify = { ...DESKTOP_NOTIFY_DEFAULTS }
        this.generator = {}
        this.roleModels = {}
        this.voice = {}
        this.resumeStrategy = SKILL_SETTINGS_DEFAULTS.resumeStrategy
        this.agentPermissionMode = 'manual'
        this.mcpAccess = 'control'
        this.mcpSessions = false
        this.mcpGithubWrite = false
        this.githubDefaults = { ...GITHUB_DEFAULTS }
        this.mcpHttp = mcpHttpOf(undefined)
        this.skillRepos = []
        this.terminalFont = { latin: null, hangul: null }
        this.theme = DEFAULT_THEME_ID
        this.defaultSessionKind = 'terminal'
        this.updateMode = DEFAULT_UPDATE_MODE
        this.updateChannel = DEFAULT_UPDATE_CHANNEL
        // No settings file at all: nobody has used this app on this machine yet. The one state the
        // first-run question is for.
        this.firstRunAsked = false
        this.onboardingStep = null
        return { recovered: false }
      }
      await fs.copyFile(this.filePath, this.filePath + '.bak').catch(() => {})
      this.lang = null
      this.dismissedCampaignId = null
      // The failure branch resets these too — otherwise, on a reload through the same instance, the previous value
      // survives the corrupt-file recovery and leaves a setting enabled that the file does not contain
      this.workUnitTrackingEnabled = SKILL_SETTINGS_DEFAULTS.workUnitTrackingEnabled
      this.agentBrowserEnabled = SKILL_SETTINGS_DEFAULTS.agentBrowserEnabled
      this.agentAppEnabled = SKILL_SETTINGS_DEFAULTS.agentAppEnabled
      // A file this could not read cannot say what the toggle was, and the F62 pause is not something
      // to do on a guess — it stops Runs the person may be watching. Both stay false, so a recovered
      // profile is left alone in either direction.
      this.oldOrchestrationToggle = 'unknown'
      this.orchAlwaysOnMigrated = false
      this.jobContinuityEnabled = false
      this.githubPolling = true
      this.maxConcurrentWorkers = null
      this.heavyJobsAtOnce = HEAVY_JOBS_DEFAULT
      this.maxSubagentsPerSession = SUBAGENT_CAP_DEFAULT
      this.usagePauseAt = USAGE_PAUSE_AT_DEFAULT
      this.accountMaxSessions = {}
      this.activityDigestMinutes = ACTIVITY_DIGEST_DEFAULT_MINUTES
      this.freshCoordinatorContextPct = FRESH_COORDINATOR_DEFAULT_PCT
      this.approvalDefault = undefined
      this.stallWatch = true
      this.crashReports = 'ask'
      this.startAtLogin = true
      this.autoAnswer = true
      this.autoCleanWorktrees = true
      this.alertSound = true
      this.autoCloseEndedPlanTabs = true
      this.tabSummaries = true
      this.desktopNotify = { ...DESKTOP_NOTIFY_DEFAULTS }
      this.generator = {}
      this.roleModels = {}
      this.voice = {}
      this.resumeStrategy = SKILL_SETTINGS_DEFAULTS.resumeStrategy
      // **The narrower side, not the default** (I2). The file may have said 'manual', and the 'yolo'
      // default would turn the person's permission prompts off without their knowing: every worker
      // after this, the app's or the Host's, would start with the bypass. So a recovered profile
      // asks, and the renderer says so (takeRecoveryNotice). Every other field takes its default.
      this.agentPermissionMode = 'manual'
      // The narrower side, as agentPermissionMode: the file may have said off.
      this.mcpAccess = 'off'
      this.mcpSessions = false
      this.mcpGithubWrite = false
      this.githubDefaults = { ...GITHUB_DEFAULTS }
      this.mcpHttp = mcpHttpOf(undefined)
      this.skillRepos = []
      this.terminalFont = { latin: null, hangul: null }
      this.theme = DEFAULT_THEME_ID
      this.defaultSessionKind = 'terminal'
      this.updateMode = DEFAULT_UPDATE_MODE
      this.updateChannel = DEFAULT_UPDATE_CHANNEL
      // A file that could not be read is still a file: this person has used the app before, and a
      // corrupt settings file is not a reason to put a first-run question in front of them.
      this.firstRunAsked = true
      this.onboardingStep = null
      this.recoveryNotice = true
      // Written back now rather than at the next setting change: the CLI and the Host refuse a
      // damaged file and tell the person to open Astera to repair it, so opening Astera has to leave a
      // valid file behind. The damaged one is already in .bak. A failed write leaves the file as it
      // was, which the next launch recovers again; it must not reject load (createCore).
      await this.persist().catch(() => {})
      return { recovered: true }
    }
  }

  /** True once after a load that recovered from a damaged file: the settings were reset and
   *  permission prompts are on. The renderer asks at mount and shows it; asking clears it, so a
   *  renderer reload does not repeat it. */
  takeRecoveryNotice(): boolean {
    const notice = this.recoveryNotice
    this.recoveryNotice = false
    return notice
  }

  getLang(): Lang | null {
    return this.lang
  }

  /** null is System: it clears the stored choice so the OS locale decides again. */
  async setLang(lang: Lang | null): Promise<void> {
    this.lang = lang
    await this.persist()
  }

  getDismissedCampaignId(): string | null {
    return this.dismissedCampaignId
  }

  async setDismissedCampaignId(id: string): Promise<void> {
    this.dismissedCampaignId = id
    await this.persist()
  }

  getWorkUnitTrackingEnabled(): boolean {
    return this.workUnitTrackingEnabled
  }

  async setWorkUnitTrackingEnabled(enabled: boolean): Promise<void> {
    this.workUnitTrackingEnabled = enabled
    await this.persist()
  }

  /** Ruling F62 — what this launch owes the one-time orchestration-always-on migration. `null` once
   *  the profile has been through it; otherwise `pause` says whether there is parked work to stop.
   *
   *  **Keyed on a marker of its own, not on erasing the old field.** The old field was only ever
   *  written when the toggle was *on* (persist omits falsy values), so its absence is what says off —
   *  there is nothing to erase, and no way to record "done" in a key that was never there.
   *  `orchAlwaysOnMigrated` is that record, and once written this answers `null` forever.
   *
   *  **Every profile is owed the record, not only the ones that get paused** (ruling F64), and that
   *  is why this answers an object rather than a boolean: the caller cannot record the one case and
   *  forget the other, because there is one branch to be inside. A boolean is what let the record be
   *  written in only the paused branch, and that left a profile whose toggle was **on** with no
   *  marker at all.
   *
   *  **And the signal it reads is preserved rather than raced** (ruling F67). `persist` keeps writing
   *  `orchestrationEnabled` for as long as this question is open, so an ordinary settings write — or
   *  a whole launch that never reaches the migration, because the Host could not be read — cannot
   *  quietly turn an "it was on" profile into an "it was off" one. The answer stays the same until
   *  the migration actually happens, whenever that is.
   *
   *  A profile that never used orchestration at all answers `{ pause: true }` once. That is
   *  deliberate rather than tolerated: it has nothing parked, so the pause touches nothing and only
   *  writes the marker. Narrowing further would mean asking the orchestration state a question here,
   *  before it has been loaded. */
  orchAlwaysOnMigration(): { pause: boolean } | null {
    if (this.orchAlwaysOnMigrated) return null
    return { pause: this.oldOrchestrationToggle === 'off' }
  }

  /** Records that the migration has run, so it never runs twice. **Called after the state write it
   *  belongs to, when there is one** — writing this first and then failing to pause would leave the
   *  next launch spending the person's accounts with nothing left to stop it. When nothing is paused
   *  there is no state write to be after, and this is all the migration does. */
  async markOrchAlwaysOnMigrated(): Promise<void> {
    this.orchAlwaysOnMigrated = true
    await this.persist()
  }

  getAgentBrowserEnabled(): boolean {
    return this.agentBrowserEnabled
  }

  /** The agent browser: sessions get a preview tab of their own to open, check and later click
   *  through this project's dev server, and the astera-browser skill is installed for every account.
   *  Off by default because it installs files into the user's skill directories and drives a browser
   *  on their behalf. */
  async setAgentBrowserEnabled(enabled: boolean): Promise<void> {
    this.agentBrowserEnabled = enabled
    await this.persist()
  }

  getAgentAppEnabled(): boolean {
    return this.agentAppEnabled
  }

  /** The agent app workspace: `astera app js` launches the project's app on a desktop the person
   *  never sees, and the astera-app skill is installed for every account. Off by default: it installs
   *  files into the user's skill directories and runs their app on their behalf. */
  async setAgentAppEnabled(enabled: boolean): Promise<void> {
    this.agentAppEnabled = enabled
    await this.persist()
  }

  getAgentPermissionMode(): AgentPermissionMode {
    return this.agentPermissionMode
  }

  /** 워커와 코디네이터를 띄우는 배선이 이 값을 읽어 bypassPermissions 로 넘긴다(src/main/ipc.ts). */
  async setAgentPermissionMode(mode: AgentPermissionMode): Promise<void> {
    this.agentPermissionMode = mode
    await this.persist()
  }

  getMcpAccess(): McpAccess {
    return this.mcpAccess
  }

  /** The Host reads the file on every MCP call (readMcpAccess), so saving it is the whole effect. */
  async setMcpAccess(v: McpAccess): Promise<void> {
    this.mcpAccess = v
    await this.persist()
  }

  getMcpSessions(): boolean {
    return this.mcpSessions
  }

  /** The Host reads the file on every MCP call (readMcpSessions), so saving it is the whole effect. */
  async setMcpSessions(v: boolean): Promise<void> {
    this.mcpSessions = v
    await this.persist()
  }

  getMcpGithubWrite(): boolean {
    return this.mcpGithubWrite
  }

  /** The Host reads the file on every MCP call (readMcpGithubWrite), so saving it is the whole effect. */
  async setMcpGithubWrite(v: boolean): Promise<void> {
    this.mcpGithubWrite = v
    await this.persist()
  }

  getGithubDefaults(): GithubDefaults {
    return { ...this.githubDefaults }
  }

  async setGithubDefaults(v: GithubDefaults): Promise<void> {
    this.githubDefaults = githubDefaultsOf(v)
    await this.persist()
  }

  getMcpHttp(): McpHttpSettings {
    return { ...this.mcpHttp, hosts: [...this.mcpHttp.hosts] }
  }

  /** The Host reads the file on `mcp-http-reload`, which ipc.ts sends after this save. */
  async setMcpHttp(v: McpHttpSettings): Promise<void> {
    this.mcpHttp = { ...v, hosts: [...v.hosts] }
    await this.persist()
  }

  getSkillRepos(): string[] {
    return [...this.skillRepos]
  }

  /** Narrowed the way load narrows it: valid `owner/repo` strings, each once. */
  async setSkillRepos(repos: string[]): Promise<void> {
    this.skillRepos = skillReposOf(repos)
    await this.persist()
  }

  getGithubPolling(): boolean {
    return this.githubPolling
  }

  async setGithubPolling(enabled: boolean): Promise<void> {
    this.githubPolling = enabled
    await this.persist()
  }

  getMaxConcurrentWorkers(): number | null {
    return this.maxConcurrentWorkers
  }

  /** What the scheduler uses: the saved limit, or this machine's recommendation when not set (as the Host's read does). */
  getEffectiveMaxConcurrentWorkers(): number {
    return effectiveCap(this.maxConcurrentWorkers ?? machineSpecs().recommended, this.autoLimits().workers)
  }

  /** Narrowed like the file: the value arrives from the renderer. */
  async setMaxConcurrentWorkers(n: number | null): Promise<void> {
    this.maxConcurrentWorkers = maxConcurrentWorkersOf(n)
    await this.persist()
  }

  /** How many heavy jobs (`astera heavy`, a Task's heavy check) the machine runs at once. */
  getHeavyJobsAtOnce(): number {
    return this.heavyJobsAtOnce
  }

  /** What the heavy-job gate uses: the saved value lowered by an auto-limit. Settings shows `getHeavyJobsAtOnce`. */
  getEffectiveHeavyJobsAtOnce(): number {
    return effectiveCap(this.heavyJobsAtOnce, this.autoLimits().heavy)
  }

  /** Narrowed like the file: the value arrives from the renderer. Anything but a whole number >= 1 is the default. */
  async setHeavyJobsAtOnce(n: number): Promise<void> {
    this.heavyJobsAtOnce = heavyJobsAtOnceOf(n) ?? HEAVY_JOBS_DEFAULT
    await this.persist()
  }

  getMaxSubagentsPerSession(): number {
    return this.maxSubagentsPerSession
  }

  /** Narrowed like the file: the value arrives from the renderer. */
  async setMaxSubagentsPerSession(n: number): Promise<void> {
    this.maxSubagentsPerSession = maxSubagentsPerSessionOf(n)
    await this.persist()
  }

  getUsagePauseAt(): number {
    return this.usagePauseAt
  }

  /** Narrowed like the file: the value arrives from the renderer. */
  async setUsagePauseAt(n: number): Promise<void> {
    this.usagePauseAt = usagePauseAtOf(n)
    await this.persist()
  }

  getAccountMaxSessions(): Record<string, number> {
    return { ...this.accountMaxSessions }
  }

  /** Narrowed like the file: the value arrives from the renderer. */
  async setAccountMaxSessions(v: unknown): Promise<void> {
    this.accountMaxSessions = accountMaxSessionsOf(v)
    await this.persist()
  }

  getActivityDigestMinutes(): number {
    return this.activityDigestMinutes
  }

  /** Narrowed like the file: the value arrives from the renderer. */
  async setActivityDigestMinutes(n: number): Promise<void> {
    this.activityDigestMinutes = activityDigestMinutesOf(n)
    await this.persist()
  }

  getFreshCoordinatorContextPct(): number {
    return this.freshCoordinatorContextPct
  }

  /** Narrowed like the file: the value arrives from the renderer. */
  async setFreshCoordinatorContextPct(n: number): Promise<void> {
    this.freshCoordinatorContextPct = freshCoordinatorPctOf(n)
    await this.persist()
  }

  getApprovalDefault(): ApprovalMode | undefined {
    return this.approvalDefault
  }

  /** Narrowed like the file: the value arrives from the renderer; anything but a mode clears the default. */
  async setApprovalDefault(mode: unknown): Promise<void> {
    this.approvalDefault = approvalDefaultOf(mode)
    await this.persist()
  }

  getStallWatch(): boolean {
    return this.stallWatch
  }

  async setStallWatch(on: boolean): Promise<void> {
    this.stallWatch = on !== false
    await this.persist()
  }

  /** T27 */
  getCrashReports(): CrashReportsSetting {
    return this.crashReports
  }

  async setCrashReports(v: CrashReportsSetting): Promise<void> {
    this.crashReports = crashReportsOf(v)
    await this.persist()
  }

  getStartAtLogin(): boolean {
    return this.startAtLogin
  }

  async setStartAtLogin(on: boolean): Promise<void> {
    this.startAtLogin = on !== false
    await this.persist()
  }

  getAutoAnswer(): boolean {
    return this.autoAnswer
  }

  async setAutoAnswer(on: boolean): Promise<void> {
    this.autoAnswer = on !== false
    await this.persist()
  }

  getAutoCleanWorktrees(): boolean {
    return this.autoCleanWorktrees
  }

  async setAutoCleanWorktrees(on: boolean): Promise<void> {
    this.autoCleanWorktrees = on !== false
    await this.persist()
  }

  getAlertSound(): boolean {
    return this.alertSound
  }

  async setAlertSound(on: boolean): Promise<void> {
    this.alertSound = on !== false
    await this.persist()
  }

  // W7-F (#84)
  getAutoCloseEndedPlanTabs(): boolean {
    return this.autoCloseEndedPlanTabs
  }

  async setAutoCloseEndedPlanTabs(on: boolean): Promise<void> {
    this.autoCloseEndedPlanTabs = on !== false
    await this.persist()
  }

  // W9-I
  getTabSummaries(): boolean {
    return this.tabSummaries
  }

  async setTabSummaries(on: boolean): Promise<void> {
    this.tabSummaries = on !== false
    await this.persist()
  }

  getDesktopNotify(): DesktopNotifySettings {
    return { ...this.desktopNotify }
  }

  /** The four are written together — the settings tab reads the record, flips one flag and sends the
   *  whole thing back, the same convention setGenerator follows. Reuses readDesktopNotify because
   *  this value arrives from the renderer: one narrowing function means the setter and the file
   *  reader can never disagree about what a malformed flag means (exactly what setGenerator does
   *  with readGeneratorSettings). */
  async setDesktopNotify(next: DesktopNotifySettings): Promise<void> {
    this.desktopNotify = readDesktopNotify(next)
    await this.persist()
  }

  getGenerator(): GeneratorSettings {
    return this.generator
  }

  /** 셋을 **함께** 쓴다 — 계정을 바꾸면 그 계정에 없는 모델이, 모델을 바꾸면 그 모델이 안 받는
   *  강도가 남아서는 안 된다. 하나씩 쓰는 setter 를 두면 그 불변식을 지킬 자리가 사라진다. */
  async setGenerator(g: GeneratorSettings): Promise<void> {
    this.generator = readGeneratorSettings(g)
    await this.persist()
  }

  getRoleModels(): RoleModelSettings {
    return this.roleModels
  }

  /** Written whole, like setGenerator; narrowed by the same reader load uses (orchestrator W1-A). */
  async setRoleModels(next: RoleModelSettings): Promise<void> {
    this.roleModels = readRoleModelSettings(next)
    await this.persist()
  }

  getVoice(): VoiceSettings {
    return this.voice
  }

  /** W3-B: written whole, narrowed by the reader load uses. */
  async setVoice(next: VoiceSettings): Promise<void> {
    this.voice = readVoiceSettings(next)
    await this.persist()
  }

  getResumeStrategy(): ResumeStrategy {
    return this.resumeStrategy
  }

  async setResumeStrategy(strategy: ResumeStrategy): Promise<void> {
    this.resumeStrategy = strategy
    await this.persist()
  }

  getJobContinuityEnabled(): boolean {
    return this.jobContinuityEnabled
  }

  /** One persist for both fields: the rule may change resumeStrategy as well (spec §3.2), and
   *  writing them separately would leave a window where the file says on/original. */
  async setJobContinuityEnabled(enabled: boolean): Promise<{ smartResumeTurnedOn: boolean }> {
    const r = applyContinuityToggle(
      { jobContinuity: this.jobContinuityEnabled, resumeStrategy: this.resumeStrategy },
      enabled
    )
    this.jobContinuityEnabled = r.jobContinuity
    this.resumeStrategy = r.resumeStrategy
    await this.persist()
    return { smartResumeTurnedOn: r.smartResumeTurnedOn }
  }

  getTerminalFont(): TerminalFont {
    return this.terminalFont
  }

  async setTerminalFont(font: TerminalFont): Promise<void> {
    this.terminalFont = {
      latin: sanitizeFontFamily(font.latin),
      hangul: sanitizeFontFamily(font.hangul)
    }
    await this.persist()
  }

  getTheme(): ThemeId {
    return this.theme
  }

  async setTheme(id: ThemeId): Promise<void> {
    this.theme = isThemeId(id) ? id : DEFAULT_THEME_ID
    await this.persist()
  }

  getDefaultSessionKind(): SessionKind {
    return this.defaultSessionKind
  }

  /** Whether the first-run question has already been put to this person. */
  getFirstRunAsked(): boolean {
    return this.firstRunAsked
  }

  /** It has been put to them — answered or dismissed, which are the same thing to this flag: it asks
   *  once. */
  async markFirstRunAsked(): Promise<void> {
    this.firstRunAsked = true
    this.onboardingStep = null
    await this.persist()
  }

  /** The step a first run's onboarding had reached; null once it is done (or never started). */
  getOnboardingStep(): string | null {
    return this.firstRunAsked ? null : this.onboardingStep
  }

  /** Remembers the step a first run's onboarding is on. Ignored once it is done: a replay from Settings
   *  is not a first run, so it has nothing to resume. */
  async setOnboardingStep(step: string): Promise<void> {
    if (this.firstRunAsked) return
    this.onboardingStep = step
    await this.persist()
  }

  async setDefaultSessionKind(kind: SessionKind): Promise<void> {
    this.defaultSessionKind = kind
    await this.persist()
  }

  getUpdateMode(): UpdateMode {
    return this.updateMode
  }

  async setUpdateMode(mode: UpdateMode): Promise<void> {
    this.updateMode = mode
    await this.persist()
  }

  getUpdateChannel(): UpdateChannel {
    return this.updateChannel
  }

  async setUpdateChannel(channel: UpdateChannel): Promise<void> {
    this.updateChannel = channel
    await this.persist()
  }

  /** The write in progress, so the next one waits for it (see persist). */
  private writing: Promise<void> = Promise.resolve()

  /** Writes run one at a time. Two setters called together (the first launch does this: the always-on
   *  migration's marker and the first-run answer) used to open the file at once, and the shorter write
   *  landed over the longer one's tail — a file the next load calls corrupt, backs up and replaces with
   *  every default, so a setting the person turned on is silently off. Each write reads the fields when
   *  it runs, so the last one to run carries the latest state. A failed write does not block the next. */
  private persist(): Promise<void> {
    const run = this.writing.then(() => this.write())
    this.writing = run.catch(() => {})
    return run
  }

  /** There is more than one field, so the whole object is always written — writing only one of them wipes the other
   *  (the defect from back when setLang wrote JSON.stringify({ lang })).
   *  Falsy values are omitted: leaving lang:null and workUnitTrackingEnabled:false out of the file still gives load the
   *  same result (it checks === true), and the file stays clean. */
  private async write(): Promise<void> {
    const data: {
      lang?: Lang
      dismissedCampaignId?: string
      workUnitTrackingEnabled?: boolean
      agentBrowserEnabled?: boolean
      agentAppEnabled?: boolean
      orchAlwaysOnMigrated?: boolean
      orchestrationEnabled?: true
      jobContinuityEnabled?: boolean
      githubPolling?: boolean
      maxConcurrentWorkers?: number
      heavyJobsAtOnce?: number
      maxSubagentsPerSession?: number
      usagePauseAt?: number
      accountMaxSessions?: Record<string, number>
      activityDigestMinutes?: number
      freshCoordinatorContextPct?: number
      approvalDefault?: ApprovalMode
      stallWatch?: false
      crashReports?: 'never' // T27
      startAtLogin?: false
      autoAnswer?: false
      autoCleanWorktrees?: false
      alertSound?: false
      autoCloseEndedPlanTabs?: false
      tabSummaries?: false
      desktopNotify?: DesktopNotifySettings
      generator?: GeneratorSettings
      roleModels?: RoleModelSettings
      voice?: VoiceSettings
      resumeStrategy?: ResumeStrategy
      agentPermissionMode?: AgentPermissionMode
      mcpAccess?: McpAccess
      mcpSessions?: true
      mcpGithubWrite?: true
      githubDefaults?: GithubDefaults
      mcpHttp?: McpHttpSettings
      skillRepos?: string[]
      terminalFont?: TerminalFont
      theme?: ThemeId
      defaultSessionKind?: SessionKind
      updateMode?: UpdateMode
      updateChannel?: UpdateChannel
      firstRunAsked?: false
      onboardingStep?: string
    } = {}
    if (this.lang) data.lang = this.lang
    if (this.dismissedCampaignId) data.dismissedCampaignId = this.dismissedCampaignId
    if (this.workUnitTrackingEnabled) data.workUnitTrackingEnabled = true
    if (this.agentBrowserEnabled) data.agentBrowserEnabled = true
    if (this.agentAppEnabled) data.agentAppEnabled = true
    if (this.orchAlwaysOnMigrated) data.orchAlwaysOnMigrated = true
    // **The one key here that is not a setting** (ruling F67). Orchestration stopped being a setting
    // and nothing reads this as one any more — but until the migration has run, the *absence* of this
    // key is the only thing that says the old toggle was off, and that signal is what decides whether
    // a person's live Runs get paused. Dropping it on the first ordinary write — a language, a theme,
    // the first-run answer — would let something entirely unrelated turn an "it was on" profile into
    // an "it was off" one, a launch or two later, with nothing to connect the two.
    //
    // So it is carried, unchanged, for exactly as long as the question is open, and goes the moment
    // the marker lands: the two facts move together rather than racing. Written only for 'on',
    // because only 'on' was ever written (persist has always omitted falsy values) — an 'off' or
    // 'unknown' profile accumulates nothing here, whether or not the migration has run.
    if (!this.orchAlwaysOnMigrated && this.oldOrchestrationToggle === 'on')
      data.orchestrationEnabled = true
    if (this.jobContinuityEnabled) data.jobContinuityEnabled = true
    if (this.githubPolling === false) data.githubPolling = false
    if (this.maxConcurrentWorkers !== null) data.maxConcurrentWorkers = this.maxConcurrentWorkers
    if (this.heavyJobsAtOnce !== HEAVY_JOBS_DEFAULT) data.heavyJobsAtOnce = this.heavyJobsAtOnce
    if (this.maxSubagentsPerSession !== SUBAGENT_CAP_DEFAULT) data.maxSubagentsPerSession = this.maxSubagentsPerSession
    if (this.usagePauseAt !== USAGE_PAUSE_AT_DEFAULT) data.usagePauseAt = this.usagePauseAt
    if (Object.keys(this.accountMaxSessions).length > 0) data.accountMaxSessions = this.accountMaxSessions
    if (this.activityDigestMinutes !== ACTIVITY_DIGEST_DEFAULT_MINUTES) data.activityDigestMinutes = this.activityDigestMinutes
    if (this.freshCoordinatorContextPct !== FRESH_COORDINATOR_DEFAULT_PCT) data.freshCoordinatorContextPct = this.freshCoordinatorContextPct
    if (this.approvalDefault !== undefined) data.approvalDefault = this.approvalDefault
    if (!this.stallWatch) data.stallWatch = false
    if (this.crashReports === 'never') data.crashReports = 'never' // T27
    if (!this.startAtLogin) data.startAtLogin = false
    if (!this.autoAnswer) data.autoAnswer = false
    if (!this.autoCleanWorktrees) data.autoCleanWorktrees = false
    if (!this.alertSound) data.alertSound = false
    if (!this.autoCloseEndedPlanTabs) data.autoCloseEndedPlanTabs = false // W7-F (#84)
    if (!this.tabSummaries) data.tabSummaries = false // W9-I
    // Written only while the question is still open, which is the same one-sided rule as the two
    // below — and here it carries the difference between a new install and an old one, so an absent
    // key has to keep meaning "asked". See the field's own note.
    if (this.firstRunAsked === false) data.firstRunAsked = false
    if (this.firstRunAsked === false && this.onboardingStep) data.onboardingStep = this.onboardingStep
    // Written only when it is not the default, for the same reason githubPolling is: the default belongs in one
    // place, and that place is load's narrowing. Fork W0: the default is 'manual', so only 'yolo' is written.
    if (this.agentPermissionMode === 'yolo') data.agentPermissionMode = 'yolo'
    // Written only when narrower than the default.
    if (this.mcpAccess !== 'control') data.mcpAccess = this.mcpAccess
    if (this.mcpSessions) data.mcpSessions = true
    if (this.mcpGithubWrite) data.mcpGithubWrite = true
    // Written only when it differs from the default, as mcpGithubWrite is.
    if (this.githubDefaults.createGithubRepo || this.githubDefaults.visibility !== GITHUB_DEFAULTS.visibility) data.githubDefaults = this.githubDefaults
    const h = this.mcpHttp
    if (h.enabled || h.lan || h.port !== MCP_HTTP_DEFAULT_PORT || h.hosts.length > 0) data.mcpHttp = h
    if (this.skillRepos.length > 0) data.skillRepos = this.skillRepos
    // Every flag at its default leaves the key out of the file entirely; load reconstructs those
    // defaults from an absent key, so nothing is lost.
    const desktopNotify = writableDesktopNotify(this.desktopNotify)
    if (desktopNotify) data.desktopNotify = desktopNotify
    // 비어 있으면 키 자체를 남기지 않는다 — 위 falsy 규칙 그대로다
    const generator = writableGeneratorSettings(this.generator)
    if (generator) data.generator = generator
    if (Object.keys(this.roleModels).length > 0) data.roleModels = this.roleModels
    if (Object.keys(this.voice).length > 0) data.voice = this.voice
    if (this.resumeStrategy === 'smart') data.resumeStrategy = 'smart'
    if (this.terminalFont.latin || this.terminalFont.hangul) data.terminalFont = this.terminalFont
    if (this.theme !== DEFAULT_THEME_ID) data.theme = this.theme
    if (this.defaultSessionKind === 'chat') data.defaultSessionKind = 'chat'
    if (this.updateMode !== DEFAULT_UPDATE_MODE) data.updateMode = this.updateMode
    if (this.updateChannel !== DEFAULT_UPDATE_CHANNEL) data.updateChannel = this.updateChannel
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    // Through a temp file and a rename, like accounts.json (registry.ts): a crash mid-write leaves the
    // old file whole, and a reader outside the app (`astera skills`) never sees half a file.
    const tmp = this.filePath + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
    await fs.rename(tmp, this.filePath)
  }
}
