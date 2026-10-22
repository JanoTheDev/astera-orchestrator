// `astera runtime setup` (plan decision 14): one command makes this machine an Astera Runtime, with no app window. It
// checks and installs git and the vendor CLIs, installs the `astera` command, writes the keep-alive service from the OS
// recipes in docs/remote-runtime.md, starts Remote Runtime on a private address and prints one pairing string.
//
// Idempotent: every step looks first, and a step whose result is already there is `skipped`. What it decides is a pure
// function of what it found (`planSetup`), so each platform's plan is tested without installing anything; everything it
// does to the machine comes through `SetupDeps`.
import type { HostCommandResult } from '../host'
import type { CliError } from '../../core/orchestration/cliOutput'
import { addUserPathCommand, installCommandFor, unpathedInstallDir, type InstallableCli } from '../../core/install/cliInstall'

export type StepId = 'git' | 'node' | 'claude' | 'codex' | 'cli' | 'service' | 'runtime'
export type StepStatus = 'ok' | 'skipped' | 'failed'

export interface StepResult {
  id: StepId
  status: StepStatus
  reason: string
}

/** A command already split, never a string for a shell to re-parse. */
export interface Cmd {
  command: string
  args: string[]
}

export interface SetupOptions {
  listen?: string
  tailscale: boolean
  name?: string
  fullControl: boolean
  /** Install what is missing without asking; without it a missing package is a failed step that names the command. */
  yes: boolean
  codex: boolean
}

/** What setup found on this machine before doing anything. */
export interface SetupProbes {
  platform: NodeJS.Platform
  git: boolean
  claude: boolean
  codex: boolean
  /** apt-get on Linux, winget on Windows. */
  packageManager: boolean
  /** shuttleSyncPlan's answer for the public `astera` command. */
  shim: 'current' | 'not-installed' | 'rewrite' | 'foreign'
  /** The keep-alive is installed exactly as setup would write it, and enabled. */
  service: boolean
  /** Remote Runtime is on, listening on the chosen address, and its Gateway is ready. */
  runtimeReady: boolean
}

/** One step of the plan: something to do, or a result decided without doing anything. */
export type PlannedStep = { id: StepId; run: Cmd[]; reason: string } | StepResult

export const isResult = (s: PlannedStep): s is StepResult => 'status' in s

const EVERYWHERE = new Set(['0.0.0.0', '::', '[::]'])

/**
 * The address the Runtime listens on: `--listen`, else this machine's Tailscale IPv4, else its one private LAN address.
 * Never every interface (docs: do not open the port beyond a private network), and never a guess between several.
 */
export function chooseListen(o: {
  listen?: string
  tailscale: boolean
  tailscaleIp: string | null
  lan: string[]
}): { address: string; via: 'listen' | 'tailscale' | 'lan' } | { error: string } {
  if (o.listen !== undefined && o.tailscale) return { error: 'give --listen or --tailscale, not both' }
  if (o.listen !== undefined) {
    const a = o.listen.trim()
    if (a === '') return { error: '--listen needs an address' }
    if (EVERYWHERE.has(a)) return { error: `setup does not listen on every interface (${a}); name one private address with --listen` }
    return { address: a, via: 'listen' }
  }
  if (o.tailscaleIp) return { address: o.tailscaleIp, via: 'tailscale' }
  if (o.tailscale) return { error: '--tailscale was given but `tailscale ip -4` named no address; is Tailscale up?' }
  const lan = [...new Set(o.lan)]
  if (lan.length === 1) return { address: lan[0], via: 'lan' }
  if (lan.length === 0) return { error: 'this machine has no private network address; give one with --listen, or bring Tailscale up' }
  return { error: `this machine has several private addresses (${lan.join(', ')}); choose one with --listen` }
}

const sudo = (uid: number | null, c: Cmd): Cmd => (uid === 0 ? c : { command: 'sudo', args: [c.command, ...c.args] })
const spoken = (cmds: Cmd[]): string => cmds.map((c) => [c.command, ...c.args].join(' ')).join(' && ')

/** How this platform installs git, or null where setup does not install it. */
export function gitInstall(platform: NodeJS.Platform, uid: number | null): Cmd[] | null {
  if (platform === 'linux')
    return [sudo(uid, { command: 'apt-get', args: ['update'] }), sudo(uid, { command: 'apt-get', args: ['install', '-y', 'git'] })]
  if (platform === 'win32')
    return [
      {
        command: 'winget',
        args: ['install', '--id', 'Git.Git', '-e', '--source', 'winget', '--silent', '--accept-package-agreements', '--accept-source-agreements']
      }
    ]
  return null
}

/** The vendor's documented installer; on Windows the folder Claude's installer leaves off PATH goes on the user Path,
 *  or the logon task, which reads that Path, would not find `claude`. */
