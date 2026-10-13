// The person's own npm, which the Host runs to install a plugin from npm (plugins 2e, spec §12, design P14): it has the
// registries, scopes and tokens the person configured, and resolves dependencies. No package code runs: every call
// passes --ignore-scripts, and npm never runs inside the package, so nothing the package holds (an npm.cmd or git.cmd
// that Windows would find in the current folder first, an .npmrc npm would read as the project's) can be run or read
// by it (2e final review I1). On Windows npm is a .cmd, reached through cmd.exe with every argument quoted; the spec has
// been checked (npmSpec.ts) so no argument holds a character cmd.exe reads inside quotes.
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { promises as fs, statSync } from 'node:fs'
import path from 'node:path'
import { hostWorkerBaseEnv } from '../../core/host/spawn'
import { killProcessTree } from '../../core/run/kill'
import { redactSecrets } from '../../core/remote/redact'
import { extractPackage } from './tarball'
import { moveRetrying } from './moves'
import { createOwnNpm, type OwnNpmPin } from './ownNpm'

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
  constructor(
    message: string,
    /** npm said the registry has no such package or version (E404, ETARGET). */
    readonly notFound = false
  ) {
    super(message)
  }
}

export type NpmRun = (args: string[], o: { cwd: string; timeoutMs?: number }) => Promise<{ code: number; stdout: string; stderr: string }>
/** An npm runner that can end what it still runs, for a Host that leaves (2e final review M8). */
export type NpmRunner = NpmRun & { stopAll(): void }

/** How long one npm call may take. An install from npm makes two (a pack, then an install of its dependencies), and
 *  both at their limit, with the copy and the move after them, still end inside the wait the CLI and the app give a
 *  change (2e final review M1; npm.test.ts checks the sum). */
export const NPM_TIMEOUT_MS = 120_000
/** What is kept of each stream: the end, where npm says what went wrong. */
const OUTPUT_MAX = 1024 * 1024

/** Astera's own npm (ownNpm.ts): its npm-cli.js, run on the Host's own Node. */
export interface OwnNpm {
  node: string
  cli: string
}

const valueOf = (env: NodeJS.ProcessEnv, name: string): string | undefined => {
  const key = Object.keys(env).find((k) => k.toUpperCase() === name)
  return key === undefined ? undefined : env[key]
}

/** Where `name` is on PATH, or null: each absolute folder of PATH in order, never the current folder or a relative
 *  one; on Windows with each PATHEXT extension, as cmd.exe would run it, and never the extensionless sh script npm
 *  ships beside npm.cmd. Found on the dev app (2e-2): asked to run a command it cannot find, cmd.exe says so in the
 *  system's language and code page and exits 1, so the Host finds npm itself rather than read cmd.exe's answer. */
