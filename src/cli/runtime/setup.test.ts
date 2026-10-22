import { describe, expect, it } from 'vitest'
import {
  chooseListen,
  isResult,
  keepAliveFor,
  launchAgentPlist,
  planSetup,
  runSetup,
  setupOptionsOf,
  systemdUnit,
  windowsServeScript,
  windowsTaskRegistration,
  type Cmd,
  type PlannedStep,
  type SetupDeps,
  type SetupOptions,
  type SetupProbes
} from './setup'
import { hostStartTargets } from '../host'
import { hostSpawnPlan } from '../../core/host/spawn'
import { shuttleFiles } from '../../core/orchestration/exec/shuttle'

const opts = (o: Partial<SetupOptions> = {}): SetupOptions => ({ tailscale: false, fullControl: false, yes: true, codex: false, ...o })
const ready = (platform: NodeJS.Platform, o: Partial<SetupProbes> = {}): SetupProbes => ({
  platform,
  git: true,
  claude: true,
  codex: true,
  packageManager: true,
  shim: 'current',
  service: true,
  runtimeReady: true,
  ...o
})
const bare = (platform: NodeJS.Platform): SetupProbes =>
  ready(platform, { git: false, claude: false, codex: false, shim: 'not-installed', service: false, runtimeReady: false })
const machine = { uid: 1000, home: '/home/me' }
const step = (plan: PlannedStep[], id: string): PlannedStep => plan.find((s) => s.id === id)!
const cmds = (s: PlannedStep): string[] => (isResult(s) ? [] : s.run.map((c) => [c.command, ...c.args].join(' ')))

describe('planSetup: the steps per OS, from what was found', () => {
  it('a second run on a machine that has everything is all skipped', () => {
    for (const p of ['linux', 'win32', 'darwin'] as const) {
      const plan = planSetup(ready(p), opts({ codex: true }), machine)
      expect(plan.map((s) => s.id)).toEqual(['git', 'node', 'claude', 'codex', 'cli', 'service', 'runtime'])
      expect(plan.every((s) => isResult(s) && s.status === 'skipped'), p).toBe(true)
    }
  })

  it('Ubuntu: git through apt with sudo, Claude through its vendor installer', () => {
    const plan = planSetup(bare('linux'), opts(), machine)
    expect(cmds(step(plan, 'git'))).toEqual(['sudo apt-get update', 'sudo apt-get install -y git'])
    expect(cmds(step(plan, 'claude'))).toEqual(['/bin/sh -c curl -fsSL https://claude.ai/install.sh | bash'])
    for (const id of ['cli', 'service', 'runtime']) expect(isResult(step(plan, id)), id).toBe(false)
  })

  it('as root, apt runs without sudo', () => {
    expect(cmds(step(planSetup(bare('linux'), opts(), { ...machine, uid: 0 }), 'git'))[1]).toBe('apt-get install -y git')
  })

  it('Windows: git through winget; Claude, then its folder on the user Path', () => {
    const plan = planSetup(bare('win32'), opts(), { uid: null, home: 'C:\\Users\\me' })
    expect(cmds(step(plan, 'git'))[0]).toMatch(/^winget install --id Git\.Git -e/)
    const claude = step(plan, 'claude')
    expect(isResult(claude)).toBe(false)
    if (!isResult(claude)) {
      expect(claude.run).toHaveLength(2)
      expect(claude.run[0].args).toContain('irm https://claude.ai/install.ps1 | iex')
      expect(claude.run[1].args.join(' ')).toContain("$d = 'C:\\Users\\me\\.local\\bin'")
    }
  })

  it('macOS: git is a step setup cannot do, and says so', () => {
    const git = step(planSetup(bare('darwin'), opts(), machine), 'git')
    expect(git).toMatchObject({ status: 'failed', reason: expect.stringMatching(/cannot install it on darwin/) })
  })

  it('no apt on Linux: git fails with the reason rather than guessing a package manager', () => {
    expect(step(planSetup({ ...bare('linux'), packageManager: false }, opts(), machine), 'git')).toMatchObject({ status: 'failed' })
  })

  it('without --yes a missing package is a failed step naming the command to run', () => {
    const plan = planSetup(bare('linux'), opts({ yes: false }), machine)
    expect(step(plan, 'claude')).toMatchObject({ status: 'failed', reason: expect.stringContaining('curl -fsSL https://claude.ai/install.sh | bash') })
    expect(step(plan, 'claude')).toMatchObject({ reason: expect.stringContaining('--yes') })
  })

  it('Node is never installed: the Host runs on Astera’s own runtime', () => {
    expect(step(planSetup(bare('linux'), opts(), machine), 'node')).toMatchObject({ status: 'skipped' })
  })

  it('codex only with --codex', () => {
    expect(step(planSetup(bare('linux'), opts(), machine), 'codex')).toMatchObject({ status: 'skipped' })
    expect(cmds(step(planSetup(bare('linux'), opts({ codex: true }), machine), 'codex'))[0]).toContain('chatgpt.com/codex/install.sh')
  })

  it('someone else’s astera command is left alone, and the service that would run it is not installed', () => {
    const plan = planSetup({ ...ready('linux'), shim: 'foreign', service: false }, opts(), machine)
    expect(step(plan, 'cli')).toMatchObject({ status: 'failed' })
    expect(step(plan, 'service')).toMatchObject({ status: 'failed' })
  })

  it('a moved install rewrites the command and the service with it', () => {
    const plan = planSetup({ ...ready('linux'), shim: 'rewrite' }, opts(), machine)
    expect(isResult(step(plan, 'cli'))).toBe(false)
    expect(isResult(step(plan, 'service'))).toBe(false)
  })
})