const vendorInstall = (cli: InstallableCli, platform: NodeJS.Platform, home: string): Cmd[] | null => {
  const c = installCommandFor(cli, platform)
  if (!c) return null
  const dir = platform === 'win32' ? unpathedInstallDir(cli, platform, home) : null
  const path = dir ? addUserPathCommand(dir) : null
  return [{ command: c.command, args: c.args }, ...(path ? [{ command: path.command, args: path.args }] : [])]
}

/**
 * What setup does on this machine, from what it found. A step whose result is there is `skipped`; one setup may not or
 * cannot do is `failed` with the reason and the command to run by hand; the rest carry the commands to run. The `cli`,
 * `service` and `runtime` steps carry no commands: the runner does them itself.
 */
export function planSetup(p: SetupProbes, o: SetupOptions, m: { uid: number | null; home: string }): PlannedStep[] {
  const pkg = (id: StepId, present: boolean, install: Cmd[] | null, what: string): PlannedStep => {
    if (present) return { id, status: 'skipped', reason: `${what} is installed` }
    if (!install) return { id, status: 'failed', reason: `${what} is missing and setup cannot install it on ${p.platform}; install it and run setup again` }
    if (!o.yes) return { id, status: 'failed', reason: `${what} is missing; run \`${spoken(install)}\` or run setup again with --yes` }
    return { id, run: install, reason: `installing ${what}` }
  }
  const gitCmds = gitInstall(p.platform, m.uid)
  const steps: PlannedStep[] = [
    pkg('git', p.git, gitCmds && p.packageManager ? gitCmds : null, 'git'),
    // The Host runs on Astera's own runtime: the app's binary as Node on Linux and macOS, the bundled node.exe on
    // Windows (src/core/host/spawn.ts, ELECTRON_RUN_AS_NODE). Nothing here needs a Node of the machine's own.
    { id: 'node', status: 'skipped', reason: "not needed: the Host runs on Astera's own runtime" },
    pkg('claude', p.claude, vendorInstall('claude', p.platform, m.home), 'the Claude CLI'),
    o.codex ? pkg('codex', p.codex, vendorInstall('codex', p.platform, m.home), 'the Codex CLI') : { id: 'codex', status: 'skipped', reason: 'not asked for (--codex)' }
  ]
  steps.push(
    p.shim === 'current'
      ? { id: 'cli', status: 'skipped', reason: 'the astera command is installed' }
      : p.shim === 'foreign'
        ? { id: 'cli', status: 'failed', reason: 'an astera command that is not Astera’s is in the way; remove it and run setup again' }
        : { id: 'cli', run: [], reason: p.shim === 'rewrite' ? 'pointing the astera command at this install' : 'installing the astera command' }
  )
  const cliFails = p.shim === 'foreign'
  steps.push(
    p.service && p.shim === 'current'
      ? { id: 'service', status: 'skipped', reason: 'the keep-alive service is installed' }
      : cliFails
        ? { id: 'service', status: 'failed', reason: 'the keep-alive service runs the astera command, which could not be installed' }
        : { id: 'service', run: [], reason: 'installing the keep-alive service' }
  )
  steps.push(p.runtimeReady ? { id: 'runtime', status: 'skipped', reason: 'Remote Runtime is on at this address' } : { id: 'runtime', run: [], reason: 'starting Remote Runtime' })
  return steps
}

// ---- The keep-alive service, generated from the recipes in docs/remote-runtime.md ("Keep it running: OS recipes").

export interface KeepAlive {
  /** The file setup writes. */
  file: string
  content: string
  /** Run in order after the file is written; each must exit 0 unless it is marked `tolerate`. */
  install: Array<Cmd & { tolerate?: true }>
  /** All exit 0 when the service is enabled. */
  check: Cmd[]
}

export const SYSTEMD_UNIT = 'astera-runtime'
export const WINDOWS_TASK = 'Astera Runtime'
export const LAUNCH_AGENT = 'run.astera.runtime'

/** The systemd user unit. A user unit reads no shell profile, so PATH names the folders `astera` and `claude` are in. */
export function systemdUnit(o: { binDir: string }): string {
  return [
    '[Unit]',
    'Description=Astera Runtime',
    '',
    '[Service]',
    `ExecStart="${o.binDir}/astera" runtime serve`,
    'Restart=on-failure',
    'RestartSec=5',
    `Environment="PATH=${o.binDir}:/usr/local/bin:/usr/bin:/bin"`,
    '',
    '[Install]',
    'WantedBy=default.target',
    ''
  ].join('\n')
}

