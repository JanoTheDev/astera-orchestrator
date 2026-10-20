// T5 crash restore: every CLI tab comes back by itself after a crash or a reboot.
//
// **What is kept.** The Host's live agent sessions (pty notes of kind `session`, core/sessions/manager.ts), in
// `<profile>/host/live-sessions.json`, written whole through a temp file and a rename like the repo's other stores: the
// account, the folder, the title, the roll chain, and the agent CLI's own conversation id once it is known. That id is
// read from the note (`codexSessionId`, a roll's `nativeSessionId`, the `resumeSessionId` it was started with) and, for
// claude, from the session's hook events (`agentSessionOf`), polled, because the app's start empties the hook events
// folder (statusline.ts) and a crash leaves no time to read it. An entry goes when its session ends while this Host runs.
//
// **When it is used.** `leave` writes `clean-exit` on a deliberate way out (idle, `host stop`, a retire) and freezes the
// list first, so the `killAll` on the way out does not empty it; a signal (a reboot's SIGTERM) or a crash writes no
// marker. The next Host's start takes the marker away; with none there, every saved session comes back
// (`restoreSessions`): a person's tab through `createSession` with the provider's native resume, on its account or,
// with "Pick accounts automatically" on and that account over the threshold, the next of the usage order; the dead
// planner of a plan awaiting approval through `jobs-plan` (`--resume` when its conversation is known, else fresh).
// Coordinators are crashResume's (core/orchestration/exec/crashResume.ts), workers the recovery's (host/recovery.ts);
// a replan session is its Job's. Which is which is read from orchestration.json as the crash left it.
//
// Imports only core modules: this bundles into the Host.
import { mkdirSync, promises as fs, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { PtyMeta } from '../core/host/protocol'
import type { OrchState } from '../core/orchestration/state'
import { providerOf } from '../core/providers/meta'
import { claudeHistoryStrategy, findClaudeTranscript } from '../core/history/strategies/claude'
import { copyTranscript } from '../core/rolling/transcript'
import { renameRetrying, readFileRetrying } from '../core/renameRetry'
import type { Account } from '../core/types'
import type { PtyRegistry } from './registry'

export interface SavedSession {
  /** Astera's id for the session (`ASTERA_SESSION`, the note's `id`). */
  sessionId: string
  accountId: string
  cwd: string
  title?: string
  rollAccountIds?: string[]
  /** The agent CLI's own conversation id: what `claude --resume` / `codex resume` takes. */
  nativeSessionId?: string
}

export type SessionRole = 'user' | 'planner' | 'coordinator' | 'worker' | 'replan'

export const sessionRestoreFileIn = (profileDir: string): string => path.join(profileDir, 'host', 'live-sessions.json')
export const cleanExitFileIn = (profileDir: string): string => path.join(profileDir, 'host', 'clean-exit')
/** How often a live session's conversation id is read again from its hook events (it changes on a `/clear`). */
export const NATIVE_POLL_MS = 30_000

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)

/** A saved row from a pty note; null for anything that is not an agent session with an account and a folder. */
export function savedOf(meta: PtyMeta | null): SavedSession | null {
  if (meta?.kind !== 'session') return null
  const r = meta.restore
  const accountId = str(r.accountId)
  const cwd = str(r.cwd)
  if (!accountId || !cwd) return null
  const rolls = Array.isArray(r.rollAccountIds) ? r.rollAccountIds.filter((x): x is string => typeof x === 'string') : []
  const native = str(r.codexSessionId) ?? str(r.nativeSessionId) ?? str(r.resumeSessionId)
  return {
    sessionId: meta.id,
    accountId,
    cwd,
    ...(str(r.title) ? { title: str(r.title) } : {}),
    ...(rolls.length > 0 ? { rollAccountIds: rolls } : {}),
    ...(native ? { nativeSessionId: native } : {})
  }
}

/** The saved list; [] for none, and for a file a torn write or a hand edit left unreadable. Never rejects. */
export async function readSavedSessions(file: string): Promise<SavedSession[]> {
  try {
    const v = JSON.parse(await readFileRetrying(file)) as unknown
    if (!Array.isArray(v)) return []
    return v.filter(
      (x): x is SavedSession => typeof x === 'object' && x !== null && !!str(x.sessionId) && !!str(x.accountId) && !!str(x.cwd)
    )
  } catch {
    return []
  }
}

