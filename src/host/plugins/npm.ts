// The person's own npm, which the Host runs to install a plugin from npm (plugins 2e, spec §12, design P14): it has the
// registries, scopes and tokens the person configured, and resolves dependencies. No package code runs: every call
// passes --ignore-scripts. On Windows npm is a .cmd, reached through cmd.exe with every argument quoted; the spec has
// been checked (npmSpec.ts) so no argument holds a character cmd.exe reads inside quotes.
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { hostWorkerBaseEnv } from '../../core/host/spawn'
import { killProcessTree } from '../../core/run/kill'
import { redactSecrets } from '../../core/remote/redact'
import { extractPackage } from './tarball'

/** npm could not be started: it is not installed, or not on the Host's PATH. */
export class NpmMissing extends Error {
  readonly code = 'PLUGIN_NPM_MISSING'
  constructor() {
    super('npm was not found on this computer: install Node.js, which brings npm, or install the plugin from a folder with --path')
  }
}

/** npm ran and could not do what it was asked; the message carries its last lines, redacted. */
export class NpmFailed extends Error {
  readonly code = 'PLUGIN_NPM_FAILED'
}

export type NpmRun = (args: string[], o: { cwd: string; timeoutMs?: number }) => Promise<{ code: number; stdout: string; stderr: string }>

/** How long one npm call may take: well inside the CLI's own wait for the install. */
const NPM_TIMEOUT_MS = 240_000
/** What is kept of each stream: the end, where npm says what went wrong. */
const OUTPUT_MAX = 1024 * 1024
/** What cmd.exe answers for a command it cannot find. */
const CMD_NOT_FOUND = 9009