describe('chooseListen: --listen, else Tailscale, else the one LAN address, never every interface', () => {
  it('Tailscale wins over a LAN address', () => {
    expect(chooseListen({ tailscale: false, tailscaleIp: '100.64.0.5', lan: ['192.168.1.10'] })).toEqual({ address: '100.64.0.5', via: 'tailscale' })
  })
  it('the single LAN address without Tailscale', () => {
    expect(chooseListen({ tailscale: false, tailscaleIp: null, lan: ['192.168.1.10'] })).toEqual({ address: '192.168.1.10', via: 'lan' })
  })
  it('several or none: refused, never a guess', () => {
    expect(chooseListen({ tailscale: false, tailscaleIp: null, lan: ['192.168.1.10', '10.0.0.2'] })).toEqual({ error: expect.stringMatching(/several/) })
    expect(chooseListen({ tailscale: false, tailscaleIp: null, lan: [] })).toEqual({ error: expect.stringMatching(/no private/) })
  })
  it('0.0.0.0 and :: are refused even when asked for', () => {
    for (const listen of ['0.0.0.0', '::'])
      expect(chooseListen({ listen, tailscale: false, tailscaleIp: '100.64.0.5', lan: [] })).toEqual({ error: expect.stringMatching(/every interface/) })
  })
  it('--listen wins; --tailscale with no Tailscale address fails', () => {
    expect(chooseListen({ listen: '10.0.0.2', tailscale: false, tailscaleIp: '100.64.0.5', lan: [] })).toEqual({ address: '10.0.0.2', via: 'listen' })
    expect(chooseListen({ tailscale: true, tailscaleIp: null, lan: ['192.168.1.10'] })).toEqual({ error: expect.stringMatching(/Tailscale/) })
  })
})

