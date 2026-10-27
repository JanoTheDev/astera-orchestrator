// Which Host an orchestration IPC call goes to (remote runtime design §2.7, C2 D1.1, D1.6, D1.7). A call with no
// `runtimeId`, or `'local'`, runs today's handler body exactly as it was: its guards, its project registration and its
// local fallbacks all live there. Any other id goes to that Runtime's client and nowhere else, so for a remote Runtime
// no local guard, fallback or write can run, and a Runtime that fails answers on its own without touching the local
// Host.
import type { CompletionDetail, OrchSnapshot, RunDetail } from '../../core/types'
import type { RemoteRuntimeClient, RuntimeView } from './runtimeClient'

type Reply = { status: number; body: unknown }

export interface OrchHandlers {
  list(projectPath: string, runtimeId?: string): Promise<OrchSnapshot>
  runDetail(projectPath: string, runId: string, opts?: { journalPages?: unknown }, runtimeId?: string): Promise<RunDetail>
  completion(projectPath: string, runId: string, taskId: string, runtimeId?: string): Promise<CompletionDetail | null>
  command(projectPath: string, cmd: string, args: Record<string, unknown>, runtimeId?: string): Promise<{ status: number; body: unknown }>
}

export const LOCAL_RUNTIME = 'local'
export const isLocalRuntime = (runtimeId?: unknown): boolean => runtimeId === undefined || runtimeId === null || runtimeId === LOCAL_RUNTIME
/** A runtimeId from the renderer that is not a string names no Runtime (review M-1): it is never looked up. */
const NOT_A_RUNTIME = { code: 'RUNTIME_NOT_FOUND', message: 'a runtime id is a string' }

/** W4: commands only the local Host can answer, because it owns the sessions (`listSessions`, `sendSession`, `chatSend`).
 *  Main's copy of the command layer has no such deps and refused them ("sessions are answered by the Astera Host"),
 *  so the command bar's `send` never reached a worker. These go to the Host as the app (`host`). */
export const HOST_ANSWERED: ReadonlySet<string> = new Set([
  'sessions-send',
  // W5-D (#42): the inbox's waits, with their reason, read off the hook events by the Host (host/sessions.ts)
  'sessions-list',
  // W6-A intake: the New plan dialog's commands need the Host's gh and profile (attached files), which main's copy of the
  // command layer does not have
  'jobs-create',
  'jobs-create-from-issue',
  'github-issue-assign',
  'sources-items',
  // W7-B: the project dialogs' git and gh work is the Host's (src/host/orch.ts)
  'projects-add',
  'projects-create',
  'projects-github-create',
  // W8-F (#93): the planner's session is the Host's. Main has no listSessions / sendSession / agentSessionOf, so the box
  // always fell through to a fresh planner
  'jobs-feedback',
  // T2: its planner is the Host's too
  'jobs-chat',
  // T2: a plan's own chat is the Host's chat session, as the console is
  'jobs-chat-ensure',
  // W9-H: the app tells the Host which console the owner views full size, so agents' sends into it wait (orch.ts)
  'owner-hold',
  // W9-H: the Agents page reads each project's JobRow snapshot; main's copy of the command layer has no such command
  'jobs-view',
  // T10: the Astera console is the Host's chat session; main's copy of the command layer has no createSession
  'console-ensure',
  // W9-I: the tab summaries (a finished session's outcome, the sidebar's failed dot) are read by the Host only; main's
  // copy answered 409 and the sidebar never showed a session that gave up
  'summaries',
  'sessions-summary',
  // T1: these need `deps.github` (the Host's gh runner); main's copy of the command layer has no gh and refused them
  // ("GitHub commands are answered by the Astera Host"), so Merge PR, PR sync and Open PR never ran
  'run-pr-merge',
  'runs-pr-sync',
  'run-open-pr',
  'run-draft-pr',
  'attribution-remap',
  'task-link-issue',
  'github-pr',
  'github-ci',
  'github-ci-rerun',
  'github-issue',
  'github-pr-create',
  // T1: reads the folder's delivery setup through `deps.github.deliverySetup`; without it main's copy delivers by the
  // saved mode and misses the fall back when the folder cannot push or open a PR
  'run-deliver'
])