/** Whether the last Host left on purpose; the marker goes, so a crash from here on reads as one. Never throws. */
export async function takeCleanExit(profileDir: string): Promise<boolean> {
  try {
    await fs.rm(cleanExitFileIn(profileDir))
    return true
  } catch {
    return false
  }
}

/** Synchronous: `leave` calls it on its way out, and nothing after it is sure to get another turn. Never throws. */
export function writeCleanExit(profileDir: string): void {
  try {
    mkdirSync(path.dirname(cleanExitFileIn(profileDir)), { recursive: true })
    writeFileSync(cleanExitFileIn(profileDir), new Date().toISOString(), 'utf8')
  } catch {
    /* read as a crash next time: the sessions it lists come back, which is the safe side */
  }
}

/** What the start brings back: nothing after a clean exit (the marker is taken), else the saved list. Never rejects. */
export async function sessionsLeftBehind(profileDir: string): Promise<SavedSession[]> {
  return (await takeCleanExit(profileDir)) ? [] : readSavedSessions(sessionRestoreFileIn(profileDir))
}

export interface SessionTracker {
  /** No change from here on: the way out's `killAll` must not empty the list a reboot restores. */
  freeze(): void
  /** The writes queued so far, settled. */
  flushed(): Promise<void>
  /** Stops the poll. */
  dispose(): void
}

/** Keeps `file` equal to the registry's live agent sessions, starting from the ones live now. */
export function trackLiveSessions(d: {
  registry: Pick<PtyRegistry, 'list' | 'onMeta' | 'onExit' | 'metaOf' | 'sessionPty'>
  file: string
  /** The conversation id the session's hook events last named, or null. */
  nativeIdOf(sessionId: string): Promise<string | null>
  log(m: string): void
  pollMs?: number
}): SessionTracker {
  const live = new Map<string, SavedSession>()
  let frozen = false
  let queue: Promise<void> = Promise.resolve()
  const save = (): void => {
    if (frozen) return
    const snapshot = JSON.stringify([...live.values()])
    const write = async (): Promise<void> => {
      await fs.mkdir(path.dirname(d.file), { recursive: true })
      const tmp = `${d.file}.${process.pid}.tmp`
      await fs.writeFile(tmp, snapshot, 'utf8')
      await renameRetrying(tmp, d.file)
    }
    queue = queue.then(write).catch((err) => d.log(`live sessions could not be saved: ${String(err)}`))
  }
  const upsert = (meta: PtyMeta | null): void => {
    const row = savedOf(meta)
    if (!row || frozen) return
    // A conversation id learned from the hook events outlives a note that never carried one.
    const known = live.get(row.sessionId)?.nativeSessionId
    const next = { ...row, ...(row.nativeSessionId ? {} : known ? { nativeSessionId: known } : {}) }
    if (JSON.stringify(live.get(row.sessionId)) === JSON.stringify(next)) return
    live.set(row.sessionId, next)
    save()
  }

  for (const e of d.registry.list()) if (e.alive) upsert(e.meta)
  save()
  d.registry.onMeta((_id, meta) => upsert(meta))
  d.registry.onExit((ptyId) => {
    const sid = d.registry.metaOf(ptyId)?.kind === 'session' ? d.registry.metaOf(ptyId)!.id : null
    // A roll keeps the session id on a new pty: the session ended only when none of its ptys lives.
    if (frozen || sid === null || !live.has(sid) || d.registry.sessionPty(sid) !== null) return
    live.delete(sid)
    save()
  })
  const poll = async (): Promise<void> => {
    for (const row of [...live.values()]) {
      const native = await d.nativeIdOf(row.sessionId).catch(() => null)
      const cur = live.get(row.sessionId)
      if (!native || !cur || cur.nativeSessionId === native || frozen) continue
      live.set(row.sessionId, { ...cur, nativeSessionId: native })
      save()
    }
  }
  const timer = setInterval(() => void poll(), d.pollMs ?? NATIVE_POLL_MS)
  timer.unref?.()
  return {
    freeze: () => {
      frozen = true
    },
    flushed: () => queue,
    dispose: () => clearInterval(timer)
  }
}

