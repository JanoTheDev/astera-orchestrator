// `astera machines add <user@host>` (T12b, plan decision 14): provision and pair a machine over SSH in one step. It
// runs the system `ssh` and `scp` with BatchMode, so only the person's own keys and agent are used: nothing here asks
// for, reads or stores a password. The steps are the manual setup's (docs/remote-runtime.md): find out the OS, pick
// the installer, upload it with the matching scripts/install-runtime.* script, run it, read its last line
// (`ASTERA_PAIR=<string>`), pair with that string the way `astera runtimes add` does, then ping. Each step says one
// line; a failure names the step, the tail of what the machine wrote (secrets redacted) and how to fix it.
//
// Everything that touches the world comes in through MachineDeps, so the command lines are tested without a real ssh.
import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { connectRuntime } from '../core/remote/client'
import { parsePairing } from '../core/remote/pairing'
import { redactSecrets } from '../core/remote/redact'
import { answerRemote } from './remote'
import { controllerRegistry, runRuntimesCommand } from './runtimes'

export type MachineStepId = 'connect' | 'detect' | 'installer' | 'upload' | 'install' | 'pair' | 'verify'
export interface MachineProgress {
  step: MachineStepId
  state: 'running' | 'done' | 'skipped' | 'failed'
  line: string
  stderrTail?: string
  fix?: string
}
export interface AddMachineOptions {
  /** `user@host`, or a host the person's ssh config knows. */
  target: string
  port?: number
  installer?: string
  name?: string
  listen?: string
  tailscale?: boolean
  fullControl?: boolean
}
export type MachineOs = 'linux' | 'windows'
export type AddMachineResult =
  | { ok: true; runtimeId: string; name: string; os: MachineOs; repaired: boolean }
  | { ok: false; step: MachineStepId; message: string; stderrTail: string; fix: string }

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

export interface MachineDeps {
  /** Runs `ssh` or `scp` with these arguments. `tty`: the person is at a terminal, so the install may ask sudo for a
   *  password there (the CLI); the app has none. */
  exec(file: 'ssh' | 'scp', args: string[], o: { tty: boolean; stdin?: string }): Promise<ExecResult>
  tty: boolean
  /** Astera installers found on this computer, any order (`dist-installer/astera-*-amd64.deb` and the like). */
  installers(): Promise<string[]>
  /** The folder holding install-runtime.sh and install-runtime.ps1, or undefined when this build has none. */
  scriptsDir(): string | undefined
  exists(p: string): boolean
  /** A short random word for the remote temp folder. */
  random(): string
  /** The Runtimes this computer is paired with. */
  paired(): Promise<ReadonlyArray<{ runtimeId: string; name: string; address: string; port: number }>>
  /** `runtimes add` with this pairing string. */
  pair(pairing: string, name?: string): Promise<{ ok: true; runtimeId: string; name: string } | { ok: false; code: string; message: string }>
  ping(runtimeId: string): Promise<boolean>
  /** T12c's hook: runs once the machine is paired and answers (moving accounts, projects, git identity). A failure
   *  here is reported but does not undo the pairing. */
  afterPair?(m: { runtimeId: string; name: string; os: MachineOs; target: string; port: number }): Promise<void>
}

const TARGET = /^(?:[A-Za-z0-9._][A-Za-z0-9._-]*@)?(?:[A-Za-z0-9][A-Za-z0-9.-]*|\[[0-9A-Fa-f:.]+\])$/
const TAIL_LINES = 15

/** The last pairing string a script printed: its final `ASTERA_PAIR=` line, whatever came before it (apt, setup's
 *  steps, a tty's carriage returns). */
export function parsePairLine(output: string): string | null {
  let found: string | null = null
  for (const raw of output.split(/\r?\n/)) {
    const m = /^\s*ASTERA_PAIR=(\S+)\s*$/.exec(raw.replace(/\r/g, ''))
    if (m) found = m[1]
  }
  return found
}

/** What may be shown of a machine's output: the last lines, with every secret shape removed. */
export function tailOf(text: string, lines = TAIL_LINES): string {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .slice(-lines)
    .map((l) => redactSecrets(l.replace(/ASTERA_PAIR=\S+/g, 'ASTERA_PAIR=[redacted]')))
    .join('\n')
}