/** The command that runs npm with `args`. */
export function npmCommand(args: readonly string[], platform: NodeJS.Platform, env: NodeJS.ProcessEnv): { file: string; args: string[]; verbatim: boolean } {
  if (platform !== 'win32') return { file: 'npm', args: [...args], verbatim: false }
  for (const a of args) if (/["%\r\n]/.test(a)) throw new Error(`${JSON.stringify(a)} cannot be passed to npm through cmd.exe`)
  // `/s /c "..."`: cmd.exe drops the outer quotes and runs the rest, each argument in quotes of its own.
  return { file: env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', `"npm ${args.map((a) => `"${a}"`).join(' ')}"`], verbatim: true }
}

/** The environment npm runs with: the Host's, without what is the Host's alone (HOST_ONLY_ENV) or an Astera session's,
 *  and without npm's update, funding and audit notes. */
export function npmEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(hostWorkerBaseEnv(env))) if (!/^ASTERA_/i.test(k)) out[k] = v
  return { ...out, npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false' }
}

/** The last lines of npm's output, which is the install log (spec §12): registry tokens and passwords taken out, then the
 *  shapes every Host log is redacted of. */
export function npmOutputTail(text: string, lines = 12): string {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .slice(-lines)
    .map((l) => redactSecrets(l.replace(/(_authToken|_auth|_password)=\S+/g, '$1=[redacted]').replace(/(https?:\/\/)[^/\s@]+@/g, '$1[redacted]@')))
    .join('\n')
}

export function createNpmRunner(d: {
  env: NodeJS.ProcessEnv
  spawn?: typeof nodeSpawn
  platform?: NodeJS.Platform
  /** For tests: how a late npm is ended. */
  kill?: (child: ChildProcess) => void
}): NpmRun {
  const spawn = d.spawn ?? nodeSpawn
  const platform = d.platform ?? process.platform
  const kill = d.kill ?? ((c: ChildProcess) => killProcessTree(c))
  return (args, o) =>
    new Promise((resolve, reject) => {
      const cmd = npmCommand(args, platform, d.env)
      let child: ChildProcess
      try {
        child = spawn(cmd.file, cmd.args, { cwd: o.cwd, env: d.env, windowsHide: true, windowsVerbatimArguments: cmd.verbatim, stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (e) {
        return reject((e as NodeJS.ErrnoException).code === 'ENOENT' ? new NpmMissing() : e)
      }
      let stdout = ''
      let stderr = ''
      const keep = (s: string, c: string): string => (s.length + c.length > OUTPUT_MAX ? (s + c).slice(-OUTPUT_MAX) : s + c)
      child.stdout?.setEncoding('utf8').on('data', (c: string) => (stdout = keep(stdout, c)))
      child.stderr?.setEncoding('utf8').on('data', (c: string) => (stderr = keep(stderr, c)))
      const ms = o.timeoutMs ?? NPM_TIMEOUT_MS
      let late = false
      const timer = setTimeout(() => {
        late = true
        kill(child)
      }, ms)
      child.on('error', (e: NodeJS.ErrnoException) => {
        clearTimeout(timer)
        reject(e.code === 'ENOENT' ? new NpmMissing() : e)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (late) return reject(new Error(`npm did not finish within ${ms / 1000} s`))
        if (platform === 'win32' && code === CMD_NOT_FOUND) return reject(new NpmMissing())
        resolve({ code: code ?? 1, stdout, stderr })
      })
    })
}

/** Fetches `spec` with `npm pack` into `dir` and extracts it to `dir/package`, where the plugin's files are. */
export async function packAndExtract(
  spec: string,
  dir: string,
  run: NpmRun
): Promise<{ name: string; version: string; integrity: string; folder: string }> {
  const r = await run(['pack', spec, '--json', '--ignore-scripts', '--pack-destination', '.'], { cwd: dir })
  if (r.code !== 0) throw new NpmFailed(`npm could not fetch ${spec}: ${npmOutputTail(r.stderr || r.stdout, 6)}`)
  let info: { name?: unknown; version?: unknown; integrity?: unknown; filename?: unknown } | undefined
  try {
    info = (JSON.parse(r.stdout.slice(r.stdout.indexOf('['))) as unknown[])[0] as typeof info
  } catch {
    info = undefined
  }
  if (!info || typeof info.name !== 'string' || typeof info.version !== 'string' || typeof info.filename !== 'string' || /[\\/]/.test(info.filename))
    throw new NpmFailed(`npm fetched ${spec} but did not say what it wrote: ${npmOutputTail(r.stdout, 6)}`)
  const folder = path.join(dir, 'package')
  await extractPackage(path.join(dir, info.filename), folder)
  return { name: info.name, version: info.version, integrity: typeof info.integrity === 'string' ? info.integrity : '', folder }
}

/** Installs the dependencies a package declares into its own node_modules, as a folder install expects them: the
 *  runtime ones only, no install script, no .bin links, no lock file. Nothing to do for a package without any; says
 *  whether npm ran. npm reads devDependencies and workspaces even with --omit=dev, and a plugin's dev tools may be
 *  private or gone, so the copy's package.json drops both first; a plugin does not read them when it runs. */
export async function installDependencies(folder: string, run: NpmRun): Promise<boolean> {
  const file = path.join(folder, 'package.json')
  const pkg = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>
  const declared = (k: string): boolean => typeof pkg[k] === 'object' && pkg[k] !== null && Object.keys(pkg[k] as object).length > 0
  if (!declared('dependencies') && !declared('optionalDependencies')) return false
  if ('devDependencies' in pkg || 'workspaces' in pkg) {
    const { devDependencies: _dev, workspaces: _ws, ...kept } = pkg
    await fs.writeFile(file, `${JSON.stringify(kept, null, 2)}\n`, 'utf8')
  }
  const r = await run(
    ['install', '--omit=dev', '--ignore-scripts', '--no-bin-links', '--no-package-lock', '--no-save', '--no-audit', '--no-fund', '--install-strategy=hoisted', '--workspaces=false'],
    { cwd: folder }
  )
  if (r.code !== 0) throw new NpmFailed(`npm could not install the dependencies of ${String(pkg.name)}: ${npmOutputTail(r.stderr || r.stdout, 6)}`)
  return true
}