/** W5-D (#44): the reads that are one list across every Host. A call with no `runtimeId` asks the local Host and every
 *  paired Runtime and merges the answers (`everywhere`); `'local'` or a Runtime's id still asks only that one. */
/** T12b: commands the app sends to a Runtime only when this computer is paired with it at full control (the
 *  Runtime's gate refuses them anyway); refused here first, so the owner reads why without a round trip. */
export const FULL_CONTROL_ONLY: ReadonlySet<string> = new Set(['projects-add'])

export const MERGED_READS: ReadonlySet<string> = new Set(['activity-poll', 'activity-summary', 'dispatches-list'])
/** How long a merged read waits on one Runtime: an unreachable one reconnects for longer (APP_RECONNECT_FOR_MS), and
 *  the feed and the sidebar must not wait on it. It is left out of that read, and asked again on the next. */
export const MERGED_READ_TIMEOUT_MS = 3000
const SUMMARY_LISTS = ['completed', 'failed', 'cancelled', 'awaitingReview', 'plansDone', 'blocked'] as const

/** An `activity-poll` cursor across Hosts: each Host's own cursor by runtime id, as JSON. A cursor that is not one is
 *  the local Host's, as it was before any Runtime was paired. */
export function splitCursor(after: unknown): Record<string, string> {
  if (typeof after !== 'string' || after === '') return {}
  if (!after.startsWith('{')) return { [LOCAL_RUNTIME]: after }
  try {
    const o = JSON.parse(after) as Record<string, unknown>
    return Object.fromEntries(Object.entries(o).filter((e): e is [string, string] => typeof e[1] === 'string'))
  } catch {
    return {}
  }
}

const tag = (xs: unknown, runtimeId: string): unknown[] =>
  Array.isArray(xs) ? xs.map((x) => (runtimeId === LOCAL_RUNTIME || typeof x !== 'object' || x === null ? x : { ...x, runtimeId })) : []

/** One merged answer from each Host's 200 answer, in the order given (local first). Remote items carry their
 *  `runtimeId`; the local Host's carry none, as they always have. */
export function mergeReads(cmd: string, answers: ReadonlyArray<{ runtimeId: string; body: unknown; cursor?: string }>): unknown {
  if (cmd === 'dispatches-list') return answers.flatMap((x) => tag(x.body, x.runtimeId))
  if (cmd === 'activity-summary') {
    const first = (answers[0]?.body ?? {}) as Record<string, unknown>
    return {
      ...first,
      ...Object.fromEntries(SUMMARY_LISTS.map((k) => [k, answers.flatMap((x) => tag((x.body as Record<string, unknown>)?.[k], x.runtimeId))]))
    }
  }
  // activity-poll: every Host's lines in time order, its own cursor kept for the next read, a gap if any had one
  const pages = answers.map((x) => ({ runtimeId: x.runtimeId, page: (x.body ?? {}) as { events?: unknown; cursor?: unknown; gap?: unknown }, cursor: x.cursor }))
  const events = pages
    .flatMap((x) => tag(x.page.events, x.runtimeId) as Array<{ occurredAt?: string }>)
    .sort((a, b) => String(a.occurredAt ?? '').localeCompare(String(b.occurredAt ?? '')))
  const cursors = Object.fromEntries(
    pages.flatMap((x) => {
      const c = typeof x.page.cursor === 'string' ? x.page.cursor : x.cursor
      return c === undefined ? [] : [[x.runtimeId, c]]
    })
  )
  return { events, cursor: JSON.stringify(cursors), gap: pages.some((x) => x.page.gap === true) }
}