/** One argument for a POSIX shell, quoted. */
export const shQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`
/** One string for PowerShell, quoted. */
export const psQuote = (s: string): string => `'${s.replace(/'/g, "''")}'`

/** A PowerShell script as one command any Windows SSH shell (cmd or PowerShell) runs unchanged: no quoting survives
 *  both, an encoded command does. */
export function powershellCommand(script: string): string {
  return `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`
}

export function sshArgs(o: { target: string; port: number; tty: boolean }, command: string): string[] {
  return ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-p', String(o.port), ...(o.tty ? ['-tt'] : []), '--', o.target, command]
}

/** scp to a folder on the machine; a Windows folder goes with forward slashes, which its OpenSSH takes. */
export function scpArgs(o: { target: string; port: number }, files: string[], remoteDir: string): string[] {
  return ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-P', String(o.port), '--', ...files, `${o.target}:${remoteDir.replace(/\\/g, '/')}/`]
}

/** The setup flags the install script passes on to `astera runtime setup`. */
function setupFlags(o: AddMachineOptions, os: MachineOs): string[] {
  const win = os === 'windows'
  return [
    ...(o.listen ? [win ? '-Listen' : '--listen', o.listen] : []),
    ...(o.tailscale ? [win ? '-Tailscale' : '--tailscale'] : []),
    ...(o.name ? [win ? '-Name' : '--name', o.name] : []),
    ...(o.fullControl ? [win ? '-FullControl' : '--full-control'] : [])
  ]
}

/** The one command that installs and prints the pairing string, per OS. */
export function installCommand(o: AddMachineOptions, os: MachineOs, remoteDir: string, installer: string): string {
  const flags = setupFlags(o, os)
  if (os === 'linux')
    return ['bash', shQuote(`${remoteDir}/install-runtime.sh`), shQuote(`${remoteDir}/${installer}`), ...flags.map(shQuote)].join(' ')
  const words = flags.map((f) => (f.startsWith('-') ? f : psQuote(f)))
  return powershellCommand(
    `& (Join-Path ${psQuote(remoteDir)} 'install-runtime.ps1') -Installer (Join-Path ${psQuote(remoteDir)} ${psQuote(installer)}) ${words.join(' ')}`.trim()
  )
}

const DETECT_WINDOWS = powershellCommand('[Environment]::OSVersion.Platform; [IO.Path]::GetTempPath()')
const mkTempWindows = (word: string): string =>
  powershellCommand(`$d = Join-Path ([IO.Path]::GetTempPath()) 'astera-${word}'; New-Item -ItemType Directory -Force -Path $d | Out-Null; $d`)

/** The newest Linux .deb among the candidates, by its version (astera-1.4.14-amd64.deb). */
export function newestDeb(paths: string[]): string | null {
  const ver = (p: string): number[] => (/astera-(\d+)\.(\d+)\.(\d+)/i.exec(path.basename(p)) ?? []).slice(1).map(Number)
  const debs = paths.filter((p) => /^astera-.*amd64\.deb$/i.test(path.basename(p)))
  debs.sort((a, b) => {
    const x = ver(a)
    const y = ver(b)
    for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0)
    return 0
  })
  return debs[0] ?? null
}

function connectFix(stderr: string, o: { target: string; port: number }): string {
  if (/permission denied/i.test(stderr))
    return `Put your public key on the machine (ssh-copy-id -p ${o.port} ${o.target}) and try again. Astera never asks for a password.`
  if (/host key verification failed/i.test(stderr)) return `Connect once with \`ssh -p ${o.port} ${o.target}\` to check and accept its host key, then try again.`
  return `Check the address, that the machine is on and that its SSH server listens on port ${o.port} (\`ssh -p ${o.port} ${o.target}\` must work without a password).`
}

