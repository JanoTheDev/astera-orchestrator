import { contextBridge, ipcRenderer, clipboard, webUtils } from 'electron'
import type {
  RendererApi,
  CoreEventChannel,
  CoreEvents,
  FoundDevice,
  HostStatus,
  HostRuntimeInstallState,
  MachineProgress,
  MigrateItemResult,
  UpdateApi,
  UpdateCampaignInfo,
  UpdateStatus
} from '../core/types'
import type { JustUpdatedApi } from '../core/update/sourceUpdate'

const invoke =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args)
const fire =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.send(channel, ...args)

const EVENT_CHANNELS = [
  'session:data',
  'session:reset',
  'session:remote-size',
  'session:pty-size',
  'session:remote-exit',
  'session:remote-gone',
  'session:remote-link',
  'session:exit',
  'session:created',
  'session:rolled',
  'session:rollState',
  'session:busy',
  'session:schedState',
  'history:updated',
  'history:scan',
  'accounts:changed',
  'accounts:ghostsChanged',
  'accounts:status-changed', // T3
  'files:changed',
  'files:changedBatch',
  'files:opProgress',
  'worktree:createProgress',
  'git:changed',
  'cli:install',
  'run:data',
  'run:status',
  'run:focus',
  'run:launchFailed',
  'preview:popup',
  'preview:agentTab',
  'preview:agentTabClose',
  'preview:agentBusy',
  'preview:agentPointer',
  'preview:agentEscape',
  'terminal:data',
  'terminal:exit',
  'terminal:created',
  'orch:state',
  'orch:host',
  'host:driver',
  'workspace:event',
  'mcpHttp:state',
  'understanding:changed',
  'sessionTasks:changed',
  'sessionTasks:goalIgnored',
  'github:prs-updated',
  'github:status',
  'usage:accounts-updated',
  'notify:activate',
  'notify:chime', // W6-B
  'conversation:append',
  'conversation:attention',
  'conversation:pendingPrompt',
  'chat:event'
]

