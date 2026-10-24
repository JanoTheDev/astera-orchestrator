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
// **A handover** (a `retire` with `resume: true`: the app replacing an outdated Host) is the deliberate way out that
// brings everything back. Before its `killAll` the leaving Host writes `<profile>/host/handover.json` (`handoverOf`):
// the saved sessions with the Dispatch each worker held, and the shell terminals and run processes the app opened,
// each as its `pty-spawn` was (the shell, the folder, the size, the env that differs from the Host's own). Only then
// `clean-exit`, so a Host that dies before the file is written is read as a crash. The next Host takes the handover
// first (`leftBehind`): the sessions come back as after a crash but under their own ids (a tab and a Dispatch keyed by
// the id find them again), a worker done with its Dispatch with them; the ptys are reopened under their own note, so
// the app adopts each into the tab or run row it had; then the file goes (`restoreHandover`).
//
// **Chats ride it too** (`HandoverChat`): each live chat proc's note — its id, account, folder, thread, title, model,
// unattended policy, chain and startedAt — is written down, and the next Host respawns it on the same thread under the
// same id (`respawnChat`: HostChats.spawn, then the `proc-opened` the app takes a Host-started chat back by), so its tab
// finds it again with its history. Only an idle chat is handed over by the automatic swap: the app waits out a turn
// (main/ipc.ts hostReplaceDue), since the respawn resumes the thread and a turn cut short is not carried.
//
// Imports only core modules: this bundles into the Host.
import { mkdirSync, promises as fs, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { PtyMeta, PtyOpenOptions } from '../core/host/protocol'
import type { OrchState } from '../core/orchestration/state'
import { providerOf } from '../core/providers/meta'
import { claudeHistoryStrategy, findClaudeTranscript } from '../core/history/strategies/claude'
import { copyTranscript } from '../core/rolling/transcript'
import { renameRetrying, readFileRetrying } from '../core/renameRetry'
import type { Account } from '../core/types'
import { isUnattendedPermission, type UnattendedPermission } from '../core/chat/types'
import type { ChatRollSpawn } from '../core/chat/respawn'
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
  /** When the session first started (SessionInfo.startedAt): a resumed session keeps its elapsed time. */
  startedAt?: number
}

export type SessionRole = 'user' | 'planner' | 'coordinator' | 'worker' | 'replan'

export const sessionRestoreFileIn = (profileDir: string): string => path.join(profileDir, 'host', 'live-sessions.json')
export const cleanExitFileIn = (profileDir: string): string => path.join(profileDir, 'host', 'clean-exit')
export const handoverFileIn = (profileDir: string): string => path.join(profileDir, 'host', 'handover.json')

/** A saved session in a handover, with the Dispatch it held last when it is a worker. */
export type HandoverSession = SavedSession & { dispatchId?: string }

/** A shell terminal or a run process, as the app's `pty-spawn` opened it. */
export interface HandoverPty {
  /** Its note: the kind, and the app's own id the tab or the run row is keyed by. */
  meta: PtyMeta
  file: string
  args: string[] | string
  cwd: string
  cols: number
  rows: number
  /** Only what differs from the Host's own worker env (a run configuration's env, what the app adds). */
  env: Record<string, string>
}

/** A chat session, as its proc's note had it: what the next Host respawns it from (core/chat/respawn.ts ChatRollSpawn). */
export interface HandoverChat {
  sessionId: string
  accountId: string
  cwd: string
  /** The thread it resumes; absent for a chat that never had one (it starts fresh, under its own id). */
  threadId?: string
  title?: string
  model?: string
  unattendedPermission?: UnattendedPermission
  startedAt?: number
  rollAccountIds?: string[]
  rollPrompt?: string
  slackNotify?: boolean
  bypassPermissions?: boolean
  /** The toolchain bypass the chain was granted (`bypassedToolchain`), which a respawn keeps. */
  startWithBypass?: boolean
}

export interface Handover {
  sessions: HandoverSession[]
  ptys: HandoverPty[]
  /** Absent in a handover an older Host wrote. */
  chats?: HandoverChat[]
}

/** A `pty-spawn` as the Host received it, with the size it was last given. */
export interface PtySpawn {
  file: string
  args: string[] | string
  opts: PtyOpenOptions
  meta?: PtyMeta
}

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
    ...(native ? { nativeSessionId: native } : {}),
    ...(typeof r.startedAt === 'number' ? { startedAt: r.startedAt } : {})
  }
}

