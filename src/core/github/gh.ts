import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import type { GhFailureKind, GhProbe } from './types'
import { windowsExecutable } from '../sessions/windowsExecutable'
import { ARGV_TOO_LONG_CODES, warnLongArgv } from '../git/argvBudget'

export interface GhResult {
  ok: boolean
  stdout: string
  stderr: string
  /** Set when the process could not be spawned, or its output could not be captured in full.
   *  'ENOENT' means gh is not installed; MAX_BUFFER_ERROR_CODE means stdout overflowed
   *  maxBuffer and was truncated — a real (partial) result, not a plain spawn failure. 'ENAMETOOLONG' / 'E2BIG':
   *  the command line was too long to start. */
  spawnError?: string
  /** The exit code when the process ran to an exit (absent when it was killed or never started).
   *  Some gh commands answer with a non-zero code and a full result on stdout (`gh pr checks`:
   *  1 failing, 8 pending). */
  exitCode?: number
}

/** How core code runs gh: injectable, so tests never need a real gh. */
export type GhRunner = (args: string[], cwd: string) => Promise<GhResult>

export const defaultGhRunner: GhRunner = (a, cwd) => gh(a, { cwd })

const DEFAULT_TIMEOUT_MS = 30_000
/** `gh pr list --json ...,statusCheckRollup --limit 200` is the heaviest query this feature
 *  makes. A measured statusCheckRollup element runs ~265 bytes, so the 1 MiB Node default
 *  overflows at roughly 19 checks per PR on average — routine for matrix CI (e.g. 3 OS x 3
 *  versions plus lint/build/e2e). Do not "simplify" this back to the default. */
const MAX_BUFFER_BYTES = 32 * 1024 * 1024
const MAX_BUFFER_ERROR_CODE = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'

/** gh execution adapter — the same shape as git() in ../worktrees/git.ts: no shell (avoids
 *  quoting problems), and a failure does not throw, it returns ok=false. Unlike git(), this
 *  call's heaviest output (see MAX_BUFFER_BYTES above) can exceed Node's 1 MiB default, so the
 *  buffer is sized explicitly rather than inherited. */
export function gh(args: string[], opts?: { cwd?: string; timeoutMs?: number }): Promise<GhResult> {
  return new Promise((resolve) => {
    const file = windowsExecutable('gh')
    warnLongArgv(file, args)
    const done = (err: unknown, stdout: string | undefined, stderr: string | undefined): void => {
      // execFile puts a numeric exit code and a string spawn error code on the same field
      const code: unknown = err ? (err as { code?: unknown }).code : 0
      const tooLong = typeof code === 'string' && ARGV_TOO_LONG_CODES.has(code)
      const spawnFailed = code === 'ENOENT' || code === MAX_BUFFER_ERROR_CODE || tooLong
      resolve({
        ok: !err,
        stdout: (stdout ?? '').trim(),
        // a too-long command line leaves stderr empty: the error's own words are the only explanation
        stderr: ((stderr ?? '').trim() || (tooLong ? String((err as Error).message) : '')),
        ...(spawnFailed ? { spawnError: code as string } : {}),
        ...(typeof code === 'number' ? { exitCode: code } : {})
      })
    }
    try {
      // By PATH on win32, not by name, for the reason git.ts gives (windowsExecutable.ts)
      execFile(
        file,
        args,
        {
          cwd: opts?.cwd,
          timeout: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          windowsHide: true,
          maxBuffer: MAX_BUFFER_BYTES
        },
        done
      )
    } catch (err) {
      // execFile throws synchronously for some spawn failures on Windows (an over-long command line among them)
      done(err, '', err instanceof Error ? err.message : String(err))
    }
  })
}

/** Writes `content` (UTF-8) to a new file in the OS temp dir, hands its path to `fn`, and removes it afterwards, whatever
 *  `fn` does. This is how a long input (a PR body) reaches gh: a command line grows with it, and Windows caps one at
 *  ~32k characters (`spawn ENAMETOOLONG`). A file that cannot be written comes back as a failed result, never a throw. */
export async function withTempFile(name: string, content: string, fn: (file: string) => Promise<GhResult>): Promise<GhResult> {
  const file = path.join(tmpdir(), `astera-${randomBytes(6).toString('hex')}-${name}`)
  try {
    await fs.writeFile(file, content, 'utf8')
  } catch (err) {
    return { ok: false, stdout: '', stderr: `could not write ${file}: ${err instanceof Error ? err.message : String(err)}` }
  }
  try {
    return await fn(file)
  } finally {
    await fs.rm(file, { force: true }).catch(() => {})
  }
}

