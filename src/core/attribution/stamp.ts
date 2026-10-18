// W8-A: the stamp. When a worker reports done, every commit its attempt added (`base..HEAD` in its worktree) gets the
// Wave 8 note naming that worker: Job, Task, session, agent, model, account and role. The commits themselves are never
// rewritten or amended; the note sits beside them on `refs/notes/astera`.
//
// Who made each commit is read off the session's busy windows (EG §26: a turn runs from the prompt to `Stop`), from its
// hook-events file: a commit made inside a window is the agent's, one made while the session sat idle is the owner's
// (`human: true`). A commit inside a window by another author than the worktree's own is `unknown`: never AI on a guess.
import { promises as fs } from 'node:fs'
import type { GitRun } from '../git/range'
import { hookEventAt } from '../hooks/eventTime'
import { hookEventState } from '../hooks/sessionState'
import { git as realGit, GIT_WRITE_TIMEOUT_MS } from '../worktrees/git'
import { linesForCommit } from './lines'
import { ensureNotesConfig, notesIndex, writeNote, type AttributionNote } from './note'

/** One stretch in which the session was busy, epoch ms. */
export interface BusyWindow {
  start: number
  end: number
}

/** A commit's time is whole seconds and its capture stamps are ms: the slack both ends of a window get. */
export const WINDOW_SLACK_MS = 2_000

/** The busy windows in a session's hook-events lines: from a `working` or `waiting` event (a permission prompt is
 *  still the agent's turn) to the next `idle`. A turn still open runs to the end of time. Lines without a stamp, or
 *  that are not JSON, are skipped. */
export function busyWindowsOf(lines: readonly string[]): BusyWindow[] {
  const out: BusyWindow[] = []
  let open: number | null = null
  for (const line of lines) {
    let p: unknown
    try {
      p = JSON.parse(line)
    } catch {
      continue
    }
    const at = hookEventAt(p)
    const state = hookEventState(p)
    if (at === null || state === null) continue
    if (state === 'idle') {
      if (open !== null) out.push({ start: open - WINDOW_SLACK_MS, end: at + WINDOW_SLACK_MS })
      open = null
    } else if (open === null) open = at
  }
  if (open !== null) out.push({ start: open - WINDOW_SLACK_MS, end: Number.POSITIVE_INFINITY })
  return out
}

/** The windows of one session from its hook-events file, or null when there is no file to read. */
export async function readBusyWindows(file: string): Promise<BusyWindow[] | null> {
  try {
    return busyWindowsOf((await fs.readFile(file, 'utf8')).split('\n'))
  } catch {
    return null
  }
}

export type StampIdentity = Pick<AttributionNote, 'job' | 'task' | 'session' | 'agent' | 'model' | 'account' | 'role'>

export interface StampedCommit {
  sha: string
  kind: 'ai' | 'human' | 'unknown'
}

/** Who made a commit made at `ms` by `author`, given the session's windows and the worktree's own author. */
export function commitKind(ms: number, author: string, windows: readonly BusyWindow[], own: string | null): StampedCommit['kind'] {
  const inside = windows.some((w) => ms >= w.start && ms <= w.end)
  if (!inside) return 'human'
  return own !== null && author.toLowerCase() !== own.toLowerCase() ? 'unknown' : 'ai'
}

/**
 * The line data of one commit (lines.ts), spread into its note: `session`, `lines` and `human`, only those present.
 * A failure is logged and answers nothing, so the note is written without line data.
 */
async function lineDataOf(
  a: { cwd: string; profileDir?: string; windows: readonly BusyWindow[]; identity: StampIdentity; log?: (msg: string) => void; run: GitRun },
  sha: string
): Promise<Partial<Pick<AttributionNote, 'session' | 'lines' | 'human'>>> {
  if (a.profileDir === undefined) return {}
  try {
    const busy = a.windows.map((w) => ({ session: a.identity.session, from: w.start, to: w.end }))
    const r = await linesForCommit({ repo: a.cwd, sha, profileDir: a.profileDir, busy, run: a.run })
    return {
      ...(r.session !== undefined ? { session: r.session } : {}),
      ...(r.lines !== undefined ? { lines: r.lines } : {}),
      ...(r.human ? { human: true as const } : {})
    }
  } catch (e) {
    a.log?.(`stamp ${sha}: line attribution failed, noted without line data: ${String(e)}`)
    return {}
  }
}

/**
 * Notes every commit the attempt added in `cwd` over `base`: its own commits only (first parent, merges skipped, so a
 * dependency's commits merged in at the start keep their own notes), and only those with no note yet. Answers what it noted, oldest first; empty when
 * git could not list the range. Never throws. With `profileDir`, each note also carries its commit's line data.
 */
export async function stampCommits(a: {
  cwd: string
  base: string
  head?: string
  identity: StampIdentity
  windows: readonly BusyWindow[]
  profileDir?: string
  log?: (msg: string) => void
  run?: GitRun
}): Promise<StampedCommit[]> {
  const run = a.run ?? realGit
  const o = { cwd: a.cwd, timeoutMs: GIT_WRITE_TIMEOUT_MS }
  try {
    await ensureNotesConfig(a.cwd, run)
    const log = await run(
      ['log', '--reverse', '--first-parent', '--no-merges', '--format=%H%x00%ct%x00%ae', `${a.base}..${a.head ?? 'HEAD'}`],
      o
    )
    if (!log.ok) return []
    const own = await run(['config', 'user.email'], o)
    // A commit already noted keeps its note: a repair or review attempt over the same base did not make it
    const noted = await notesIndex(a.cwd, run)
    const out: StampedCommit[] = []
    for (const line of log.stdout.split('\n')) {
      const [sha, ct, author] = line.split('\0')
      if (!sha || !ct || noted?.has(sha)) continue
      const kind = commitKind(Number(ct) * 1000, author ?? '', a.windows, own.ok ? own.stdout.trim() : null)
      const note: AttributionNote = {
        v: 1,
        tool: 'astera',
        ...a.identity,
        ...(kind === 'human' ? { human: true as const } : kind === 'unknown' ? { unknown: true as const } : {}),
        ...(await lineDataOf({ ...a, run }, sha))
      }
      if (await writeNote(a.cwd, sha, note, run)) out.push({ sha, kind })
    }
    return out
  } catch {
    return []
  }
}