export async function addMachine(o: AddMachineOptions, d: MachineDeps, onProgress: (p: MachineProgress) => void = () => undefined): Promise<AddMachineResult> {
  const port = o.port ?? 22
  const target = o.target.trim()
  const conn = { target, port }
  const say = (step: MachineStepId, state: MachineProgress['state'], line: string): void => onProgress({ step, state, line })
  const failed = (step: MachineStepId, message: string, output: string, fix: string): AddMachineResult => {
    const stderrTail = tailOf(output)
    onProgress({ step, state: 'failed', line: redactSecrets(message), stderrTail, fix })
    return { ok: false, step, message: redactSecrets(message), stderrTail, fix }
  }
  const ssh = (command: string, tty = false): Promise<ExecResult> => d.exec('ssh', sshArgs({ ...conn, tty }, command), { tty })

  // connect: a target that is not a plain user@host could be read by ssh as an option
  say('connect', 'running', `Connecting to ${target} over SSH`)
  if (!TARGET.test(target) || !Number.isInteger(port) || port < 1 || port > 65535)
    return failed('connect', `${target}${o.port ? ` port ${o.port}` : ''} is not a user@host and port Astera can use`, '', 'Give it as user@host (a name or address), and --port 1 to 65535 when it is not 22.')
  const probe = await ssh('uname -s')
  // 255 is ssh's own failure; anything else means the machine answered
  if (probe.code === 255) return failed('connect', `Could not sign in to ${target}`, probe.stderr, connectFix(probe.stderr, conn))
  say('connect', 'done', `Signed in to ${target}`)

  say('detect', 'running', 'Finding out which system it runs')
  let os: MachineOs
  if (probe.code === 0 && /^linux/i.test(probe.stdout.trim())) os = 'linux'
  else if (probe.code === 0) return failed('detect', `${target} runs ${probe.stdout.trim() || 'an unknown system'}`, probe.stderr, 'Only Linux (Ubuntu or Debian) and Windows machines can be added.')
  else {
    const win = await ssh(DETECT_WINDOWS)
    if (win.code !== 0 || !/Win32NT/i.test(win.stdout))
      return failed('detect', `Could not tell which system ${target} runs`, win.stderr || probe.stderr, 'Only Linux (Ubuntu or Debian) and Windows machines can be added.')
    os = 'windows'
  }
  say('detect', 'done', `It runs ${os === 'linux' ? 'Linux' : 'Windows'}`)

  say('installer', 'running', 'Picking the installer')
  const installer = o.installer ?? (os === 'linux' ? newestDeb(await d.installers()) : null)
  if (!installer)
    return failed(
      'installer',
      os === 'linux' ? 'No Astera .deb found on this computer' : 'A Windows machine needs the installer named',
      '',
      os === 'linux'
        ? 'Build one with `npm run dist:linux` (it lands in dist-installer/), or give one with --installer <path-to-astera.deb>.'
        : 'Build Astera-Setup.exe on Windows with `npm run dist:win` (the repository is private, so there are no releases to download), then give it with --installer <path>.'
    )
  if (!d.exists(installer)) return failed('installer', `No installer at ${installer}`, '', 'Give the path of an Astera installer that exists on this computer.')
  const scripts = d.scriptsDir()
  const script = scripts ? path.join(scripts, os === 'linux' ? 'install-runtime.sh' : 'install-runtime.ps1') : null
  if (!script || !d.exists(script))
    return failed('installer', 'This build of Astera has no install-runtime script', '', 'Run `astera machines add` from the Astera repository or an installed build that ships scripts/install-runtime.*.')
  say('installer', 'done', `Using ${path.basename(installer)}`)

  say('upload', 'running', 'Uploading the installer')
  const word = d.random()
  const dir = await ssh(os === 'linux' ? `mktemp -d /tmp/astera-${word}-XXXXXX` : mkTempWindows(word))
  const remoteDir = dir.stdout.trim().split(/\r?\n/).pop()?.trim() ?? ''
  if (dir.code !== 0 || remoteDir === '') return failed('upload', `Could not make a temporary folder on ${target}`, dir.stderr, 'Check the machine has free space in its temporary folder.')
  const up = await d.exec('scp', scpArgs(conn, [installer, script], remoteDir), { tty: false })
  if (up.code !== 0) return failed('upload', `Uploading to ${target} failed`, up.stderr, `Check the machine has free space in ${remoteDir}, then try again.`)
  say('upload', 'done', `Uploaded to ${remoteDir}`)

  say('install', 'running', 'Installing Astera and starting the Runtime (this takes a few minutes)')
  const run = await ssh(installCommand(o, os, remoteDir, path.basename(installer)), os === 'linux' && d.tty)
  const pairing = parsePairLine(run.stdout)
  if (run.code !== 0 || pairing === null) {
    const output = `${run.stdout}\n${run.stderr}`
    const sudo = /sudo|a terminal is required|password is required/i.test(output)
    return failed(
      'install',
      run.code !== 0 ? `The install on ${target} failed` : `The install on ${target} printed no pairing string`,
      output,
      sudo
        ? `It needs sudo. Run \`astera machines add ${target}\` in a terminal so sudo can ask for the password there, or allow this user sudo without a password.`
        : `Read the lines above; you can run it by hand on the machine: ${os === 'linux' ? `bash ${remoteDir}/install-runtime.sh ${remoteDir}/${path.basename(installer)}` : `install-runtime.ps1 -Installer ${remoteDir}\\${path.basename(installer)}`}.`
    )
  }
  say('install', 'done', 'Astera is installed and the Runtime is running')

  say('pair', 'running', 'Pairing this computer with it')
  const parts = parsePairing(pairing)
  if ('error' in parts) return failed('pair', `The pairing string from ${target} is not one Astera reads: ${parts.error}`, '', 'Run it again; if it repeats, update Astera on both machines.')
  const known = (await d.paired()).find((p) => p.address === parts.address && p.port === parts.port)
  let runtimeId: string
  let name: string
  let repaired = true
  if (known && (await d.ping(known.runtimeId))) {
    runtimeId = known.runtimeId
    name = known.name
    repaired = false
    say('pair', 'skipped', `Already paired as ${name}`)
  } else {
    const paired = await d.pair(pairing, o.name)
    if (!paired.ok) return failed('pair', paired.message, '', `Check this computer reaches ${parts.address}:${parts.port} (firewall, Tailscale), then run it again.`)
    runtimeId = paired.runtimeId
    name = paired.name
    say('pair', 'done', `Paired as ${name}`)
  }

  say('verify', 'running', `Checking ${name} answers`)
  if (!(await d.ping(runtimeId)))
    return failed('verify', `${name} was paired but does not answer`, '', `Check this computer reaches ${parts.address}:${parts.port} (firewall, Tailscale), then press Ping in Settings › Remote Runtimes.`)
  say('verify', 'done', `Machine ${name} is ready`)

  if (d.afterPair) {
    try {
      await d.afterPair({ runtimeId, name, os, target, port })
    } catch (e) {
      say('verify', 'done', `Machine ${name} is ready, but moving things to it failed: ${redactSecrets(e instanceof Error ? e.message : String(e))}`)
    }
  }
  return { ok: true, runtimeId, name, os, repaired }
}