const isSaved = (x: unknown): x is SavedSession => {
  const r = x as Partial<SavedSession> | null
  return typeof r === 'object' && r !== null && !!str(r.sessionId) && !!str(r.accountId) && !!str(r.cwd)
}
/** A handover row from a chat proc's note; null for anything that is not a chat with an account and a folder. */
export function handoverChatOf(meta: PtyMeta | null): HandoverChat | null {
  if (meta?.kind !== 'chat') return null
  const r = meta.restore
  const accountId = str(r.accountId)
  const cwd = str(r.cwd)
  if (!accountId || !cwd) return null
  const rolls = Array.isArray(r.rollAccountIds) ? r.rollAccountIds.filter((x): x is string => typeof x === 'string') : undefined
  return {
    sessionId: meta.id,
    accountId,
    cwd,
    ...(str(r.threadId) ? { threadId: str(r.threadId) } : {}),
    ...(str(r.title) ? { title: str(r.title) } : {}),
    ...(str(r.chosenModel) ? { model: str(r.chosenModel) } : {}),
    ...(isUnattendedPermission(r.unattendedPermission) ? { unattendedPermission: r.unattendedPermission } : {}),
    ...(typeof r.startedAt === 'number' ? { startedAt: r.startedAt } : {}),
    ...(rolls ? { rollAccountIds: rolls } : {}),
    ...(typeof r.rollPrompt === 'string' ? { rollPrompt: r.rollPrompt } : {}),
    ...(typeof r.slackNotify === 'boolean' ? { slackNotify: r.slackNotify } : {}),
    ...(typeof r.bypassPermissions === 'boolean' ? { bypassPermissions: r.bypassPermissions } : {}),
    ...(r.bypassedToolchain === true ? { startWithBypass: true } : {})
  }
}

/** What HostChats.spawn takes to bring a handed-over chat back: on its thread, under its own id, with its title, model,
 *  policy, chain and startedAt. */
export function chatRespawnOf(c: HandoverChat, account: Account): ChatRollSpawn {
  const { threadId, model, accountId: _, ...rest } = c
  return { ...rest, account, ...(threadId ? { resumeSessionId: threadId } : {}), ...(model ? { model } : {}) }
}

const isHandoverChat = (x: unknown): x is HandoverChat => {
  const c = x as Partial<HandoverChat> | null
  return typeof c === 'object' && c !== null && !!str(c.sessionId) && !!str(c.accountId) && !!str(c.cwd)
}
const isHandoverPty = (x: unknown): x is HandoverPty => {
  const p = x as Partial<HandoverPty> | null
  return (
    typeof p === 'object' && p !== null && (p.meta?.kind === 'terminal' || p.meta?.kind === 'run') && !!str(p.meta.id) &&
    !!str(p.file) && !!str(p.cwd) && typeof p.env === 'object' && p.env !== null
  )
}

