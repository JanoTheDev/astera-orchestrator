// The source update channel's wiring (decisions and build facts: src/core/update/sourceUpdate.ts).
//
// Check: `git fetch origin main` in the owner's checkout — it moves only the remote-tracking ref, never the working
// tree or a branch — then the commits in `<built>..origin/main`.
// Build: a private clone at `<userData>/self-update/src`, never a `git worktree` of the owner's repo (Astera lists
// and cleans those). `npm ci` only when package-lock.json changed, `npm run dist:linux` under the heavy-job lock.
// Install: the built AppImage is staged in `<userData>/self-update/apps/`; a detached sh starts it once this pid is
// gone (a second Astera quits silently while the first holds the single-instance lock), then the app quits.
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, existsSync, openSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { heavyQueue, runHeavy } from '../core/orchestration/heavyLock'
import { readHeavyJobsAtOnce } from '../core/settings/heavyJobs'
import {
  appImagesToDelete,
  canSelfInstall,
  IDLE_INSTALL_SECONDS,
  lastUsefulLine,
  MAX_LISTED_COMMITS,
  mayBuild,
  modeActions,
  needsInstall,
  parseCommitLog,
  previousBuildOf,
  SOURCE_CHECK_INTERVAL_MS,
  SOURCE_FIRST_CHECK_DELAY_MS,
  stagedName,
  type JustUpdated,
  type SourceCommit
} from '../core/update/sourceUpdate'
import { afterCheckTimeout, checkWithTimeout, createUpdateStateTracker, UPDATE_CHECK_TIMEOUT_MS } from '../core/update/checkTimeout'
import type { InstallOutcome, SourceBuildStep, UpdateMode, UpdateStatus } from '../core/types'

const execFileP = promisify(execFile)

async function git(cwd: string, args: string[], timeout = 120_000): Promise<string> {
  // windowsHide: the source check runs on win32 for a build made from a git checkout, and main is a GUI-subsystem
  // program, so each git call would otherwise flash a console window.
  const { stdout } = await execFileP('git', ['-C', cwd, ...args], { timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true })
  return stdout
}

/** Whether `dir` is a git checkout with an `origin` remote — the channel's precondition. */
export async function isSourceRepo(dir: string): Promise<boolean> {
  if (!dir || !existsSync(dir)) return false
  try {
    await git(dir, ['remote', 'get-url', 'origin'], 10_000)
    return true
  } catch {
    return false
  }
}

export interface SourceCheck {
  behind: number
  commits: SourceCommit[]
  /** origin/main's commit. */
  target: string
}

/** Fetches origin/main into `sourceDir` and lists what `builtCommit` lacks. */
export async function checkSource(sourceDir: string, builtCommit: string): Promise<SourceCheck> {
  await git(sourceDir, ['fetch', 'origin', 'main', '--quiet'])
  const target = (await git(sourceDir, ['rev-parse', 'refs/remotes/origin/main'])).trim()
  const range = `${builtCommit}..${target}`
  const behind = Number((await git(sourceDir, ['rev-list', '--count', range])).trim())
  const commits = parseCommitLog(await git(sourceDir, ['log', `-n${MAX_LISTED_COMMITS}`, '--format=%H%x09%s', range]))
  return { behind, commits, target }
}

/** What survives a restart: the lockfile hash of the last good `npm ci`, failed build times, the staged build. */
interface SavedState {
  lockHash?: string
  failedAt: Record<string, number>
  staged?: { file: string; sha: string; version: string }
  /** The commit the last run was on: a different one at boot means the app restarted onto a new build. */
  lastRunCommit?: string
}

export interface SourceUpdaterDeps {
  sourceDir: string
  builtCommit: string
  userData: string
  platform: NodeJS.Platform
  /** `$APPIMAGE`: the AppImage this app runs from, when it does. */
  appImage: string | undefined
  getMode(): UpdateMode
  push(s: UpdateStatus): void
  /** One line to updater.log. */
  log(line: string): void
  /** The text for an `update.source.*` key, in the app's language. */
  text(key: string, params?: Record<string, string | number>): string
  /** Seconds since the last user input. */
  idleSeconds(): number
  /** Quits the app the way an install does (update hold, Host retired only where it cannot survive). */
  quitForInstall(): Promise<void>
  /** Whether the channel's precondition holds (isSourceRepo); a test passes its own. */
  sourceOk?: () => Promise<boolean>
  now?: () => number
}