/** Where the installers and the install scripts are, from where this CLI or app runs. */
export function machineSearchDirs(a: { cliEntry: string; cwd: string; home: string; resourcesPath?: string }): { installerDirs: string[]; scriptDirs: string[] } {
  const repo = path.resolve(path.dirname(a.cliEntry), '..', '..')
  return {
    installerDirs: [path.join(a.cwd, 'dist-installer'), path.join(repo, 'dist-installer'), path.join(a.home, 'Downloads')],
    scriptDirs: [...(a.resourcesPath ? [path.join(a.resourcesPath, 'runtime-scripts')] : []), path.join(repo, 'scripts')]
  }
}

/** The step lines and the end as the CLI prints them. */
export function machineResultText(r: AddMachineResult): string {
  if (!r.ok) return `Adding the machine failed at ${r.step}: ${r.message}${r.stderrTail ? `\n${r.stderrTail}` : ''}\nFix: ${r.fix}`
  return [
    `Machine ${r.name} is ready.`,
    'Next:',
    `  astera --runtime ${r.name} projects add --clone <git url>   clone a repository there`,
    `  astera --runtime ${r.name} accounts list                    its accounts (sign one in from Settings › Remote Runtimes)`,
    '  New console › pick the machine                             run tabs on it'
  ].join('\n')
}