/** The saved list; [] for none, and for a file a torn write or a hand edit left unreadable. Never rejects. */
export async function readSavedSessions(file: string): Promise<SavedSession[]> {
  try {
    const v = JSON.parse(await readFileRetrying(file)) as unknown
    return Array.isArray(v) ? v.filter(isSaved) : []
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

/** What the last Host wrote on a handover; null for none, and for a file a torn write left unreadable. Never rejects. */
async function readHandover(profileDir: string): Promise<Handover | null> {
  try {
    const v = JSON.parse(await readFileRetrying(handoverFileIn(profileDir))) as Partial<Handover> | null
    if (!v || !Array.isArray(v.sessions) || !Array.isArray(v.ptys)) return null
    return { sessions: v.sessions.filter(isSaved), ptys: v.ptys.filter(isHandoverPty), chats: Array.isArray(v.chats) ? v.chats.filter(isHandoverChat) : [] }
  } catch {
    return null
  }
}

/** What the start brings back: a handover when the last Host left one (and then not the crash list too, which would
 *  bring the same sessions back twice), else what `sessionsLeftBehind` says. The marker is taken either way. */
export async function leftBehind(profileDir: string): Promise<{ handover: Handover | null; saved: SavedSession[] }> {
  const handover = await readHandover(profileDir)
  if (!handover) return { handover, saved: await sessionsLeftBehind(profileDir) }
  await takeCleanExit(profileDir)
  return { handover, saved: [] }
}

/** The handover of a Host leaving on a resume retire: its saved sessions, each worker's last Dispatch, the shell
 *  terminals and run processes among `ptys` (the live `pty-spawn`s; an agent session's own is the session list's), and
 *  the chats among `procs` (the live line processes' notes). */
export function handoverOf(a: { sessions: SavedSession[]; ptys: PtySpawn[]; procs: Array<PtyMeta | null>; state: OrchState | null; baseEnv: NodeJS.ProcessEnv }): Handover {
  return {
    chats: a.procs.flatMap((m) => handoverChatOf(m) ?? []),
    sessions: a.sessions.map((row) => {
      const dispatchId = a.state?.dispatches.filter((x) => x.sessionId === row.sessionId).at(-1)?.id
      return dispatchId ? { ...row, dispatchId } : row
    }),
    ptys: a.ptys.flatMap((p) => {
      if (p.meta?.kind !== 'terminal' && p.meta?.kind !== 'run') return []
      // shortcut: a key the Host has and the pty had not is not carried; upgrade if a shell ever needs one removed
      const env: Record<string, string> = {}
      for (const [k, v] of Object.entries(p.opts.env)) if (v !== undefined && a.baseEnv[k] !== v) env[k] = v
      return [{ meta: p.meta, file: p.file, args: p.args, cwd: p.opts.cwd, cols: p.opts.cols, rows: p.opts.rows, env }]
    })
  }
}

/** Synchronous, like `writeCleanExit`, and owner-only: the env a run was given is in it. Throws, so the way out writes
 *  no `clean-exit` behind a handover that is not on disk and the sessions come back as after a crash. */
export function writeHandover(profileDir: string, h: Handover): void {
  const file = handoverFileIn(profileDir)
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(h), { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, file)
}

/** The work a handover must not cut short: a worker, a check, a review or a merge in flight, and a plan's replan while
 *  its planner starts or lives (`alive`; absent: every one counts). Its planner session is not brought back: a swap that
 *  began right after a review left the plan holding a dead replan. One whose planner is already dead holds nothing.
 *  A `dispatched` Task works only while a Dispatch of it is open: a paused plan's (its Dispatch closed by the pause) has
 *  no worker to cut short, and counting it held every automatic Host swap back for as long as the plan stayed paused. */
export function workingTaskCount(s: OrchState | null, alive?: (sessionId: string) => boolean): number {
  if (!s) return 0
  const open = new Set(s.dispatches.filter((d) => !d.endedAt).map((d) => d.taskId))
  const tasks = s.tasks.filter((t) => (t.status === 'dispatched' ? open.has(t.id) : ['validating', 'reviewing', 'merging'].includes(t.status))).length
  const replans = s.jobs.filter((j) => {
    const r = j.replanning
    return r !== undefined && j.archivedAt === undefined && (r.sessionId === undefined || (alive?.(r.sessionId) ?? true))
  }).length
  return tasks + replans
}

export interface SessionTracker {
  /** No change from here on: the way out's `killAll` must not empty the list a reboot restores. */
  freeze(): void
  /** The writes queued so far, settled. */
  flushed(): Promise<void>
  /** Stops the poll. */
  dispose(): void
  /** A pending saved session's respawn is over, for good: its row leaves the file (its live row, if any, stays). */
  settle(sessionId: string): void
}

/** Keeps `file` equal to the registry's live agent sessions, starting from the ones live now, plus the `pending` saved
 *  sessions a restore has not settled yet: a crash before their respawns register must not lose them. */
export function trackLiveSessions(d: {
  registry: Pick<PtyRegistry, 'list' | 'onMeta' | 'onExit' | 'metaOf' | 'sessionPty'>
  file: string
  /** The saved sessions still to restore (from the last Host's file). */
  pending?: SavedSession[]
  /** The conversation id the session's hook events last named, or null. */
  nativeIdOf(sessionId: string): Promise<string | null>
  log(m: string): void
  pollMs?: number
}): SessionTracker {
  const live = new Map<string, SavedSession>()
  const waiting = new Map((d.pending ?? []).map((r) => [r.sessionId, r]))
  let frozen = false
  let queue: Promise<void> = Promise.resolve()
  const save = (): void => {
    if (frozen) return
    const snapshot = JSON.stringify([...[...waiting.values()].filter((r) => !live.has(r.sessionId)), ...live.values()])
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
    dispose: () => clearInterval(timer),
    settle: (sessionId) => {
      if (waiting.delete(sessionId)) save()
    }
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
  /** The Host spawner's `createSession`. `sessionId`: a handover's, the id the session had. */
  createSession(o: {
    accountId: string
    cwd: string
    title?: string
    rollAccountIds: string[]
    /** Absent: the conversation has no transcript to resume (`hasConversation`), so it starts fresh. */
    resumeSessionId?: string
    autoAccounts: boolean
    sessionId?: string
    startedAt?: number
  }): Promise<{ id: string }>
  /** Whether the agent CLI can resume this conversation (`conversationOnDisk`); absent: assumed it can. */
  hasConversation?(accountId: string, nativeId: string): Promise<boolean>
  /** A command under the Host's own caller. */
  handle(cmd: string, args: Record<string, unknown>): Promise<{ status: number; body: unknown }>
  /** The tracker's `settle`: called once per saved session, when its respawn succeeded or failed for good. */
  settle(sessionId: string): void
  log(m: string): void
  /** A handover's sessions: each tab comes back under its own id, and so does a worker no open Dispatch waits on. */
  handover?: true
}

/** Brings back the sessions an unclean exit (or a handover) left: tabs and pending plans' planners. Never rejects. */
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
      // A worker whose Dispatch is still open is the recovery's, as after a crash; one done with it is a tab.
      const idle = (): boolean => !d.state?.dispatches.some((x) => x.sessionId === row.sessionId && !x.endedAt && !x.outcome)
      if (role !== 'user' && !(d.handover && role === 'worker' && idle())) continue
      if (!native) {
        d.log(`session restore: ${row.sessionId} in ${row.cwd} has no conversation id to resume; left closed`)
        continue
      }
      // A console never typed into has a conversation id but no transcript: `claude --resume` of it says "No conversation
      // found" and exits, so the tab died with the swap. It starts fresh in its folder instead.
      const resumable = (await d.hasConversation?.(row.accountId, native).catch(() => true)) ?? true
      if (!resumable) d.log(`session restore: ${row.sessionId}'s conversation ${native} was never written; starting it fresh in ${row.cwd}`)
      const info = await d.createSession({
        accountId: row.accountId,
        cwd: row.cwd,
        ...(row.title !== undefined ? { title: row.title } : {}),
        rollAccountIds: row.rollAccountIds ?? [],
        ...(resumable ? { resumeSessionId: native } : {}),
        autoAccounts: true,
        ...(d.handover ? { sessionId: row.sessionId } : {}),
        ...(row.startedAt !== undefined ? { startedAt: row.startedAt } : {})
      })
      d.log(`session restore: ${row.sessionId} resumed as ${info.id} (conversation ${native}) in ${row.cwd}`)
      tabs++
    } catch (err) {
      d.log(`session restore: ${row.sessionId} could not be resumed: ${String(err)}`)
    } finally {
      d.settle(row.sessionId)
    }
  }
  return { tabs, planners }
}