/** The PowerShell loop the logon task runs: waits out an update's hold, restarts `serve` after any exit but 0 and 78. */
export function windowsServeScript(o: { binDir: string; profileDir: string }): string {
  const q = (s: string): string => `'${s.replace(/'/g, "''")}'`
  return [
    `param([string]$Astera = ${q(`${o.binDir}\\astera.cmd`)}, [string]$Hold = ${q(`${o.profileDir}\\host\\update-hold`)})`,
    'while ($true) {',
    "  # An update in progress: start nothing until its hold ends, so no file of the old version is held.",
    '  if (Test-Path $Hold) {',
    '    $until = (Get-Content $Hold -Raw | ConvertFrom-Json).until',
    '    if ($until -gt [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) { Start-Sleep 10; continue }',
    '  }',
    "  # Astera's command line is gone (uninstalled, or turned off in Settings): stop rather than retry.",
    '  if (-not (Test-Path $Astera)) { exit 1 }',
    '  & $Astera runtime serve',
    '  # 0: stopped on purpose. 78: a configuration no restart changes. Anything else (75 after an update, a crash): again.',
    '  if ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq 78) { exit $LASTEXITCODE }',
    '  Start-Sleep 5',
    '}',
    ''
  ].join('\r\n')
}

/** The Task Scheduler registration for the script: at logon, for this user, no time limit, no window. `-Force` makes a
 *  second run replace the task rather than fail. */
export function windowsTaskRegistration(o: { script: string; user: string }): string {
  const q = (s: string): string => `'${s.replace(/'/g, "''")}'`
  return [
    `$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + ${q(o.script)} + '"')`,
    `$trigger = New-ScheduledTaskTrigger -AtLogOn -User ${q(o.user)}`,
    '$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries',
    `Register-ScheduledTask -TaskName ${q(WINDOWS_TASK)} -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null`,
    `Start-ScheduledTask -TaskName ${q(WINDOWS_TASK)}`
  ].join('; ')
}

const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function launchAgentPlist(o: { binDir: string }): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    `  <key>Label</key><string>${LAUNCH_AGENT}</string>`,
    '  <key>ProgramArguments</key>',
    `  <array><string>${xml(o.binDir)}/astera</string><string>runtime</string><string>serve</string></array>`,
    '  <key>EnvironmentVariables</key>',
    `  <dict><key>PATH</key><string>${xml(o.binDir)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>`,
    '  <key>RunAtLoad</key><true/>',
    '  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>',
    '</dict>',
    '</plist>',
    ''
  ].join('\n')
}

