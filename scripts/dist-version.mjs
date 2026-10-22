// The version a packaged Astera build carries (docs/releasing.md, "Build versions"). A local build is
// <package version>-build.<UTC time>.<short sha>, so no two builds share a name, and the package.json on disk is never
// rewritten. A build whose HEAD is the release tag v<package version> keeps the plain version: that is what release CI
// ships, and electron-updater must order it as the release it is.
//   node scripts/dist-version.mjs                              prints the version
//   node scripts/dist-version.mjs --electron-builder <args>    runs electron-builder with that version as extraMetadata
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

export function currentBuildVersion(now = new Date()) {
  const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  return buildVersion({ version, now, ...gitFacts(version) })
}

if (isMain(process.argv[1], import.meta.url)) {
  const [flag, ...args] = process.argv.slice(2)
  const version = currentBuildVersion()
  if (flag === undefined) {
    process.stdout.write(`${version}\n`)
  } else if (flag === '--electron-builder') {
    // shell on Windows: npm puts node_modules/.bin on PATH there as a .cmd shim, which spawn cannot run directly.
    const r = spawnSync('electron-builder', [`-c.extraMetadata.version=${version}`, ...args], { stdio: 'inherit', shell: process.platform === 'win32' })
    process.exit(r.status ?? 1)
  } else {
    process.stderr.write('usage: dist-version.mjs | dist-version.mjs --electron-builder <args>\n')
    process.exit(2)
  }
}