/** Sorts a gh failure into the buckets the coordinator and the settings card act on.
 *  Tested against real gh stderr strings — keep new samples in gh.test.ts when one is met
 *  in the wild that lands in the wrong bucket.
 *
 *  `spawnError` is checked first: a maxBuffer overflow leaves stderr empty (see gh.ts's
 *  MAX_BUFFER_BYTES comment), so stderr text alone cannot tell a truncated read apart from any
 *  other silently-retried 'other' failure — it has to be read off the result's spawnError. */
export function classifyGhFailure(stderr: string, spawnError?: string): GhFailureKind {
  if (spawnError === MAX_BUFFER_ERROR_CODE) return 'truncated'
  const s = stderr.toLowerCase()
  if (s.includes('rate limit')) return 'rate-limit'
  if (s.includes('http 401') || s.includes('bad credentials') || s.includes('gh auth login') || s.includes('not logged in'))
    return 'auth'
  if (s.includes('http 404') || s.includes('could not resolve to a repository')) return 'not-found'
  if (s.includes('no git remotes found')) return 'no-remote'
  if (
    s.includes('no such host') ||
    s.includes('dial tcp') ||
    s.includes('connection refused') ||
    s.includes('timeout exceeded') ||
    s.includes('request canceled')
  )
    return 'network'
  return 'other'
}

export type GhErrorKind = GhFailureKind | 'not-installed'

/** A failed gh call as core answers it: the kind, and one sentence a person or an agent can act on. */
export type GhFailed = { ok: false; kind: GhErrorKind; message: string }

/** GraphQL's words for a pull request or issue that is not there (`gh pr checks 999`); REST says HTTP 404. */
const GRAPHQL_MISSING = /could not resolve to an? (pullrequest|issue)\b/i

/** One sentence for a failed gh call. Where gh's own words help, its first stderr line ends the
 *  sentence; not-installed, auth, no-remote and truncated say all there is to say without it.
 *
 *  GraphQL's missing pull request or issue is not-found here and not in `classifyGhFailure`: the PR
 *  badge coordinator sorts its failures with that one, and its buckets stay as they are. */
export function ghFailureSentence(r: GhResult): { kind: GhErrorKind; message: string } {
  if (r.spawnError === 'ENOENT')
    return { kind: 'not-installed', message: "GitHub CLI (gh) is not installed or not on the Astera Host's PATH" }
  const classified = classifyGhFailure(r.stderr, r.spawnError)
  const kind = classified === 'other' && GRAPHQL_MISSING.test(r.stderr) ? 'not-found' : classified
  const first = r.stderr.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? ''
  const ending = (s: string): string => (first ? `${s}: ${first}` : s)
  switch (kind) {
    case 'auth':
      return { kind, message: 'gh is not logged in: run `gh auth login`' }
    case 'rate-limit':
      return { kind, message: ending('GitHub rate limit reached') }
    case 'not-found':
      return { kind, message: ending('GitHub found no such repository, pull request, issue or run') }
    case 'no-remote':
      return { kind, message: "This folder's git repository has no remote for gh to use" }
    case 'network':
      return { kind, message: ending('Could not reach GitHub') }
    case 'truncated':
      return { kind, message: "gh's answer was too large and was cut off" }
    case 'other':
      return { kind, message: ending('gh failed') }
  }
}

/** `gh auth status` reader. The runner is injectable so tests never need a real gh; production
 *  callers pass nothing. gh historically writes this output to stderr, so both streams are read. */
export async function probeGh(runner: typeof gh = gh): Promise<GhProbe> {
  const r = await runner(['auth', 'status'])
  if (r.spawnError === 'ENOENT') return { kind: 'not-installed' }
  const out = `${r.stdout}\n${r.stderr}`
  if (r.ok) {
    // Two phrasings across gh versions: "Logged in to <host> account <login> (keyring)"
    // and "Logged in to <host> as <login> (oauth_token)".
    const m = out.match(/Logged in to \S+ (?:account|as) (\S+)/)
    return { kind: 'connected', ...(m ? { account: m[1] } : {}) }
  }
  if (/not logged in|gh auth login/i.test(out)) return { kind: 'not-authenticated' }
  return { kind: 'error' }
}