export function findOnPath(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | null {
  const p = platform === 'win32' ? path.win32 : path.posix
  const dirs = (valueOf(env, 'PATH') ?? '')
    .split(platform === 'win32' ? ';' : ':')
    .map((d) => d.trim().replace(/^"(.*)"$/, '$1'))
    .filter((d) => d !== '' && p.isAbsolute(d))
  const exts =
    platform === 'win32'
      ? (valueOf(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD')
          .split(';')
          .map((e) => e.trim())
          .filter((e) => e !== '')
      : ['']
  for (const dir of dirs)
    for (const ext of exts) {
      const at = p.join(dir, `${name}${ext.toLowerCase()}`)
      try {
        if (statSync(at).isFile()) return at
      } catch {
        // not there
      }
    }
  return null
}

/** The command that runs npm with `args`: Astera's own as a script on the Host's Node, with no shell between; the
 *  person's by the path found on PATH, a .cmd or .bat through cmd.exe with that path and every argument quoted. */
export function npmCommand(
  args: readonly string[],
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  at: { own: OwnNpm } | { path: string }
): { file: string; args: string[]; verbatim: boolean } {
  if ('own' in at) return { file: at.own.node, args: [at.own.cli, ...args], verbatim: false }
  if (platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(at.path)) return { file: at.path, args: [...args], verbatim: false }
  for (const a of [at.path, ...args]) if (/["%\r\n]/.test(a)) throw new Error(`${JSON.stringify(a)} cannot be passed to npm through cmd.exe`)
  // `/s /c "..."`: cmd.exe drops the outer quotes and runs the rest, the path and each argument in quotes of their own.
  // `/v:off`: no `!` is expanded, whatever the machine's default.
  return { file: env.ComSpec ?? 'cmd.exe', args: ['/d', '/v:off', '/s', '/c', `""${at.path}" ${args.map((a) => `"${a}"`).join(' ')}"`], verbatim: true }
}

/** The environment npm runs with: the Host's, without what is the Host's alone (HOST_ONLY_ENV) or an Astera session's,
 *  without npm's update, funding and audit notes, and with Windows told not to look for a program in the current folder
 *  before PATH (2e final review I1; npm's own lookup of git honours it too). The variable is set once, under one case. */
export function npmEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(hostWorkerBaseEnv(env)))
    if (!/^ASTERA_/i.test(k) && k.toLowerCase() !== 'nodefaultcurrentdirectoryinexepath') out[k] = v
  return { ...out, NoDefaultCurrentDirectoryInExePath: '1', npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false' }
}

/** Lines of npm's output that say nothing about what went wrong: its note that a package can come from a tarball, a
 *  folder or a URL (sources Astera refuses), an empty `404`, and where its own log is (2e final review M5). */
const NOISE = /^npm (?:error|ERR!) (?:404\s*$|404 Note that you can also install|404 tarball, folder, http url|A complete log of this run)/

/** The last lines of npm's output, which is the install log (spec §12): its error code first, registry tokens and
 *  passwords taken out, then the shapes every Host log is redacted of. */
export function npmOutputTail(text: string, lines = 12): string {
  const all = text.split(/\r?\n/).filter((l) => l.trim() !== '' && !NOISE.test(l))
  const code = all.find((l) => /^npm (?:error|ERR!) code /.test(l))
  const rest = all.filter((l) => l !== code)
  const kept = code !== undefined ? [code, ...rest.slice(-(lines - 1))] : rest.slice(-lines)
  return kept
    .map((l) => redactSecrets(l.replace(/(_authToken|_auth|_password)=\S+/g, '$1=[redacted]').replace(/(https?:\/\/)[^/\s]*@/g, '$1[redacted]@')))
    .join('\n')
}

export function createNpmRunner(d: {
  env: NodeJS.ProcessEnv
  spawn?: typeof nodeSpawn
  platform?: NodeJS.Platform
  /** For tests: how a late npm is ended. */
  kill?: (child: ChildProcess) => void
  /** Astera's own npm instead of the person's; its Node is the Host's binary, run as Node. */
  own?: OwnNpm
  /** For tests: where the person's npm is (findOnPath). */
  find?: (name: string) => string | null
}): NpmRunner {
  const spawn = d.spawn ?? nodeSpawn
  const env = d.own ? { ...d.env, ELECTRON_RUN_AS_NODE: '1' } : d.env
  const platform = d.platform ?? process.platform
  const kill = d.kill ?? ((c: ChildProcess) => killProcessTree(c))
  /** The npm calls still running, and how to end each. */
  const running = new Set<() => void>()
  const run: NpmRun = (args, o) =>
    new Promise((resolve, reject) => {
      let cmd: { file: string; args: string[]; verbatim: boolean }
      if (d.own) cmd = npmCommand(args, platform, d.env, { own: d.own })
      else {
        const where = (d.find ?? ((n: string) => findOnPath(n, d.env, platform)))('npm')
        if (where === null) return reject(new NpmMissing())
        try {
          cmd = npmCommand(args, platform, d.env, { path: where })
        } catch (e) {
          return reject(e)
        }
      }
      let child: ChildProcess
      try {
        child = spawn(cmd.file, cmd.args, { cwd: o.cwd, env, windowsHide: true, windowsVerbatimArguments: cmd.verbatim, stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (e) {
        return reject((e as NodeJS.ErrnoException).code === 'ENOENT' ? new NpmMissing() : e)
      }
      let stdout = ''
      let stderr = ''
      const keep = (s: string, c: string): string => (s.length + c.length > OUTPUT_MAX ? (s + c).slice(-OUTPUT_MAX) : s + c)
      child.stdout?.setEncoding('utf8').on('data', (c: string) => (stdout = keep(stdout, c)))
      child.stderr?.setEncoding('utf8').on('data', (c: string) => (stderr = keep(stderr, c)))
      const ms = o.timeoutMs ?? NPM_TIMEOUT_MS
      let ended: 'late' | 'stopped' | null = null
      const end = (why: 'late' | 'stopped'): void => {
        ended = why
        kill(child)
      }
      const timer = setTimeout(() => end('late'), ms)
      const stop = (): void => end('stopped')
      running.add(stop)
      const settle = (): void => {
        clearTimeout(timer)
        running.delete(stop)
      }
      child.on('error', (e: NodeJS.ErrnoException) => {
        settle()
        reject(e.code === 'ENOENT' ? new NpmMissing() : e)
      })
      child.on('close', (code) => {
        settle()
        if (ended === 'late') return reject(new Error(`npm did not finish within ${ms / 1000} s`))
        if (ended === 'stopped') return reject(new Error('npm was stopped: the Host is leaving'))
        resolve({ code: code ?? 1, stdout, stderr })
      })
    })
  return Object.assign(run, {
    stopAll: () => {
      for (const stop of [...running]) stop()
    }
  })
}

/** The npm the Host runs (plugins 2e-2; the user's decision 2026-10-13): the person's when it starts; where none does,
 *  Astera's own, fetched once (ownNpm.ts) and gone to directly from then on. A person's npm that starts and fails is
 *  reported as it failed, never hidden behind the own one. */
export function createNpm(d: {
  profileDir: string
  /** The Host's environment; npm's own is made from it (npmEnv). */
  env: NodeJS.ProcessEnv
  /** The Host's own binary, which runs the own npm as Node. */
  node: string
  pinned?: OwnNpmPin
  /** For tests: the person's npm, the fetch of the own one, and the runner made for it. */
  system?: NpmRunner
  ensure?: () => Promise<string>
  own?: (cli: string) => NpmRunner
}): NpmRunner {
  const env = npmEnv(d.env)
  const system = d.system ?? createNpmRunner({ env })
  const ensure = d.ensure ?? createOwnNpm({ profileDir: d.profileDir, ...(d.pinned ? { pinned: d.pinned } : {}) }).ensure
  const makeOwn = d.own ?? ((cli: string) => createNpmRunner({ env, own: { node: d.node, cli } }))
  let useOwn = false
  let own: NpmRunner | null = null
  const run: NpmRun = async (args, o) => {
    if (!useOwn) {
      try {
        return await system(args, o)
      } catch (e) {
        if (!(e instanceof NpmMissing)) throw e
        useOwn = true
      }
    }
    own ??= makeOwn(await ensure())
    return own(args, o)
  }
  return Object.assign(run, {
    stopAll: () => {
      system.stopAll()
      own?.stopAll()
    }
  })
}

/** Fetches `spec` with `npm pack` into `dir`, an empty folder of the Host's, and extracts it to `dir/package`. The name
 *  and version are the package's own, read from what was extracted: npm's JSON about it can be cut short for a package
 *  of many files, and a registry's word on a package need not be what its tarball holds (2e final review M2, M3). */
export async function packAndExtract(spec: string, dir: string, run: NpmRun): Promise<{ name: string; version: string; folder: string }> {
  // `--prefix .`: npm takes this folder as the project, and reads no .npmrc above it.
  const r = await run(['pack', spec, '--prefix', '.', '--ignore-scripts', '--pack-destination', '.'], { cwd: dir })
  if (r.code !== 0)
    throw new NpmFailed(`npm could not fetch ${spec}: ${npmOutputTail(r.stderr || r.stdout, 6)}`, /\b(?:E404|ETARGET)\b/.test(r.stderr + r.stdout))
  const tarballs = (await fs.readdir(dir)).filter((n) => n.endsWith('.tgz'))
  if (tarballs.length !== 1) throw new NpmFailed(`npm fetched ${spec} but wrote ${tarballs.length} tarballs: ${npmOutputTail(r.stderr || r.stdout, 6)}`)
  const folder = path.join(dir, 'package')
  await extractPackage(path.join(dir, tarballs[0]), folder)
  const pkg = JSON.parse(await fs.readFile(path.join(folder, 'package.json'), 'utf8').catch(() => '{}')) as { name?: unknown; version?: unknown }
  return { name: typeof pkg.name === 'string' ? pkg.name : '', version: typeof pkg.version === 'string' ? pkg.version : '', folder }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Installs the dependencies a package declares into its own node_modules, as a folder install expects them: the
 *  runtime ones only, no install script, no .bin links, no lock file. npm runs in `staging/deps`, a folder of the Host's
 *  holding only a package.json with the package's dependencies, optional dependencies and overrides (none it bundles),
 *  so it builds the same tree it would for the package and reads nothing the package holds; the tree is then moved in
 *  beside what the package bundles. Says whether npm ran. */
export async function installDependencies(folder: string, staging: string, run: NpmRun): Promise<boolean> {
  const pkg = JSON.parse(await fs.readFile(path.join(folder, 'package.json'), 'utf8')) as Record<string, unknown>
  const bundled = pkg.bundleDependencies ?? pkg.bundledDependencies
  const own = (k: string): Record<string, unknown> => {
    if (!isObject(pkg[k]) || bundled === true) return {}
    const out: Record<string, unknown> = {}
    for (const [name, range] of Object.entries(pkg[k] as Record<string, unknown>)) if (!(Array.isArray(bundled) && bundled.includes(name))) out[name] = range
    return out
  }
  const dependencies = own('dependencies')
  const optionalDependencies = own('optionalDependencies')
  if (Object.keys(dependencies).length === 0 && Object.keys(optionalDependencies).length === 0) return false
  const deps = path.join(staging, 'deps')
  await fs.mkdir(deps)
  await fs.writeFile(
    path.join(deps, 'package.json'),
    `${JSON.stringify(
      {
        name: 'astera-plugin-dependencies',
        private: true,
        ...(Object.keys(dependencies).length > 0 ? { dependencies } : {}),
        ...(Object.keys(optionalDependencies).length > 0 ? { optionalDependencies } : {}),
        ...(isObject(pkg.overrides) ? { overrides: pkg.overrides } : {})
      },
      null,
      2
    )}\n`,
    'utf8'
  )
  const r = await run(
    ['install', '--prefix', '.', '--omit=dev', '--ignore-scripts', '--no-bin-links', '--no-package-lock', '--no-save', '--no-audit', '--no-fund', '--install-strategy=hoisted', '--workspaces=false'],
    { cwd: deps }
  )
  if (r.code !== 0) throw new NpmFailed(`npm could not install the dependencies of ${String(pkg.name)}: ${npmOutputTail(r.stderr || r.stdout, 6)}`)
  await moveInto(path.join(deps, 'node_modules'), path.join(folder, 'node_modules'))
  return true
}

/** Moves each package of `from` into `to`, keeping what `to` already holds (what the package bundles), a scope folder
 *  merged one package at a time; npm's own bookkeeping file stays behind. */
async function moveInto(from: string, to: string): Promise<void> {
  const names = await fs.readdir(from).catch(() => [] as string[])
  await fs.mkdir(to, { recursive: true })
  for (const n of names) {
    if (n === '.package-lock.json') continue
    const src = path.join(from, n)
    const dest = path.join(to, n)
    const there = await fs.stat(dest).then(() => true, () => false)
    if (!there) await moveRetrying(src, dest)
    else if (n.startsWith('@')) await moveInto(src, dest)
  }
}
