// The machine behind `astera runtime setup` (setup.ts): the probes and actions SetupDeps names, on this process's own
// platform. Kept apart so setup.ts stays a function of what it is handed.
import { spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { HostCommandResult } from '../host'
import { privateIPv4s } from '../../core/remote/addresses'
import { addUserPathCommand, unpathedInstallDir } from '../../core/install/cliInstall'
import { appImageLaunchFor, binDirFor } from '../../core/orchestration/cliInstall'
import { installShuttle, shuttleFiles, shuttleSyncPlan } from '../../core/orchestration/exec/shuttle'
import { keepAliveFor, type Cmd, type SetupDeps } from './setup'

const PROBE_TIMEOUT_MS = 15_000

/** Exit code of a command run with no output; 127 when it could not start, 124 when it ran out of time. */
function quiet(c: Cmd, timeoutMs = PROBE_TIMEOUT_MS): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    let stdout = ''
    const child = spawn(c.command, c.args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    const timer = setTimeout(() => {
      child.kill()
      resolve({ code: 124, stdout })
    }, timeoutMs)
    child.stdout?.on('data', (b: Buffer) => (stdout += b.toString()))
    child.once('error', () => {
      clearTimeout(timer)
      resolve({ code: 127, stdout })
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout })
    })
  })
}

/** A command run in this terminal: stdin for a sudo password or a prompt, its output on stderr so stdout stays the
 *  envelope. */
function loud(c: Cmd): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(c.command, c.args, { stdio: [0, 2, 2], windowsHide: true })
    child.once('error', () => resolve(127))
    child.once('close', (code) => resolve(code ?? 1))
  })
}

const readOrNull = (p: string): Promise<string | null> => fs.readFile(p, 'utf8').catch(() => null)

export function setupMachine(a: {
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  home: string
  profileDir: string
  /** One `astera runtime ...` command, through commands.ts with this profile's deps. */
  runtime(cmd: string, args: Record<string, unknown>): Promise<HostCommandResult>
  log(line: string): void
}): SetupDeps {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null
  const binDir = binDirFor({ platform: a.platform, env: a.env, home: a.home })
  const entryPath = process.argv[1] ?? ''
  const shuttle = {
    execPath: process.execPath,
    entryPath,
    appImage: a.platform === 'linux' ? appImageLaunchFor({ env: a.env, execPath: process.execPath, entryPath }) : undefined
  }
  const keepAlive = keepAliveFor({
    platform: a.platform,
    home: a.home,
    binDir,
    profileDir: a.profileDir,
    user: os.userInfo().username,
    uid,
    localAppData: a.env.LOCALAPPDATA
  })
  const has = async (command: string): Promise<boolean> => (await quiet({ command, args: ['--version'] })).code === 0
  const exe = a.platform === 'win32' ? '.exe' : ''
  return {
    platform: a.platform,
    agentSession: (a.env.ASTERA_SESSION ?? '') !== '',
    uid,
    home: a.home,
    hostname: () => os.hostname(),
    tailscaleIp: async () => {
      const r = await quiet({ command: 'tailscale', args: ['ip', '-4'] }, 5_000)
      if (r.code !== 0) return null
      return r.stdout.split(/\r?\n/).map((l) => l.trim()).find((l) => /^\d{1,3}(\.\d{1,3}){3}$/.test(l)) ?? null
    },
    lanAddresses: () => privateIPv4s(os.networkInterfaces()).map((n) => n.address),
    probe: async (address) => {
      const claudeDir = unpathedInstallDir('claude', a.platform, a.home)
      const current: Record<string, string | null> = {}
      const desired = shuttleFiles({ ...shuttle, platform: a.platform, env: a.env })
      for (const f of desired) current[f.name] = await readOrNull(path.join(binDir, f.name))
      const serviceOn =
        keepAlive !== null &&
        (await readOrNull(keepAlive.file)) === keepAlive.content &&
        (await Promise.all(keepAlive.check.map(quiet))).every((r) => r.code === 0)
      const status = await a.runtime('runtime-status', {})
      const body = status.ok ? (status.body as { enabled?: boolean; listen?: string; gateway?: { state?: string } }) : {}
      return {
        platform: a.platform,
        git: await has('git'),
        claude: (await has('claude')) || (claudeDir !== null && existsSync(path.join(claudeDir, `claude${exe}`))),
        codex: await has('codex'),
        packageManager: a.platform === 'linux' ? await has('apt-get') : a.platform === 'win32' ? await has('winget') : false,
        shim: shuttleSyncPlan({ current, desired }),
        service: serviceOn,
        runtimeReady: body.enabled === true && body.listen === address && body.gateway?.state === 'ready'
      }
    },
    exec: loud,
    installCli: async () => {
      if (!entryPath) throw new Error('this process does not know its own CLI entry')
      const { warnings } = await installShuttle({ dir: binDir, ...shuttle, platform: a.platform, env: a.env })
      for (const w of warnings) a.log(`cli: ${w.code}: ${w.detail}`)
      // On Windows the folder goes on the user Path, as Settings' checkbox does, so a new terminal finds `astera`.
      if (a.platform === 'win32') {
        const c = addUserPathCommand(binDir)
        const code = await loud(c)
        if (code !== 0) throw new Error(`the astera folder could not be put on the user Path (exit ${code})`)
      }
    },
    installService: async () => {
      if (!keepAlive) throw new Error(`no keep-alive recipe for ${a.platform}`)
      await fs.mkdir(path.dirname(keepAlive.file), { recursive: true })
      await fs.writeFile(keepAlive.file, keepAlive.content)
      for (const c of keepAlive.install) {
        const code = await loud(c)
        if (code !== 0 && !c.tolerate) throw new Error(`\`${[c.command, ...c.args].join(' ')}\` exited with ${code}`)
      }
    },
    runtime: (cmd, args) => a.runtime(cmd, args),
    log: a.log
  }
}
