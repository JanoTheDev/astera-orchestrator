// The "source" update channel: an Astera built from a git checkout (scripts/build.sh) checks that checkout's
// origin/main for new commits, builds the new AppImage in a private clone and starts it on a restart. The wiring
// (git, npm, spawn) is src/main/sourceUpdate.ts; this file holds the facts the build baked in and the decisions.
import type { UpdateMode } from '../types'

// Baked in by electron.vite.config.ts `define` for the main bundle. Undefined under vitest, which reads as off.
declare const __ASTERA_COMMIT__: string | undefined
declare const __ASTERA_SOURCE_DIR__: string | undefined

/** The commit this build was made from ('' when git could not say). */
export const BUILT_COMMIT: string = typeof __ASTERA_COMMIT__ === 'string' ? __ASTERA_COMMIT__ : ''
/** The checkout this build was made from ('' when unknown). */
export const SOURCE_DIR: string = typeof __ASTERA_SOURCE_DIR__ === 'string' ? __ASTERA_SOURCE_DIR__ : ''

export const SOURCE_CHECK_INTERVAL_MS = 30 * 60_000
export const SOURCE_FIRST_CHECK_DELAY_MS = 60_000
/** A target commit whose build failed is not tried again for this long. */
export const BUILD_RETRY_MS = 6 * 60 * 60_000
/** install-when-idle restarts only after this much time without user input. */
export const IDLE_INSTALL_SECONDS = 10 * 60
export const MAX_LISTED_COMMITS = 20
export const UPDATE_MODES: readonly UpdateMode[] = ['off', 'notify', 'build', 'install-when-idle']
export const DEFAULT_UPDATE_MODE: UpdateMode = 'build'

export const isUpdateMode = (v: unknown): v is UpdateMode => UPDATE_MODES.includes(v as UpdateMode)

export interface SourceCommit {
  sha: string
  subject: string
}

/** `git log --format=%H%x09%s` output, one commit per line. */
export function parseCommitLog(stdout: string): SourceCommit[] {
  return stdout
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => /^[0-9a-f]{7,64}\t/.test(l))
    .map((l) => {
      const tab = l.indexOf('\t')
      return { sha: l.slice(0, tab), subject: l.slice(tab + 1) }
    })
}

/** What a mode does on its own. A manual check works in every mode. */
export function modeActions(mode: UpdateMode): { check: boolean; build: boolean; install: boolean } {
  return {
    check: mode !== 'off',
    build: mode === 'build' || mode === 'install-when-idle',
    install: mode === 'install-when-idle'
  }
}

/** Only an AppImage on Linux can be built and swapped in; anywhere else the channel checks and tells. */
export const canSelfInstall = (platform: NodeJS.Platform, appImage: string | undefined): boolean =>
  platform === 'linux' && !!appImage

/** `npm ci` runs when the lockfile changed since the last successful install, or nothing was installed yet. */
export const needsInstall = (lockHash: string, recordedHash: string | undefined, nodeModulesPresent: boolean): boolean =>
  !nodeModulesPresent || recordedHash !== lockHash

/** Whether a build of `target` may start: a failed attempt blocks the same commit for BUILD_RETRY_MS. */
export function mayBuild(failedAt: Record<string, number>, target: string, now: number): boolean {
  const at = failedAt[target]
  return at === undefined || now - at >= BUILD_RETRY_MS
}

/** The staged AppImage name for a build of `sha` at package version `version`. */
export const stagedName = (version: string, sha: string): string => `astera-${version}-${sha.slice(0, 7)}.AppImage`

/** The AppImages in the staging folder to delete at boot: every one but those in `keep` (base names). */
export const appImagesToDelete = (files: string[], keep: (string | undefined)[]): string[] =>
  files.filter((f) => f.endsWith('.AppImage') && !keep.includes(f))

/** The last line of a build log worth showing: the last non-empty one, trimmed to a status-line length. */
export function lastUsefulLine(log: string): string {
  const lines = log.split('\n').map((l) => l.trim()).filter((l) => l !== '')
  const line = [...lines].reverse().find((l) => /error|ERR!|failed|cannot|not found/i.test(l)) ?? lines.at(-1) ?? ''
  return line.length > 300 ? `${line.slice(0, 297)}...` : line
}