describe('the keep-alive service, generated from the docs recipes', () => {
  it('systemd: runs `astera runtime serve`, restarts on failure, PATH names the bin folder', () => {
    expect(systemdUnit({ binDir: '/home/me/.local/bin' })).toBe(
      [
        '[Unit]',
        'Description=Astera Runtime',
        '',
        '[Service]',
        'ExecStart="/home/me/.local/bin/astera" runtime serve',
        'Restart=on-failure',
        'RestartSec=5',
        'Environment="PATH=/home/me/.local/bin:/usr/local/bin:/usr/bin:/bin"',
        '',
        '[Install]',
        'WantedBy=default.target',
        ''
      ].join('\n')
    )
  })

  it('Linux enables linger first, then the user unit', () => {
    const k = keepAliveFor({ platform: 'linux', home: '/home/me', binDir: '/home/me/.local/bin', profileDir: '/home/me/.config/astera', user: 'me', uid: 1000 })!
    expect(k.file).toBe('/home/me/.config/systemd/user/astera-runtime.service')
    expect(k.install.map((c) => [c.command, ...c.args].join(' '))).toEqual([
      'loginctl enable-linger me',
      'systemctl --user daemon-reload',
      'systemctl --user enable astera-runtime.service',
      'systemctl --user restart astera-runtime.service'
    ])
    expect(k.check.map((c) => c.args.join(' '))).toEqual(['-e /var/lib/systemd/linger/me', '--user is-enabled --quiet astera-runtime.service'])
  })

  it('Task Scheduler: a logon task for this user, no time limit, replaced on a second run, started now', () => {
    const t = windowsTaskRegistration({ script: "C:\\Users\\o'neil\\AppData\\Local\\astera\\runtime-serve.ps1", user: 'me' })
    expect(t).toContain("New-ScheduledTaskTrigger -AtLogOn -User 'me'")
    expect(t).toContain('-ExecutionTimeLimit ([TimeSpan]::Zero)')
    expect(t).toContain("Register-ScheduledTask -TaskName 'Astera Runtime' -Action $action -Trigger $trigger -Settings $settings -Force")
    expect(t).toContain("Start-ScheduledTask -TaskName 'Astera Runtime'")
    // A quote in the path is doubled, never ends the string.
    expect(t).toContain("'C:\\Users\\o''neil\\AppData\\Local\\astera\\runtime-serve.ps1'")
  })

  it('the Windows loop waits out an update hold and stops at 0 and 78', () => {
    const s = windowsServeScript({ binDir: 'C:\\Users\\me\\AppData\\Local\\astera\\bin', profileDir: 'C:\\Users\\me\\AppData\\Roaming\\astera' })
    expect(s).toContain("[string]$Astera = 'C:\\Users\\me\\AppData\\Local\\astera\\bin\\astera.cmd'")
    expect(s).toContain("[string]$Hold = 'C:\\Users\\me\\AppData\\Roaming\\astera\\host\\update-hold'")
    expect(s).toContain('if ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq 78) { exit $LASTEXITCODE }')
    const k = keepAliveFor({ platform: 'win32', home: 'C:\\Users\\me', binDir: 'x', profileDir: 'y', user: 'me', uid: null, localAppData: 'C:\\Users\\me\\AppData\\Local' })!
    expect(k.file).toBe('C:\\Users\\me\\AppData\\Local\\astera\\runtime-serve.ps1')
  })

  it('macOS: a LaunchAgent kept alive unless it exits 0', () => {
    const p = launchAgentPlist({ binDir: '/Users/me/.local/bin' })
    expect(p).toContain('<array><string>/Users/me/.local/bin/astera</string><string>runtime</string><string>serve</string></array>')
    expect(p).toContain('<key>SuccessfulExit</key><false/>')
  })
})