const EMPTY_DETAIL: RunDetail = { events: [], layers: [], deps: {}, cyclic: [] }
const offlineView = (runtimeId: unknown): RuntimeView => ({ runtimeId: typeof runtimeId === 'string' ? runtimeId : '', offline: true, stale: false, version: 0 })

export function createOrchRouter(a: {
  local: OrchHandlers
  /** The local Host's command layer, as the app: where HOST_ANSWERED commands go. */
  host?(projectPath: string, cmd: string, args: Record<string, unknown>): Promise<{ status: number; body: unknown }>
  remote: {
    client(runtimeId: string): Promise<RemoteRuntimeClient | { code: string; message: string }>
    /** W5-D (#44): the paired Runtimes, for the MERGED_READS. Absent: none. */
    list?(): Promise<ReadonlyArray<{ runtimeId: string; permission?: string }>>
  }
  log?(m: string): void
  /** Test injection; default MERGED_READ_TIMEOUT_MS. */
  mergedTimeoutMs?: number
}): OrchHandlers & {
  /** W5-D (#44): `cmd` (one of MERGED_READS) on the local Host (`local`) and on every paired Runtime, merged
   *  (`mergeReads`). With no Runtime paired, the local answer as it is. A local answer that is not a 200 is the answer;
   *  a Runtime that fails is logged and left out, and its `activity-poll` cursor is kept for the next read. */
  everywhere(cmd: string, args: Record<string, unknown>, local: (args: Record<string, unknown>) => Promise<Reply>): Promise<Reply>
} {
  const log = (m: string): void => {
    try {
      a.log?.(m)
    } catch {
      /* nowhere to say it */
    }
  }
  /** The client, or null with the reason logged: a Runtime nobody paired, or one whose client failed. */
  const clientOf = async (runtimeId: string): Promise<RemoteRuntimeClient | { code: string; message: string }> => {
    if (typeof runtimeId !== 'string') return NOT_A_RUNTIME
    try {
      return await a.remote.client(runtimeId)
    } catch (e) {
      return { code: 'RUNTIME_OFFLINE', message: e instanceof Error ? e.message : String(e) }
    }
  }
  const guarded = async <T>(runtimeId: string, what: string, fallback: T, fn: (c: RemoteRuntimeClient) => Promise<T>, onMissing: (m: { code: string; message: string }) => T): Promise<T> => {
    const c = await clientOf(runtimeId)
    if ('code' in c) return onMissing(c)
    try {
      return await fn(c)
    } catch (e) {
      log(`remote ${what} on ${runtimeId} failed: ${e instanceof Error ? e.message : String(e)}`)
      return fallback
    }
  }
  const everywhere = async (cmd: string, args: Record<string, unknown>, local: (args: Record<string, unknown>) => Promise<Reply>): Promise<Reply> => {
    let runtimes: string[] = []
    try {
      runtimes = ((await a.remote.list?.()) ?? []).map((r) => r.runtimeId)
    } catch (e) {
      log(`the paired Runtimes could not be listed: ${e instanceof Error ? e.message : String(e)}`)
    }
    const cursors = cmd === 'activity-poll' ? splitCursor(args.after) : {}
    const argsFor = (runtimeId: string): Record<string, unknown> => {
      if (cmd !== 'activity-poll') return args
      const { after: _after, ...rest } = args
      return cursors[runtimeId] !== undefined ? { ...rest, after: cursors[runtimeId] } : rest
    }
    // The local Host's own cursor, also from a merged one made while a Runtime was still paired
    if (runtimes.length === 0) return local(argsFor(LOCAL_RUNTIME))
    const failed: Reply = { status: 503, body: null }
    const [mine, ...theirs] = await Promise.all([
      local(argsFor(LOCAL_RUNTIME)),
      ...runtimes.map((id) =>
        guarded<Reply>(
          id,
          cmd,
          failed,
          (c) =>
            new Promise<Reply>((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error('no answer in time')), a.mergedTimeoutMs ?? MERGED_READ_TIMEOUT_MS)
              c.command(cmd, argsFor(id)).then(resolve, reject).finally(() => clearTimeout(timer))
            }),
          () => failed
        )
      )
    ])
    if (mine.status !== 200) return mine
    const answers = [{ runtimeId: LOCAL_RUNTIME, body: mine.body }]
    theirs.forEach((r, i) => {
      if (r.status === 200) answers.push({ runtimeId: runtimes[i], body: r.body })
      else {
        if (r !== failed) log(`remote ${cmd} on ${runtimes[i]} answered ${r.status}`)
        // Left out this time; its cursor goes on unchanged
        if (cursors[runtimes[i]] !== undefined) answers.push({ runtimeId: runtimes[i], body: { events: [], cursor: cursors[runtimes[i]] } })
      }
    })
    return { status: 200, body: mergeReads(cmd, answers) }
  }
  const remoteCommand = (runtimeId: string, cmd: string, args: Record<string, unknown>): Promise<Reply> =>
    guarded(
      runtimeId,
      'command',
      { status: 503, body: { error: `the Runtime ${runtimeId} could not be asked`, code: 'RUNTIME_OFFLINE' } },
      (c) => c.command(cmd, args ?? {}),
      (m) => ({ status: m.code === 'RUNTIME_NOT_FOUND' ? 404 : 503, body: { error: m.message, code: m.code } })
    )
  /** FULL_CONTROL_ONLY: sent only when this computer's pairing with the Runtime is full control. */
  const fullControlFirst = async (runtimeId: string, cmd: string, send: () => Promise<Reply>): Promise<Reply> => {
    let permission: string | undefined
    try {
      permission = ((await a.remote.list?.()) ?? []).find((r) => r.runtimeId === runtimeId)?.permission
    } catch (e) {
      log(`the paired Runtimes could not be listed: ${e instanceof Error ? e.message : String(e)}`)
    }
    if (permission === 'full-control') return send()
    return {
      status: 403,
      body: { error: `${cmd} needs a full-control pairing; this computer is paired with ${runtimeId} ${permission ?? 'with no known permission'}`, code: 'RUNTIME_PERMISSION_DENIED' }
    }
  }
  return {
    everywhere,
    list: (projectPath, runtimeId) =>
      isLocalRuntime(runtimeId)
        ? a.local.list(projectPath)
        : guarded<OrchSnapshot>(
            runtimeId!,
            'list',
            { runs: [], projectFolderBusy: false, runtime: offlineView(runtimeId) },
            (c) => c.list(projectPath),
            () => ({ runs: [], projectFolderBusy: false, runtime: offlineView(runtimeId) })
          ),
    runDetail: (projectPath, runId, opts, runtimeId) =>
      isLocalRuntime(runtimeId)
        ? opts === undefined
          ? a.local.runDetail(projectPath, runId)
          : a.local.runDetail(projectPath, runId, opts)
        : guarded(runtimeId!, 'runDetail', EMPTY_DETAIL, (c) => c.runDetail(runId, opts), () => EMPTY_DETAIL),
    completion: (projectPath, runId, taskId, runtimeId) =>
      isLocalRuntime(runtimeId)
        ? a.local.completion(projectPath, runId, taskId)
        : guarded<CompletionDetail | null>(runtimeId!, 'completion', null, (c) => c.completion(runId, taskId), () => null),
    command: (projectPath, cmd, args, runtimeId) => {
      const local = (x: Record<string, unknown>): Promise<Reply> =>
        HOST_ANSWERED.has(cmd) && a.host ? a.host(projectPath, cmd, x) : a.local.command(projectPath, cmd, x)
      if (runtimeId === undefined && MERGED_READS.has(cmd)) return everywhere(cmd, args ?? {}, local)
      if (isLocalRuntime(runtimeId)) return local(args)
      if (FULL_CONTROL_ONLY.has(cmd)) return fullControlFirst(runtimeId!, cmd, () => remoteCommand(runtimeId!, cmd, args))
      return remoteCommand(runtimeId!, cmd, args)
    }
  }
}