/** What the orchestration state says a session is. A worker is any session that ever held a Dispatch. */
export function roleOf(s: OrchState | null, sessionId: string): SessionRole {
  if (!s) return 'user'
  if (s.dispatches.some((x) => x.sessionId === sessionId)) return 'worker'
  if (s.runs.some((r) => r.coordinatorSessionId === sessionId || r.externalCoordinatorSessionId === sessionId)) return 'coordinator'
  if (s.jobs.some((j) => j.replanning?.sessionId === sessionId)) return 'replan'
  if (s.jobs.some((j) => j.plannerSessionIds?.includes(sessionId))) return 'planner'
  return 'user'
}

export interface RestoreDeps {
  saved: SavedSession[]
  /** orchestration.json as the crash left it, before a load; null when there is none. */
  state: OrchState | null
  /** The conversation id the dead session's hook events last named, if they are still there. */
  nativeIdOf(sessionId: string): Promise<string | null>
  /** The Host spawner's `createSession`. */
  createSession(o: {
    accountId: string
    cwd: string
    title?: string
    rollAccountIds: string[]
    resumeSessionId: string
    autoAccounts: boolean
  }): Promise<{ id: string }>
  /** A command under the Host's own caller. */
  handle(cmd: string, args: Record<string, unknown>): Promise<{ status: number; body: unknown }>
  log(m: string): void
}

/** Brings back the sessions an unclean exit left: tabs and pending plans' planners. Never rejects. */
export async function restoreSessions(d: RestoreDeps): Promise<{ tabs: number; planners: number }> {
  let tabs = 0
  let planners = 0
  for (const row of d.saved) {
    try {
      const role = roleOf(d.state, row.sessionId)
      const native = (await d.nativeIdOf(row.sessionId).catch(() => null)) ?? row.nativeSessionId ?? null
      if (role === 'planner') {
        const job = d.state?.jobs.find((j) => j.plannerSessionIds?.includes(row.sessionId))
        // Only the plan's current planner, and only while the plan awaits approval (W2-A's `pendingStart`).
        if (!job?.pendingStart || job.plannerSessionIds?.at(-1) !== row.sessionId || job.archivedAt !== undefined) continue
        let r = native ? await d.handle('jobs-plan', { id: job.id, resume: native }) : null
        if (r && r.status >= 300) d.log(`session restore: planner of ${job.id} could not resume ${native} (${r.status}); starting a fresh one`)
        if (!r || r.status >= 300) r = await d.handle('jobs-plan', { id: job.id })
        if (r.status < 300) planners++
        else d.log(`session restore: planner of ${job.id} could not be restarted (${r.status} ${JSON.stringify(r.body)})`)
        continue
      }
      if (role !== 'user') continue
      if (!native) {
        d.log(`session restore: ${row.sessionId} in ${row.cwd} has no conversation id to resume; left closed`)
        continue
      }
      const info = await d.createSession({
        accountId: row.accountId,
        cwd: row.cwd,
        ...(row.title !== undefined ? { title: row.title } : {}),
        rollAccountIds: row.rollAccountIds ?? [],
        resumeSessionId: native,
        autoAccounts: true
      })
      d.log(`session restore: ${row.sessionId} resumed as ${info.id} (conversation ${native}) in ${row.cwd}`)
      tabs++
    } catch (err) {
      d.log(`session restore: ${row.sessionId} could not be resumed: ${String(err)}`)
    }
  }
  return { tabs, planners }
}

/** A claude conversation resumed on `account` while its transcript is under another claude account's folder (the
 *  automatic accounts picked another one): copied there first, as a roll carries it (claudeCoordinator.ts). Nothing
 *  when it is already there or nowhere. shortcut: claude only — a codex rollout is found by its path, which a resume
 *  id alone does not give; a codex resume stays on the account it was recorded on unless the rolling moves it. */
export async function carryTranscript(
  account: Account,
  accounts: Account[],
  nativeId: string,
  io: { find(configDir: string, id: string): Promise<string | null>; copy(src: string, dest: string): Promise<void> } = {
    find: findClaudeTranscript,
    copy: (src, dest) => copyTranscript(src, dest)
  }
): Promise<void> {
  if (providerOf(account) !== 'claude' || (await io.find(account.configDir, nativeId))) return
  for (const other of accounts) {
    if (other.id === account.id || providerOf(other) !== 'claude') continue
    const src = await io.find(other.configDir, nativeId)
    if (src) return io.copy(src, claudeHistoryStrategy.mapTargetPath(src, account.configDir))
  }
}