describe('headless Linux: nothing on the serve path needs a display', () => {
  const env = { PATH: '/usr/bin', HOME: '/home/me' } // no DISPLAY, no WAYLAND_DISPLAY

  it('the Host `serve` starts is the app binary run as Node, with no display handed to it', () => {
    // Linux has no prepared runtime: the Host is host.js beside cli.js on this CLI's own executable.
    const t = hostStartTargets({ cliEntry: '/opt/Astera/resources/app.asar/out/main/cli.js', execPath: '/opt/Astera/astera', profileDir: '/home/me/.config/astera', version: '1' })
    expect(t.candidates).toEqual(['/opt/Astera/resources/app.asar/out/main/host.js'])
    const plan = hostSpawnPlan({ execPath: t.execPathFor(t.candidates[0]), entryPath: t.candidates[0], profileDir: '/home/me/.config/astera', logPath: t.logPath, version: '1', env })
    expect(plan.command).toBe('/opt/Astera/astera')
    expect(plan.args).toEqual(['/opt/Astera/resources/app.asar/out/main/host.js'])
    expect(plan.options.env.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(plan.options.env.DISPLAY).toBeUndefined()
    expect(plan.options.env.WAYLAND_DISPLAY).toBeUndefined()
  })

  it('the astera command the service runs is the app binary as Node too', () => {
    const [f] = shuttleFiles({ execPath: '/opt/Astera/astera', entryPath: '/opt/Astera/resources/app.asar/out/main/cli.js', platform: 'linux' })
    expect(f.content).toContain('ELECTRON_RUN_AS_NODE=1 exec "/opt/Astera/astera"')
    expect(systemdUnit({ binDir: '/home/me/.local/bin' })).not.toMatch(/DISPLAY/)
  })
})

describe('runSetup', () => {
  /** A machine that installs whatever it is asked and remembers it, so a second run sees the first one's work. */
  const fakeMachine = (o: Partial<SetupDeps> = {}) => {
    const state = bare('linux')
    const ran: string[] = []
    const logs: string[] = []
    const d: SetupDeps = {
      platform: 'linux',
      agentSession: false,
      uid: 1000,
      home: '/home/me',
      hostname: () => 'box',
      tailscaleIp: async () => '100.64.0.5',
      lanAddresses: () => ['192.168.1.10', '100.64.0.5'],
      probe: async () => ({ ...state }),
      exec: async (c: Cmd) => {
        ran.push(c.command)
        if (c.args.includes('git')) state.git = true
        if (c.args.join(' ').includes('claude.ai')) state.claude = true
        return 0
      },
      installCli: async () => void (state.shim = 'current'),
      installService: async () => void (state.service = true),
      runtime: async (cmd, args) => {
        ran.push(cmd)
        if (cmd === 'runtime-start') {
          state.runtimeReady = true
          return { ok: true, body: { listen: args.listen } }
        }
        return { ok: true, body: { pairing: 'astera-pair:v1:100.64.0.5:47831:CODE:FP', address: '100.64.0.5', port: 47831, fingerprint: 'FP', permission: 'read-only' } }
      },
      log: (l) => logs.push(l),
      ...o
    }
    return { d, ran, logs, state }
  }

  it('is refused inside an agent session before it looks at anything', async () => {
    const { d, ran } = fakeMachine({ agentSession: true, probe: async () => { throw new Error('probed') } })
    const r = await runSetup(opts(), d)
    expect(r).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } })
    expect(ran).toEqual([])
  })

  it('refuses every interface before installing anything', async () => {
    const { d, ran } = fakeMachine()
    expect(await runSetup(opts({ listen: '0.0.0.0' }), d)).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENTS' } })
    expect(ran).toEqual([])
  })

  it('first run does every step and pairs on the Tailscale address; the second run skips every step and pairs again', async () => {
    const { d, ran } = fakeMachine()
    const first = await runSetup(opts({ name: 'build-box' }), d)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(ran).toContain('runtime-start')
    expect(first.body).toMatchObject({ pairing: 'astera-pair:v1:100.64.0.5:47831:CODE:FP', name: 'build-box', os: 'linux', address: '100.64.0.5', via: 'tailscale', fingerprint: 'FP' })
    expect((first.body.steps as Array<{ id: string; status: string }>).filter((s) => s.status === 'ok').map((s) => s.id)).toEqual(['git', 'claude', 'cli', 'service', 'runtime'])
    ran.length = 0
    const second = await runSetup(opts(), d)
    expect(second.ok && (second.body.steps as Array<{ status: string }>).every((s) => s.status === 'skipped')).toBe(true)
    expect(ran).toEqual(['runtime-pair'])
  })

  it('a failed step ends it with every step’s result and no pairing string', async () => {
    const { d, ran } = fakeMachine({ exec: async () => 100 })
    const r = await runSetup(opts(), d)
    expect(r).toMatchObject({ ok: false, error: { code: 'FAILED', message: expect.stringMatching(/git/) } })
    if (!r.ok) expect(JSON.stringify(r.error)).not.toContain('astera-pair')
    expect(ran).not.toContain('runtime-pair')
  })

  it('--full-control reaches the pairing', async () => {
    const seen: Array<Record<string, unknown>> = []
    const base = fakeMachine()
    const d = { ...base.d, runtime: async (cmd: 'runtime-start' | 'runtime-pair', args: Record<string, unknown>) => (seen.push({ cmd, ...args }), base.d.runtime(cmd, args)) }
    await runSetup(opts({ fullControl: true }), d)
    expect(seen.at(-1)).toEqual({ cmd: 'runtime-pair', fullControl: true })
  })
})

describe('setupOptionsOf', () => {
  it('reads the flags parseArgs leaves', () => {
    expect(setupOptionsOf({ listen: '10.0.0.2', name: ' box ', fullControl: true, yes: true })).toEqual({ listen: '10.0.0.2', name: 'box', tailscale: false, fullControl: true, yes: true, codex: false })
    // `--listen` with no value is an empty address, which chooseListen refuses.
    expect(setupOptionsOf({ listen: true }).listen).toBe('')
  })
})
