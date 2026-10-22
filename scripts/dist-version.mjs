// The version a packaged Astera build carries (docs/releasing.md, "Build versions"). A local build is
// <package version>-build.<UTC time>.<short sha>, so no two builds share a name, and the package.json on disk is never
// rewritten. A build whose HEAD is the release tag v<package version> keeps the plain version: that is what release CI
// ships, and electron-updater must order it as the release it is.
//
// One version per dist run, given to every step that bakes it: electron-builder (extraMetadata, so app.getVersion() and
// the artifact names), and the processes before it that read ASTERA_BUILD_VERSION (electron-vite, host-runtime). The
// Host runtime is laid out under builds/<that version>, and the app looks for it under app.getVersion(), so they must agree.
//   node scripts/dist-version.mjs                                  prints the version
//   node scripts/dist-version.mjs <cmd> <args> + <cmd> <args>      runs the steps in order, stopping at the first failure
// A step starting with electron-builder gets -c.extraMetadata.version=<version> inserted.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMain } from './build-packages.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** `YYYYMMDDHHmm` in UTC. */
export function utcStamp(now) {
  const p = (n) => String(n).padStart(2, '0')
  return `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}${p(now.getUTCHours())}${p(now.getUTCMinutes())}`
}

/** The version for one build. `sha` is null outside a git checkout (a tarball). */
export function buildVersion({ version, now, sha, tagAtHead }) {
  if (tagAtHead) return version
  return `${version}-build.${utcStamp(now)}${sha ? `.${sha}` : ''}`
}

/** What git says about HEAD: its short sha, and whether a tag v<version> points at it. */
export function gitFacts(version) {
  const git = (args) => {
    try {
      return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    } catch {
      return ''
    }
  }
  return { sha: git(['rev-parse', '--short=7', 'HEAD']) || null, tagAtHead: git(['tag', '--points-at', 'HEAD']).split('\n').includes(`v${version}`) }
}

/** Whether this CI run was started by the tag v<version>. Does not need git: a container job cannot always read the checkout's .git. */
export function ciTagIs(version, env = process.env) {
  return env.GITHUB_REF_TYPE === 'tag' && env.GITHUB_REF_NAME === `v${version}`
}

export function currentBuildVersion(now = new Date()) {
  const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const git = gitFacts(version)
  return buildVersion({ version, now, sha: git.sha, tagAtHead: git.tagAtHead || ciTagIs(version) })
}

/** The argv tokens split on `+` into steps. Throws when a step is empty. */
export function chainSteps(argv) {
  const steps = [[]]
  for (const t of argv) t === '+' ? steps.push([]) : steps.at(-1).push(t)
  if (steps.some((s) => s.length === 0)) throw new Error('usage: dist-version.mjs <cmd> <args> [+ <cmd> <args>]…')
  return steps
}

/** A step with the version handed to electron-builder; any other step is unchanged. */
export function withVersion(step, version) {
  return step[0] === 'electron-builder' ? [step[0], `-c.extraMetadata.version=${version}`, ...step.slice(1)] : step
}

if (isMain(process.argv[1], import.meta.url)) {
  const argv = process.argv.slice(2)
  const version = currentBuildVersion()
  if (argv.length === 0) {
    process.stdout.write(`${version}\n`)
  } else {
    let steps
    try {
      steps = chainSteps(argv)
    } catch (e) {
      process.stderr.write(`${e.message}\n`)
      process.exit(2)
    }
    const env = { ...process.env, ASTERA_BUILD_VERSION: version }
    for (const step of steps) {
      // shell: npm puts node_modules/.bin on PATH, where the Windows entry is a .cmd shim spawn cannot run directly.
      const r = spawnSync(withVersion(step, version).join(' '), { stdio: 'inherit', shell: true, env })
      if (r.status !== 0) process.exit(r.status ?? 1)
    }
  }
}