/** This platform's keep-alive: the file, how to enable it, how to tell it is enabled. Null where there is no recipe. */
export function keepAliveFor(o: {
  platform: NodeJS.Platform
  home: string
  binDir: string
  profileDir: string
  user: string
  uid: number | null
  localAppData?: string
}): KeepAlive | null {
  if (o.platform === 'linux') {
    const svc = `${SYSTEMD_UNIT}.service`
    return {
      file: `${o.home}/.config/systemd/user/${svc}`,
      content: systemdUnit(o),
      install: [
        // Linger first: it starts the user's systemd, which `systemctl --user` needs on a machine nobody is logged in to,
        // and it keeps the unit running across reboots with no one logged in.
        { command: 'loginctl', args: ['enable-linger', o.user] },
        { command: 'systemctl', args: ['--user', 'daemon-reload'] },
        { command: 'systemctl', args: ['--user', 'enable', svc] },
        { command: 'systemctl', args: ['--user', 'restart', svc] }
      ],
      check: [
        { command: 'test', args: ['-e', `/var/lib/systemd/linger/${o.user}`] },
        { command: 'systemctl', args: ['--user', 'is-enabled', '--quiet', svc] }
      ]
    }
  }
  if (o.platform === 'win32') {
    const script = `${(o.localAppData ?? `${o.home}\\AppData\\Local`).replace(/[\\/]+$/, '')}\\astera\\runtime-serve.ps1`
    const ps = (line: string): Cmd => ({ command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', line] })
    return {
      file: script,
      content: windowsServeScript(o),
      install: [ps(windowsTaskRegistration({ script, user: o.user }))],
      check: [ps(`Get-ScheduledTask -TaskName '${WINDOWS_TASK}' -ErrorAction Stop | Out-Null`)]
    }
  }
  if (o.platform === 'darwin') {
    const domain = `gui/${o.uid ?? 0}`
    const file = `${o.home}/Library/LaunchAgents/${LAUNCH_AGENT}.plist`
    return {
      file,
      content: launchAgentPlist(o),
      install: [
        // A loaded agent is unloaded first so the new file is read; none loaded is not an error.
        { command: 'launchctl', args: ['bootout', `${domain}/${LAUNCH_AGENT}`], tolerate: true },
        { command: 'launchctl', args: ['bootstrap', domain, file] }
      ],
      check: [{ command: 'launchctl', args: ['print', `${domain}/${LAUNCH_AGENT}`] }]
    }
  }
  return null
}

// ---- The runner.

export interface SetupDeps {
  platform: NodeJS.Platform
  /** Run inside an agent session Astera started (`ASTERA_SESSION` is set; security audit SEC-10). */
  agentSession: boolean
  uid: number | null
  home: string
  hostname(): string
  tailscaleIp(): Promise<string | null>
  lanAddresses(): string[]
  /** Everything else `SetupProbes` holds, for the chosen address. */
  probe(address: string): Promise<SetupProbes>
  /** Runs one command with its output on stderr; its exit code (127 when it could not start). */
  exec(c: Cmd): Promise<number>
  /** Installs the public `astera` command (Settings › Integrations › CLI's code). */
  installCli(): Promise<void>
  /** Writes the keep-alive file and enables it; throws with the reason. */
  installService(): Promise<void>
  /** One `astera runtime ...` command (commands.ts). */
  runtime(cmd: 'runtime-start' | 'runtime-pair', args: Record<string, unknown>): Promise<HostCommandResult>
  log(line: string): void
}

const failure = (code: CliError['code'], message: string, details?: Record<string, unknown>): HostCommandResult => ({
  ok: false,
  error: { code, message, ...(details ? { details } : {}) }
})

const reasonOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export async function runSetup(o: SetupOptions, d: SetupDeps): Promise<HostCommandResult> {
  // Before anything is looked at or installed: opening this machine to the network is a person's call (SEC-10).
  if (d.agentSession)
    return failure('PERMISSION_DENIED', 'astera runtime setup is for a person at their own shell, not an agent session (ASTERA_SESSION is set)')
  // The address is checked before any install: a refused address must not leave half a setup behind.
  const tailscaleIp = o.listen === undefined ? await d.tailscaleIp() : null
  const chosen = chooseListen({ listen: o.listen, tailscale: o.tailscale, tailscaleIp, lan: d.lanAddresses().filter((a) => a !== tailscaleIp) })
  if ('error' in chosen) return failure('INVALID_ARGUMENTS', chosen.error)
  const plan = planSetup(await d.probe(chosen.address), o, { uid: d.uid, home: d.home })
  const results: StepResult[] = []
  for (const step of plan) {
    let r: StepResult
    if (isResult(step)) r = step
    else {
      d.log(`${step.id}: ${step.reason}`)
      r = await runStep(step, chosen.address, d).catch((e: unknown): StepResult => ({ id: step.id, status: 'failed', reason: reasonOf(e) }))
    }
    results.push(r)
    d.log(`${r.id}: ${r.status} (${r.reason})`)
  }
  const failed = results.filter((s) => s.status === 'failed')
  if (failed.length > 0)
    return failure('FAILED', `setup did not finish: ${failed.map((s) => `${s.id} (${s.reason})`).join('; ')}`, { steps: results })
  const pair = await d.runtime('runtime-pair', o.fullControl ? { fullControl: true } : {})
  if (!pair.ok) return failure(pair.error.code, `the Runtime is set up, but no pairing string could be made: ${pair.error.message}`, { steps: results })
  return {
    ok: true,
    body: {
      steps: results,
      pairing: pair.body.pairing,
      name: o.name ?? d.hostname(),
      os: d.platform,
      address: pair.body.address,
      via: chosen.via,
      port: pair.body.port,
      fingerprint: pair.body.fingerprint,
      expiresAt: pair.body.expiresAt,
      permission: pair.body.permission
    }
  }
}

async function runStep(step: Exclude<PlannedStep, StepResult>, address: string, d: SetupDeps): Promise<StepResult> {
  const ok = (reason: string): StepResult => ({ id: step.id, status: 'ok', reason })
  switch (step.id) {
    case 'cli':
      await d.installCli()
      return ok('installed')
    case 'service':
      await d.installService()
      return ok('installed and started')
    case 'runtime': {
      const r = await d.runtime('runtime-start', { listen: address })
      return r.ok ? ok(`listening on ${address}`) : { id: 'runtime', status: 'failed', reason: r.error.message }
    }
    default:
      for (const c of step.run) {
        const code = await d.exec(c)
        if (code !== 0) return { id: step.id, status: 'failed', reason: `\`${spoken([c])}\` exited with ${code}` }
      }
      return ok('installed')
  }
}

/** `runtime setup`'s flags, as parseArgs left them. */
export function setupOptionsOf(args: Record<string, unknown>): SetupOptions {
  return {
    ...(args.listen !== undefined ? { listen: typeof args.listen === 'string' ? args.listen : '' } : {}),
    ...(typeof args.name === 'string' && args.name.trim() !== '' ? { name: args.name.trim() } : {}),
    tailscale: args.tailscale === true,
    fullControl: args.fullControl === true,
    yes: args.yes === true,
    codex: args.codex === true
  }
}