export function createSourceUpdater(d: SourceUpdaterDeps): {
  start(): void
  stop(): void
  check(userInitiated: boolean): Promise<void>
  build(): Promise<void>
  install(): Promise<InstallOutcome>
  /** The "Updated to" record for a boot onto a new build; handed out once. */
  justUpdated(): Promise<JustUpdated | null>
} {
  const now = d.now ?? Date.now
  const root = path.join(d.userData, 'self-update')
  const srcDir = path.join(root, 'src')
  const appsDir = path.join(root, 'apps')
  const statePath = path.join(root, 'state.json')
  const buildLog = path.join(root, 'build.log')
  const selfInstall = canSelfInstall(d.platform, d.appImage)
  const states = createUpdateStateTracker()
  const push = (s: UpdateStatus): void => {
    states.record(s)
    d.push(s)
  }

  let saved: SavedState = { failedAt: {} }
  let latest: SourceCheck | null = null
  let lastCheckAt = now() - SOURCE_CHECK_INTERVAL_MS + SOURCE_FIRST_CHECK_DELAY_MS
  let checking: Promise<void> | null = null
  let building = false
  let installing = false
  let timer: NodeJS.Timeout | null = null
  let ready: Promise<boolean> | null = null
  let pendingUpdated: JustUpdated | null = null

  const saveState = (): Promise<void> =>
    fs
      .mkdir(root, { recursive: true })
      .then(() => fs.writeFile(statePath, JSON.stringify(saved)))
      .catch((e: unknown) => d.log(`WARN source: state not saved: ${String(e)}`))

  const sourceInfo = (c: SourceCheck): UpdateStatus['source'] => ({ behind: c.behind, commits: c.commits, target: c.target })
  const stagedVersion = (s: NonNullable<SavedState['staged']>): string => `${s.version}-${s.sha.slice(0, 7)}`
  const stagedIsCurrent = (): boolean =>
    !!saved.staged && !!latest && saved.staged.sha === latest.target && existsSync(path.join(appsDir, saved.staged.file))

  /** Loads the saved state and drops the AppImages nothing needs: all but the running one and the staged one. */
  async function boot(): Promise<boolean> {
    try {
      const raw = JSON.parse(await fs.readFile(statePath, 'utf8')) as Partial<SavedState>
      saved = { ...raw, failedAt: raw.failedAt ?? {} }
    } catch {
      /* first run, or unreadable: start clean */
    }
    if (saved.staged?.sha === d.builtCommit) saved.staged = undefined // installed: this is it
    const previous = previousBuildOf(saved.lastRunCommit, d.builtCommit)
    if (previous) {
      // A git failure (the old commit gone, no checkout) still announces the sha, with nothing listed.
      const log = await git(d.sourceDir, ['log', `-n${MAX_LISTED_COMMITS}`, '--format=%H%x09%s', `${previous}..${d.builtCommit}`]).catch(() => '')
      pendingUpdated = { sha: d.builtCommit.slice(0, 7), commits: parseCommitLog(log) }
    }
    if (d.builtCommit) saved.lastRunCommit = d.builtCommit
    try {
      const running = d.appImage && path.dirname(d.appImage) === appsDir ? path.basename(d.appImage) : undefined
      for (const f of appImagesToDelete(await fs.readdir(appsDir), [running, saved.staged?.file])) {
        await fs.rm(path.join(appsDir, f), { force: true })
        d.log(`source: deleted old build ${f}`)
      }
    } catch {
      /* no apps folder yet */
    }
    await saveState()
    const ok = await (d.sourceOk ?? (() => isSourceRepo(d.sourceDir)))()
    if (!ok) d.log(`WARN source: ${d.sourceDir} is not a git checkout with an origin remote; the source channel is idle`)
    else d.log(`source: watching ${d.sourceDir} origin/main from ${d.builtCommit.slice(0, 7)} (self-install ${selfInstall})`)
    return ok
  }

  async function runCheck(userInitiated: boolean): Promise<void> {
    if (!(await ready)) {
      if (userInitiated) push({ state: 'error', message: d.text('update.source.noCheckout', { dir: d.sourceDir }) })
      return
    }
    lastCheckAt = now()
    // A build in progress keeps its status on screen; the check only records the newer target for after it.
    const quiet = building
    if (!quiet) push({ state: 'checking' })
    try {
      const r = await checkWithTimeout(
        () => checkSource(d.sourceDir, d.builtCommit),
        UPDATE_CHECK_TIMEOUT_MS,
        () => d.log(`WARN source check timed out after ${UPDATE_CHECK_TIMEOUT_MS / 1000}s (${userInitiated ? 'manual' : 'automatic'})`)
      )
      if (r === 'timedOut') {
        if (quiet) return
        const next = afterCheckTimeout(states.last(), userInitiated, states.beforeCheck())
        if (next && 'messageKey' in next)
          push({ state: 'error', message: d.text('update.source.checkTimedOut', { seconds: UPDATE_CHECK_TIMEOUT_MS / 1000 }) })
        else if (next) push(next)
        return
      }
      latest = r
      d.log(`source check: ${r.behind} commit(s) behind origin/main ${r.target.slice(0, 7)}`)
      if (quiet) return
      if (r.behind === 0) push({ state: 'uptodate', version: d.builtCommit.slice(0, 7) })
      else if (stagedIsCurrent()) push({ state: 'downloaded', version: stagedVersion(saved.staged!), source: sourceInfo(r) })
      else push({ state: 'available', version: r.target.slice(0, 7), source: sourceInfo(r) })
    } catch (e) {
      const message = (e as Error)?.message ?? String(e)
      if (userInitiated && !quiet) push({ state: 'error', message })
      else {
        d.log(`WARN automatic source check failed (not surfaced to the user): ${message}`)
        if (!quiet && states.last() === 'checking') push(states.beforeCheck() ?? { state: 'init' })
      }
    }
  }

  function check(userInitiated: boolean): Promise<void> {
    checking ??= runCheck(userInitiated).finally(() => {
      checking = null
    })
    return checking.then(advance)
  }

  /** Runs a command with its output appended to build.log; resolves with the exit code. */
  function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<number> {
    const fd = openSync(buildLog, 'a')
    return new Promise<number>((resolve) => {
      const c = spawn(cmd, args, { cwd, env, stdio: ['ignore', fd, fd], windowsHide: true })
      c.on('error', (e) => {
        d.log(`ERROR source: ${cmd} could not start: ${e.message}`)
        resolve(127)
      })
      c.on('exit', (code) => resolve(code ?? 1))
    }).finally(() => closeSync(fd))
  }

  async function runBuild(): Promise<void> {
    const step = (s: SourceBuildStep): void => {
      d.log(`source build: ${s}`)
      push({ state: 'building', step: s, message: d.text(`update.source.step.${s}`), source: latest ? sourceInfo(latest) : undefined })
    }
    // The build bakes in the owner's checkout, not this clone, so the new app goes on watching it (electron.vite.config.ts).
    const env: NodeJS.ProcessEnv = { ...process.env, ASTERA_SOURCE_DIR: d.sourceDir }
    for (const k of ['ASTERA_AUTO_UPDATE', 'APPIMAGE', 'APPDIR', 'ARGV0', 'OWD', 'ELECTRON_RUN_AS_NODE']) delete env[k]
    let target = latest!.target
    const fail = async (why: string): Promise<void> => {
      saved.failedAt[target] = now()
      await saveState()
      d.log(`ERROR source build of ${target.slice(0, 7)} failed: ${why} (log: ${buildLog})`)
      push({ state: 'error', message: d.text('update.source.buildFailed', { line: why }), source: latest ? sourceInfo(latest) : undefined })
    }
    try {
      await fs.mkdir(root, { recursive: true })
      await fs.writeFile(buildLog, '')
      step('cloning')
      if (!existsSync(path.join(srcDir, '.git'))) {
        await fs.rm(srcDir, { recursive: true, force: true })
        if ((await run('git', ['clone', '--no-checkout', '--quiet', d.sourceDir, srcDir], root, env)) !== 0)
          return await fail(lastUsefulLine(await fs.readFile(buildLog, 'utf8')))
      }
      await git(srcDir, ['fetch', '--quiet', d.sourceDir, 'refs/remotes/origin/main'])
      await git(srcDir, ['checkout', '--quiet', '--detach', '--force', 'FETCH_HEAD'])
      target = (await git(srcDir, ['rev-parse', 'HEAD'])).trim() // origin/main may have moved since the check

      const lockHash = createHash('sha256').update(await fs.readFile(path.join(srcDir, 'package-lock.json'))).digest('hex')
      if (needsInstall(lockHash, saved.lockHash, existsSync(path.join(srcDir, 'node_modules')))) {
        step('installing')
        if ((await run('npm', ['ci'], srcDir, env)) !== 0) return await fail(lastUsefulLine(await fs.readFile(buildLog, 'utf8')))
        saved.lockHash = lockHash
        await saveState()
      }

      step('waiting')
      const slots = await readHeavyJobsAtOnce(path.join(d.userData, 'app-settings.json'))
      // Our ticket among the first `slots` in the queue means a slot is ours (or about to be): show "building" from then on.
      const watch = setInterval(() => {
        if (heavyQueue().slice(0, slots).some((t) => t.pid === process.pid) && states.last() === 'building') {
          clearInterval(watch)
          step('building')
        }
      }, 2_000)
      const fd = openSync(buildLog, 'a')
      let code: number
      try {
        code = await runHeavy({
          argv: ['--', 'npm', 'run', 'dist:linux'],
          env,
          cwd: srcDir,
          stdio: ['ignore', fd, fd],
          slots,
          err: (t) => d.log(`source build: ${t.trim()}`)
        })
      } finally {
        clearInterval(watch)
        closeSync(fd)
      }
      if (code !== 0) return await fail(lastUsefulLine(await fs.readFile(buildLog, 'utf8')))

      const outDir = path.join(srcDir, 'dist-installer')
      const built = (await fs.readdir(outDir)).filter((f) => f.endsWith('.AppImage'))
      const newest = (
        await Promise.all(built.map(async (f) => ({ f, t: (await fs.stat(path.join(outDir, f))).mtimeMs })))
      ).sort((a, b) => b.t - a.t)[0]?.f
      if (!newest) return await fail(d.text('update.source.noAppImage'))
      const version = (JSON.parse(await fs.readFile(path.join(srcDir, 'package.json'), 'utf8')) as { version: string }).version
      const file = stagedName(version, target)
      await fs.mkdir(appsDir, { recursive: true })
      await fs.rm(path.join(appsDir, file), { force: true })
      await fs.rename(path.join(outDir, newest), path.join(appsDir, file))
      await fs.chmod(path.join(appsDir, file), 0o755)
      const previous = saved.staged?.file
      if (previous && previous !== file) await fs.rm(path.join(appsDir, previous), { force: true })
      saved.staged = { file, sha: target, version }
      delete saved.failedAt[target]
      await saveState()
      d.log(`source build: staged ${path.join(appsDir, file)}`)
      push({ state: 'downloaded', version: stagedVersion(saved.staged), source: latest ? sourceInfo(latest) : undefined })
    } catch (e) {
      await fail((e as Error)?.message ?? String(e))
    }
  }

  async function build(): Promise<void> {
    if (building || !selfInstall || !latest || latest.behind === 0 || stagedIsCurrent()) return
    building = true
    try {
      await runBuild()
    } finally {
      building = false
    }
    void advance() // a newer origin/main seen during the build is built next
  }

  async function install(): Promise<InstallOutcome> {
    const staged = saved.staged
    const file = staged && path.join(appsDir, staged.file)
    if (!selfInstall || !file || !existsSync(file)) return { mode: 'failed', message: d.text('update.source.nothingToInstall') }
    if (installing) return { mode: 'auto' }
    installing = true
    const env: NodeJS.ProcessEnv = { ...process.env }
    for (const k of ['APPIMAGE', 'APPDIR', 'ARGV0', 'OWD']) delete env[k]
    // Waits for this pid to be gone, so the new app gets the single-instance lock.
    spawn('sh', ['-c', 'while kill -0 "$1" 2>/dev/null; do sleep 0.5; done; exec "$2" --no-sandbox', 'sh', String(process.pid), file], {
      detached: true,
      stdio: 'ignore',
      env,
      windowsHide: true // posix-only (an AppImage), stated so the scan in src/core/childWindows.scan.test.ts can see it
    }).unref()
    d.log(`source install: ${file} starts once pid ${process.pid} exits`)
    await d.quitForInstall()
    return { mode: 'auto' }
  }

  /** The mode's next move: a due check, a build of a known newer target, an idle restart into a staged build. */
  async function advance(): Promise<void> {
    if (!(await ready)) return
    const acts = modeActions(d.getMode())
    if (acts.check && !checking && now() - lastCheckAt >= SOURCE_CHECK_INTERVAL_MS) return void check(false)
    if (acts.build && selfInstall && !building && latest && latest.behind > 0 && !stagedIsCurrent() && mayBuild(saved.failedAt, latest.target, now()))
      return void build()
    if (acts.install && !building && stagedIsCurrent() && d.idleSeconds() >= IDLE_INSTALL_SECONDS && heavyQueue().length === 0) {
      d.log('source install: idle for 10 min with no heavy job running, restarting into the new build')
      void install()
    }
  }

  return {
    start() {
      ready = boot()
      timer = setInterval(() => void advance(), 60_000)
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
    },
    check,
    build,
    install,
    async justUpdated() {
      await ready
      const j = pendingUpdated
      pendingUpdated = null
      return j
    }
  }
}