const api = {
  accounts: {
    list: invoke('accounts.list'),
    create: invoke('accounts.create'),
    import: invoke('accounts.import'),
    remove: invoke('accounts.remove'),
    merge: invoke('accounts.merge'),
    loginStatus: invoke('accounts.loginStatus'),
    status: invoke('accounts.status'), // T3
    detect: invoke('accounts.detect'),
    ghosts: invoke('accounts.ghosts'),
    email: invoke('accounts.email'),
    plan: invoke('accounts.plan'),
    emailOfDir: invoke('accounts.emailOfDir'),
    logout: invoke('accounts.logout'),
    syncSettings: invoke('accounts.syncSettings'),
    // W7-F (#82)
    rename: invoke('accounts.rename'),
    login: invoke('accounts.login'),
    loginState: invoke('accounts.loginState'),
    loginCode: invoke('accounts.loginCode'),
    cancelLogin: invoke('accounts.cancelLogin')
  },
  sessions: {
    spawn: invoke('sessions.spawn'),
    write: fire('sessions.write'),
    resize: fire('sessions.resize'),
    ack: fire('sessions.ack'),
    kill: invoke('sessions.kill'),
    list: invoke('sessions.list'),
    rename: invoke('sessions.rename'),
    transcript: invoke('sessions.transcript'),
    resumeDefaults: invoke('sessions.resumeDefaults')
  },
  history: {
    page: invoke('history.page'),
    projectsPage: invoke('history.projectsPage'),
    preview: invoke('history.preview'),
    refresh: invoke('history.refresh'),
    deleteProjects: invoke('history.deleteProjects')
  },
  projects: {
    getDefaultAccount: invoke('projects.getDefaultAccount'),
    setDefaultAccount: invoke('projects.setDefaultAccount'),
    hasOrigin: invoke('projects.hasOrigin'),
    status: invoke('projects.status'), // T11
    deliverySetup: invoke('projects.deliverySetup')
  },
  worktrees: {
    list: invoke('worktrees.list'),
    create: invoke('worktrees.create'),
    cancelCreate: invoke('worktrees.cancelCreate'),
    listBranches: invoke('worktrees.listBranches'),
    remove: invoke('worktrees.remove'),
    isGitRepo: invoke('worktrees.isGitRepo'),
    getRoot: invoke('worktrees.getRoot'),
    setRoot: invoke('worktrees.setRoot'),
    pushState: invoke('worktrees.pushState'),
    // W9-J
    overview: invoke('worktrees.overview'),
    cleanup: invoke('worktrees.cleanup'),
    detail: invoke('worktrees.detail'),
    fileDiff: invoke('worktrees.fileDiff')
  },
  pr: {
    draftFor: invoke('pr.draftFor'),
    create: invoke('pr.create'),
    merge: invoke('pr.merge'),
    listOpen: invoke('pr.listOpen')
  },
  review: {
    changeMap: invoke('review.changeMap')
  },
  higgsfield: {
    list: invoke('higgsfield.list'),
    add: invoke('higgsfield.add'),
    importCurrent: invoke('higgsfield.importCurrent'),
    login: invoke('higgsfield.login'),
    loginState: invoke('higgsfield.loginState'),
    cancelLogin: invoke('higgsfield.cancelLogin'),
    remove: invoke('higgsfield.remove'),
    setCurrent: invoke('higgsfield.setCurrent'),
    setWorkspace: invoke('higgsfield.setWorkspace')
  },
  github: {
    status: invoke('github.status'),
    recheck: invoke('github.recheck'),
    prs: invoke('github.prs'),
    refresh: invoke('github.refresh'),
    subscribe: fire('github.subscribe'),
    unsubscribe: fire('github.unsubscribe')
  },
  usage: {
    session: invoke('usage.session'),
    // Beside usage.session rather than replacing it — the status bar's question ("how is the session
    // I am looking at") and this one ("which account should the next run go on") are different, and
    // the status-bar path needs no credentials at all (design doc §2/§4).
    accounts: invoke('usage.accounts'),
    // W6-G
    guard: invoke('usage.guard'),
    subscribe: fire('usage.subscribe'),
    unsubscribe: fire('usage.unsubscribe'),
    refresh: fire('usage.refresh') // T3
  },
  notify: {
    activeSession: fire('notify.activeSession'),
    remoteWaiting: fire('notify.remoteWaiting')
  },
  localHistory: {
    list: invoke('localHistory.list'),
    restore: invoke('localHistory.restore')
  },
  scheduler: {
    disable: invoke('scheduler.disable'),
    state: invoke('scheduler.state')
  },
  slack: {
    getConfig: invoke('slack.getConfig'),
    setConfig: invoke('slack.setConfig')
  },
  telegram: {
    getConfig: invoke('telegram.getConfig'),
    setConfig: invoke('telegram.setConfig')
  },
  discord: {
    getConfig: invoke('discord.getConfig'),
    setConfig: invoke('discord.setConfig')
  },
  /** `astera` 명령을 사람의 PATH 에서 닿는 자리에 깔아 둔다(공개 CLI 설계 §10). */
  cli: {
    status: invoke('cli.status'),
    install: invoke('cli.install'),
    uninstall: invoke('cli.uninstall'),
    pathRepairedAtStart: invoke('cli.pathRepairedAtStart')
  },
  mcpClients: {
    status: invoke('mcpClients.status'),
    register: invoke('mcpClients.register')
  },
  extensions: {
    mcpSearch: invoke('extensions.mcpSearch'),
    mcpInstalled: invoke('extensions.mcpInstalled'),
    mcpInstall: invoke('extensions.mcpInstall'),
    mcpRemove: invoke('extensions.mcpRemove'),
    skillsSearch: invoke('extensions.skillsSearch'),
    skillsInstalled: invoke('extensions.skillsInstalled'),
    skillsInstall: invoke('extensions.skillsInstall'),
    skillsRemove: invoke('extensions.skillsRemove'),
    skillReposGet: invoke('extensions.skillReposGet'),
    skillReposSet: invoke('extensions.skillReposSet')
  },
  prompts: {
    list: invoke('prompts.list'),
    get: invoke('prompts.get'),
    set: invoke('prompts.set'),
    reset: invoke('prompts.reset'),
    preview: invoke('prompts.preview')
  },
  mcpHttp: {
    status: invoke('mcpHttp.status'),
    token: invoke('mcpHttp.token'),
    tokenHint: invoke('mcpHttp.tokenHint'),
    newToken: invoke('mcpHttp.newToken')
  },
  // W3-B command bar
  command: {
    parse: invoke('command.parse'),
    transcribe: invoke('speech.transcribe')
  },
  settings: {
    getLang: invoke('settings.getLang'),
    setLang: invoke('settings.setLang'),
    getWorkUnitTrackingEnabled: invoke('settings.getWorkUnitTrackingEnabled'),
    setWorkUnitTrackingEnabled: invoke('settings.setWorkUnitTrackingEnabled'),
    getAgentBrowserEnabled: invoke('settings.getAgentBrowserEnabled'),
    setAgentBrowserEnabled: invoke('settings.setAgentBrowserEnabled'),
    getAgentAppEnabled: invoke('settings.getAgentAppEnabled'),
    setAgentAppEnabled: invoke('settings.setAgentAppEnabled'),
    getGithubPolling: invoke('settings.getGithubPolling'),
    setGithubPolling: invoke('settings.setGithubPolling'),
    getMaxConcurrentWorkers: invoke('settings.getMaxConcurrentWorkers'),
    getHeavyJobsAtOnce: invoke('settings.getHeavyJobsAtOnce'),
    getMachineSpecs: invoke('settings.getMachineSpecs'),
    // W3-A
    getActivityDigestMinutes: invoke('settings.getActivityDigestMinutes'),
    setActivityDigestMinutes: invoke('settings.setActivityDigestMinutes'),
    getApprovalDefault: invoke('settings.getApprovalDefault'),
    setApprovalDefault: invoke('settings.setApprovalDefault'),
    getFreshCoordinatorContextPct: invoke('settings.getFreshCoordinatorContextPct'),
    setFreshCoordinatorContextPct: invoke('settings.setFreshCoordinatorContextPct'),
    getStallWatch: invoke('settings.getStallWatch'),
    setStallWatch: invoke('settings.setStallWatch'),
    getCrashReports: invoke('settings.getCrashReports'), // T27
    setCrashReports: invoke('settings.setCrashReports'),
    getStartAtLogin: invoke('settings.getStartAtLogin'),
    setStartAtLogin: invoke('settings.setStartAtLogin'),
    getAutoAnswer: invoke('settings.getAutoAnswer'), // T21
    setAutoAnswer: invoke('settings.setAutoAnswer'),
    getAutoCleanWorktrees: invoke('settings.getAutoCleanWorktrees'),
    setAutoCleanWorktrees: invoke('settings.setAutoCleanWorktrees'),
    getAlertSound: invoke('settings.getAlertSound'), // W6-B
    setAlertSound: invoke('settings.setAlertSound'),
    getAutoCloseEndedPlanTabs: invoke('settings.getAutoCloseEndedPlanTabs'), // W7-F (#84)
    setAutoCloseEndedPlanTabs: invoke('settings.setAutoCloseEndedPlanTabs'),
    getTabSummaries: invoke('settings.getTabSummaries'), // W9-I
    setTabSummaries: invoke('settings.setTabSummaries'),
    setMaxConcurrentWorkers: invoke('settings.setMaxConcurrentWorkers'),
    setHeavyJobsAtOnce: invoke('settings.setHeavyJobsAtOnce'),
    // W6-G
    getMaxSubagentsPerSession: invoke('settings.getMaxSubagentsPerSession'),
    setMaxSubagentsPerSession: invoke('settings.setMaxSubagentsPerSession'),
    getUsagePauseAt: invoke('settings.getUsagePauseAt'),
    setUsagePauseAt: invoke('settings.setUsagePauseAt'),
    getAccountMaxSessions: invoke('settings.getAccountMaxSessions'), // T5b
    setAccountMaxSessions: invoke('settings.setAccountMaxSessions'),
    getAutoLimits: invoke('settings.getAutoLimits'), // T6
    restoreAutoLimits: invoke('settings.restoreAutoLimits'),
    getDesktopNotify: invoke('settings.getDesktopNotify'),
    setDesktopNotify: invoke('settings.setDesktopNotify'),
    getGenerator: invoke('settings.getGenerator'),
    setGenerator: invoke('settings.setGenerator'),
    getRoleModels: invoke('settings.getRoleModels'),
    setRoleModels: invoke('settings.setRoleModels'),
    getVoice: invoke('settings.getVoice'),
    setVoice: invoke('settings.setVoice'),
    listModels: invoke('settings.listModels'),
    getResumeStrategy: invoke('settings.getResumeStrategy'),
    setResumeStrategy: invoke('settings.setResumeStrategy'),
    getAgentPermissionMode: invoke('settings.getAgentPermissionMode'),
    setAgentPermissionMode: invoke('settings.setAgentPermissionMode'),
    getMcpAccess: invoke('settings.getMcpAccess'),
    setMcpAccess: invoke('settings.setMcpAccess'),
    getMcpSessions: invoke('settings.getMcpSessions'),
    setMcpSessions: invoke('settings.setMcpSessions'),
    getMcpGithubWrite: invoke('settings.getMcpGithubWrite'),
    setMcpGithubWrite: invoke('settings.setMcpGithubWrite'),
    getGithubDefaults: invoke('settings.getGithubDefaults'),
    setGithubDefaults: invoke('settings.setGithubDefaults'),
    getMcpHttp: invoke('settings.getMcpHttp'),
    setMcpHttp: invoke('settings.setMcpHttp'),
    getJobContinuityEnabled: invoke('settings.getJobContinuityEnabled'),
    setJobContinuityEnabled: invoke('settings.setJobContinuityEnabled'),
    getTerminalFont: invoke('settings.getTerminalFont'),
    setTerminalFont: invoke('settings.setTerminalFont'),
    getTheme: invoke('settings.getTheme'),
    setTheme: invoke('settings.setTheme'),
    getFirstRunAsked: invoke('settings.getFirstRunAsked'),
    markFirstRunAsked: invoke('settings.markFirstRunAsked'),
    getOnboardingStep: invoke('settings.getOnboardingStep'),
    setOnboardingStep: invoke('settings.setOnboardingStep'),
    takeRecoveryNotice: invoke('settings.takeRecoveryNotice'),
    getDefaultSessionKind: invoke('settings.getDefaultSessionKind'),
    setDefaultSessionKind: invoke('settings.setDefaultSessionKind'),
    getUpdateMode: invoke('settings.getUpdateMode'),
    setUpdateMode: invoke('settings.setUpdateMode'),
    getUpdateChannel: invoke('settings.getUpdateChannel'),
    setUpdateChannel: invoke('settings.setUpdateChannel')
  },
  files: {
    list: invoke('files.list'),
    read: invoke('files.read'),
    readDataUrl: invoke('files.readDataUrl'),
    write: invoke('files.write'),
    watch: invoke('files.watch'),
    unwatch: invoke('files.unwatch'),
    create: invoke('files.create'),
    rename: invoke('files.rename'),
    move: invoke('files.move'),
    remove: invoke('files.remove'),
    copy: invoke('files.copy'),
    importExternal: invoke('files.importExternal'),
    pathForFile: (file: File) => webUtils.getPathForFile(file),
    savePasted: invoke('files.savePasted'),
    reveal: invoke('files.reveal'),
    countEntries: invoke('files.countEntries'),
    resolveLink: invoke('files.resolveLink'),
    openFolder: invoke('files.openFolder'),
    admitMedia: invoke('files.admitMedia'),
    index: invoke('files.index')
  },
  media: {
    stat: invoke('media.stat'),
    openExternal: invoke('media.openExternal'),
    reveal: invoke('media.reveal')
  },
  git: {
    status: invoke('git.status'),
    watch: invoke('git.watch'),
    unwatch: invoke('git.unwatch'),
    fileDiff: invoke('git.fileDiff')
  },
  run: {
    list: invoke('run.list'),
    listActive: invoke('run.listActive'),
    start: invoke('run.start'),
    runFile: invoke('run.runFile'),
    stop: invoke('run.stop'),
    dismiss: invoke('run.dismiss'),
    output: invoke('run.output'),
    replay: invoke('run.replay'),
    resolveLink: invoke('run.resolveLink'),
    write: fire('run.write'),
    resize: fire('run.resize'),
    saveConfigs: invoke('run.saveConfigs'),
    listJdks: invoke('run.listJdks'),
    listPythonInterpreters: invoke('run.listPythonInterpreters'),
    listComposeServices: invoke('run.listComposeServices'),
    listDotnetProjects: invoke('run.listDotnetProjects')
  },
  terminal: {
    open: invoke('terminal.open'),
    list: invoke('terminal.list'),
    write: fire('terminal.write'),
    resize: fire('terminal.resize'),
    close: invoke('terminal.close')
  },
  system: {
    pickFolder: invoke('system.pickFolder'),
    pickFile: invoke('system.pickFile'),
    pathExists: invoke('system.pathExists'),
    checkCli: invoke('system.checkCli'),
    checkCliInstalled: invoke('system.checkCliInstalled'),
    checkTools: invoke('system.checkTools'),
    installCli: invoke('system.installCli'),
    relaunch: invoke('system.relaunch'),
    appVersion: invoke('system.appVersion'),
    // fire — 메인이 답할 것이 없고, 렌더러도 기다릴 것이 없다. 한 방향의 신고다.
    rendererReady: fire('system.rendererReady'),
    homeDir: invoke('system.homeDir'),
    openExternal: invoke('system.openExternal')
  },
  preview: {
    toggleDevTools: invoke('preview.toggleDevTools'),
    emulate: invoke('preview.emulate'),
    captureElement: invoke('preview.captureElement'),
    registerAgentGuest: invoke('preview.registerAgentGuest'),
    unregisterAgentGuest: invoke('preview.unregisterAgentGuest'),
    agentStop: invoke('preview.agentStop')
  },
  clipboard: {
    readText: () => clipboard.readText(),
    writeText: (text: string) => clipboard.writeText(text),
    // Chromium maps a Windows CF_HDROP (and the mac/linux equivalent) onto this format name. It is
    // the presence that is usable, not the content: reading the format back gives an empty buffer.
    hasFiles: () => clipboard.availableFormats().includes('text/uri-list'),
    requestFilePaste: invoke('clipboard.requestFilePaste'),
    writeFiles: invoke('clipboard.writeFiles')
  },
  update: {
    onStatus: (cb: (s: UpdateStatus) => void) => {
      const l = (_e: unknown, s: UpdateStatus): void => cb(s)
      ipcRenderer.on('update:status', l)
      return (): void => {
        ipcRenderer.removeListener('update:status', l)
      }
    },
    onCampaign: (cb: (c: UpdateCampaignInfo) => void) => {
      const l = (_e: unknown, c: UpdateCampaignInfo): void => cb(c)
      ipcRenderer.on('update:campaign', l)
      return (): void => {
        ipcRenderer.removeListener('update:campaign', l)
      }
    },
    campaignState: () => ipcRenderer.invoke('update:campaignState'),
    dismissCampaign: (id: string) => ipcRenderer.invoke('update:dismissCampaign', id),
    current: () => ipcRenderer.invoke('update:status'),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    justUpdated: () => ipcRenderer.invoke('update:justUpdated')
  } as UpdateApi & JustUpdatedApi,
  rolling: {
    forceRoll: invoke('rolling.forceRoll'),
    state: invoke('rolling.state'),
    switchTo: invoke('rolling.switchTo')
  },
  app: {
    // The 'quit app' of the forced-update gate. win.close cannot be used: on win32/macOS it only minimises to the tray
    quit: () => ipcRenderer.send('app.quit'),
    quitEndingSessions: () => ipcRenderer.send('app.quitEndingSessions'),
    licenses: invoke('app.licenses') // T28
  },
  keys: {
    get: invoke('keys.get'),
    set: invoke('keys.set'),
    reset: invoke('keys.reset')
  },
  orch: {
    list: invoke('orch.list'),
    // W5-C: a project's snapshot without taking over the Jobs view's subscription
    peek: invoke('orch.peek'),
    /** The Host gate, read once at mount. **Its own door rather than a field on the snapshot** —
     *  the list call is only ever made with a project open, and the state that needs this most is the one
     *  with none (ruling F41). Changes arrive on the 'orch:host' event. */
    hostGate: invoke('orch.hostGate'),
    runDetail: invoke('orch.runDetail'),
    completion: invoke('orch.completion'),
    command: invoke('orch.command'),
    // W3-A: the activity feed, a page after a cursor, and its summary since a time
    activity: invoke('orch.activity'),
    activitySummary: invoke('orch.activitySummary'),
    unwatch: invoke('orch.unwatch')
  },
  plugins: {
    list: invoke('plugins.list'),
    inspect: invoke('plugins.inspect'),
    install: invoke('plugins.install'),
    setEnabled: invoke('plugins.setEnabled'),
    remove: invoke('plugins.remove'),
    logs: invoke('plugins.logs'),
    settings: invoke('plugins.settings'),
    configure: invoke('plugins.configure')
  },
  // The Jobs view's "+ From a source" (plugin Phase 4c): the Host's job sources, through main's sources route
  sources: {
    list: invoke('sources.list'),
    items: invoke('sources.items'),
    show: invoke('sources.show'),
    create: invoke('sources.create')
  },
  remote: {
    list: invoke('remote.list'),
    add: invoke('remote.add'),
    remove: invoke('remote.remove'),
    ping: invoke('remote.ping'),
    projects: invoke('remote.projects'),
    thisMachine: invoke('remote.thisMachine'),
    addresses: invoke('remote.addresses'),
    start: invoke('remote.start'),
    stop: invoke('remote.stop'),
    pair: invoke('remote.pair'),
    revoke: invoke('remote.revoke'),
    addMachine: invoke('remote.addMachine'),
    onMachineProgress: (cb: (p: MachineProgress) => void) => {
      const l = (_e: unknown, p: MachineProgress): void => cb(p)
      ipcRenderer.on('remote:machineProgress', l)
      return (): void => {
        ipcRenderer.removeListener('remote:machineProgress', l)
      }
    },
    // T12c
    migrationMachines: invoke('remote.migrationMachines'),
    migratePlan: invoke('remote.migratePlan'),
    migrate: invoke('remote.migrate'),
    onMigrateProgress: (cb: (p: MigrateItemResult & { runtimeId: string }) => void) => {
      const l = (_e: unknown, p: MigrateItemResult & { runtimeId: string }): void => cb(p)
      ipcRenderer.on('remote:migrateProgress', l)
      return (): void => {
        ipcRenderer.removeListener('remote:migrateProgress', l)
      }
    },
    // Found on your network
    discover: () => ipcRenderer.invoke('remote.discover'),
    onFound: (cb: (found: FoundDevice[]) => void) => {
      const l = (_e: unknown, found: FoundDevice[]): void => cb(found)
      ipcRenderer.on('remote:found', l)
      return (): void => {
        ipcRenderer.removeListener('remote:found', l)
      }
    }
  },
  remoteSessions: {
    attach: invoke('remoteSessions.attach'),
    detach: invoke('remoteSessions.detach')
  },
  understanding: {
    get: invoke('understanding.get'),
    regenerate: invoke('understanding.regenerate')
  },
  sessionTasks: {
    list: invoke('sessionTasks.list'),
    complete: invoke('sessionTasks.complete'),
    cancel: invoke('sessionTasks.cancel')
  },
  host: {
    status: invoke('host.status'),
    /** Every change of the Host's status, as it happens. The row also polls, but a Host that stops
     *  answering is news a person is waiting for right then — they are looking at the screen because
     *  a session did not open — and a poll would leave them reading a stale "connected" for up to
     *  half a minute (docs/2026-09-22-host-unresponsive-recovery-design.md F1). */
    onStatus: (cb: (s: HostStatus) => void) => {
      const l = (_e: unknown, s: HostStatus): void => cb(s)
      ipcRenderer.on('host:status', l)
      return (): void => {
        ipcRenderer.removeListener('host:status', l)
      }
    },
    /** The Host runtime's install, as the status bar shows it (stage 3 task 2). */
    runtimeInstall: invoke('host.runtimeInstall'),
    onRuntimeInstall: (cb: (s: HostRuntimeInstallState) => void) => {
      const l = (_e: unknown, s: HostRuntimeInstallState): void => cb(s)
      ipcRenderer.on('host:runtime-install', l)
      return (): void => {
        ipcRenderer.removeListener('host:runtime-install', l)
      }
    },
    sessionsOutlivingApp: invoke('host.sessionsOutlivingApp'),
    survivesUpdate: invoke('host.survivesUpdate'),
    replace: invoke('host.replace'),
    driver: invoke('host.driver'),
    holdings: invoke('host.holdings')
  },
  workspace: {
    list: invoke('workspace.list'),
    stop: invoke('workspace.stop'),
    close: invoke('workspace.close'),
    size: invoke('workspace.size')
  },
  conversation: {
    open: invoke('conversation.open'),
    more: invoke('conversation.more'),
    close: invoke('conversation.close'),
    pause: invoke('conversation.pause'),
    attention: invoke('conversation.attention'),
    pendingPrompt: invoke('conversation.pendingPrompt'),
    lastReply: invoke('conversation.lastReply'),
    model: invoke('conversation.model'),
    models: invoke('conversation.models'),
    attach: invoke('conversation.attach'),
    commands: invoke('conversation.commands'),
    files: invoke('conversation.files')
  },
  // A chat session talks to its adapter through these; everything it hears back arrives on the one
  // 'chat:event' channel above, not as a return value (chat-sessions design §6).
  chat: {
    send: invoke('chat.send'),
    interrupt: invoke('chat.interrupt'),
    answer: invoke('chat.answer'),
    setModel: invoke('chat.setModel'),
    setPermissionMode: invoke('chat.setPermissionMode'),
    // chat takeover P8: the session's unattended permission policy.
    setUnattendedPermission: invoke('chat.setUnattendedPermission'),
    listPermissionModes: invoke('chat.listPermissionModes'),
    listModels: invoke('chat.listModels'),
    configuredModel: invoke('chat.configuredModel'),
    state: invoke('chat.state'),
    retryWithBypass: invoke('chat.retryWithBypass')
  },
  platform: process.platform,
  // T27
  crash: {
    report: invoke('crash.report'),
    pending: invoke('crash.pending'),
    send: invoke('crash.send')
  },
  win: {
    minimize: () => ipcRenderer.send('win.minimize'),
    maximizeToggle: () => ipcRenderer.send('win.maximizeToggle'),
    close: () => ipcRenderer.send('win.close'),
    isMaximized: () => ipcRenderer.invoke('win.isMaximized'),
    onMaximizeChange: (cb) => {
      const l = (_e: unknown, isMax: boolean): void => cb(isMax)
      ipcRenderer.on('win:maximized', l)
      return () => ipcRenderer.removeListener('win:maximized', l)
    },
    // W9-K
    boundProject: () => ipcRenderer.invoke('win.boundProject'),
    setScope: (scope) => ipcRenderer.send('win.setScope', scope),
    openNew: (projectId) => ipcRenderer.send('win.openNew', projectId)
  },
  on<C extends CoreEventChannel>(channel: C, cb: (payload: CoreEvents[C]) => void): () => void {
    if (!EVENT_CHANNELS.includes(channel)) throw new Error(`unknown event channel: ${channel}`)
    const listener = (_e: unknown, payload: CoreEvents[C]): void => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
} satisfies RendererApi

contextBridge.exposeInMainWorld('api', api)