/** Brings back what a handover left: its sessions (`restoreSessions`, under their own ids), its shell terminals and
 *  run processes, each reopened under its own note through `openPty`, and its chats, each respawned on its thread under
 *  its own id through `respawnChat`; then removes the file. Never rejects. */
export async function restoreHandover(
  d: Omit<RestoreDeps, 'saved' | 'handover'> & {
    file: string
    handover: Handover
    /** The Host's own worker env, which each pty's own differences go over. */
    baseEnv: NodeJS.ProcessEnv
    /** Opens one pty in the registry and tells the apps (`pty-opened`), so the one that had it takes it back. */
    openPty(o: PtySpawn & { meta: PtyMeta }): void
    /** Respawns one chat under its id on its thread and tells the apps once its start settled. Rejects on a failure. */
    respawnChat(c: HandoverChat): Promise<void>
  }
): Promise<{ tabs: number; planners: number; ptys: number; chats: number }> {
  const r = await restoreSessions({ ...d, saved: d.handover.sessions, handover: true })
  let ptys = 0
  for (const p of d.handover.ptys) {
    try {
      d.openPty({ file: p.file, args: p.args, opts: { cwd: p.cwd, cols: p.cols, rows: p.rows, env: { ...d.baseEnv, ...p.env } }, meta: p.meta })
      ptys++
    } catch (err) {
      d.log(`session restore: the ${p.meta.kind} ${p.meta.id} in ${p.cwd} could not be reopened: ${String(err)}`)
    }
  }
  let chats = 0
  for (const c of d.handover.chats ?? []) {
    try {
      await d.respawnChat(c)
      chats++
    } catch (err) {
      d.log(`session restore: the chat ${c.sessionId} in ${c.cwd} could not be respawned: ${String(err)}`)
    }
  }
  await fs.rm(d.file, { force: true }).catch((err) => d.log(`session restore: ${d.file} could not be removed: ${String(err)}`))
  return { ...r, ptys, chats }
}

/** Whether `nativeId` can be resumed: a codex one always (found by its rollout, not here); a claude one when its
 *  transcript is under some claude account's folder (a resume carries it across accounts, `carryTranscript`). */
export async function conversationOnDisk(
  accounts: Account[],
  accountId: string,
  nativeId: string,
  find: (configDir: string, id: string) => Promise<string | null> = findClaudeTranscript
): Promise<boolean> {
  const own = accounts.find((a) => a.id === accountId)
  if (own && providerOf(own) !== 'claude') return true
  for (const a of accounts) if (providerOf(a) === 'claude' && (await find(a.configDir, nativeId).catch(() => null))) return true
  return false
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