/** Runs a program, its output captured. `tty`: the person's terminal is its input and sees its output as it comes, so
 *  sudo's password prompt reaches them. `stdin`: written to it and closed (a secret goes here, never into `args`). */
export function runExec(file: string, args: string[], x: { tty: boolean; stdin?: string; cwd?: string }): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(file, args, { stdio: [x.tty ? 'inherit' : x.stdin !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'], windowsHide: true, ...(x.cwd ? { cwd: x.cwd } : {}) })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (b: Buffer) => {
      stdout += b.toString()
      if (x.tty) process.stderr.write(b)
    })
    child.stderr?.on('data', (b: Buffer) => {
      stderr += b.toString()
      if (x.tty) process.stderr.write(b)
    })
    if (!x.tty && x.stdin !== undefined && child.stdin) {
      child.stdin.on('error', () => undefined)
      child.stdin.end(x.stdin)
    }
    child.on('error', (e) => resolve({ code: 255, stdout, stderr: `${stderr}${e.message}` }))
    child.on('close', (code) => resolve({ code: code ?? 255, stdout, stderr }))
  })
}

/** `astera machines add` in this CLI process: the system ssh and scp, this profile's Runtimes, steps to `log`. */
export async function runMachinesAdd(a: {
  args: Record<string, unknown>
  profileDir: string
  version: string
  log(m: string): void
  /** T12c: bringing the setup over once it is paired (cli/machineMigrate.ts). */
  afterPair?: MachineDeps['afterPair']
}): Promise<AddMachineResult> {
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)
  const portArg = a.args.port === undefined ? undefined : Number(a.args.port)
  const o: AddMachineOptions = {
    target: str(a.args.target) ?? '',
    ...(portArg !== undefined ? { port: portArg } : {}),
    ...(str(a.args.installer) ? { installer: path.resolve(str(a.args.installer)!) } : {}),
    ...(str(a.args.name) ? { name: str(a.args.name) } : {}),
    ...(str(a.args.listen) ? { listen: str(a.args.listen) } : {}),
    ...(a.args.tailscale === true ? { tailscale: true } : {}),
    ...(a.args.fullControl === true ? { fullControl: true } : {})
  }
  const dirs = machineSearchDirs({ cliEntry: process.argv[1] ?? __filename, cwd: process.cwd(), home: os.homedir(), resourcesPath: (process as { resourcesPath?: string }).resourcesPath })
  const registry = (): ReturnType<typeof controllerRegistry> => controllerRegistry(a.profileDir)
  const deps: MachineDeps = {
    tty: process.stdin.isTTY === true,
    exec: (file, args, x) => runExec(file, args, x),
    installers: async () =>
      (await Promise.all(dirs.installerDirs.map((d) => fs.readdir(d).then((xs) => xs.map((x) => path.join(d, x)), () => [] as string[])))).flat(),
    scriptsDir: () => dirs.scriptDirs.find((d) => existsSync(path.join(d, 'install-runtime.sh'))),
    exists: (p) => existsSync(p),
    random: () => randomBytes(4).toString('hex'),
    paired: async () => (await (await registry()).list()).map((p) => ({ runtimeId: p.runtimeId, name: p.name, address: p.address, port: p.port })),
    pair: async (pairing, name) => {
      const done = await runRuntimesCommand('runtimes-add', { pair: pairing, ...(name ? { name } : {}) }, {
        registry,
        connect: (c) => connectRuntime(c),
        hostname: () => os.hostname(),
        now: () => new Date().toISOString(),
        version: a.version
      })
      if (!done.ok) return { ok: false, code: done.error.code, message: done.error.message }
      const body = done.body as { runtimeId: string; name: string }
      return { ok: true, runtimeId: body.runtimeId, name: body.name }
    },
    ping: async (runtimeId) => {
      const r = await answerRemote({ cmd: 'projects-list', args: {}, runtime: runtimeId, request: randomUUID(), profileDir: a.profileDir, mode: 'json', write: () => undefined, version: a.version })
      return !('error' in r) && r.status === 200
    },
    ...(a.afterPair ? { afterPair: a.afterPair } : {})
  }
  return addMachine(o, deps, (p) => a.log(p.state === 'failed' ? `${p.step}: ${p.line}` : p.line))
}
