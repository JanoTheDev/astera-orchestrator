// Stall watchdog (owner 2026-10-18: "i want this all built in later i dont want to have a claude tab on the side to do
// stuff"; 2026-10-19: "sometimes some tasks stay waiting and they forget about it"). Every plan that stalls in a known
// way is moved on by the Host itself, without an agent of its own: a ready Task nobody starts, a coordinator busy with
// nothing to show or gone with work waiting, a worker lost or idle at its prompt without a report, a completed Task left
// out of the plan branch, a wave whose draft PR never opened. Checked every `STALL_WATCH_MS`.
//
// **Two appliers, one detection.** The dispatch loop's tick (dispatchLoop.ts watchStalls) applies the remedies it
// knows (tell-start, place, tell-busy, refresh, merge, draft-pr) and ignores the rest; `createStallWatch` below, wired
// by the Host beside it, applies the rest (`APPLIED_HERE`). Both run `stallRemedies` on the same state with their own
// memo, so each remedy is applied by exactly one of them.
// shortcut: two memos of one pure detection; once dispatchLoop.ts may change, move its applier here and run one watcher.
//
// **Detection is pure** (`stallRemedies`): Host state, the time and the memo of what was already done, plus the few
// facts only the process has (busy, a registered worktree, a usage pause, the app-wide cap) as probes. The memo keys a
// stall by what makes it one (a Task's readiness moment and what holds it, a busy spell, a lost Dispatch, a wave), and
// a stall that clears drops its entry, so the next one starts over. A stall that stays is tried again after a growing
// wait (`BACKOFF_MS`), and after `TRIES` tries it is raised once to the owner as an escalation (an Inbox item), never
// left in silence. Nothing destructive: it tells, starts, retries, nudges, merges into the plan branch, refreshes or
// restarts a coordinator and retries a draft PR. It never cancels, rewrites or merges into main.
import type { ActivityDraft } from '../activity'
import { readyWithoutWorker, type CoordinatorNotice } from '../inbox'
import { jobNameOf } from '../jobName'
import { wavesToMerge } from '../integrate'
import { draftPrDue } from '../draftPr'
import { isJobActive } from '../lifecycle'
import { lostWithCoordinator, lostWithNobody } from '../lostGate'
import { isLost } from '../../recovery/candidates'
import { editingByProject, projectKeyOf, sameFilesAs, workerCapOf, workersAgainstCap } from '../schedule'
import { coordinatorStarting, jobOf, type OrchState } from '../state'
import { DEFAULT_CONCURRENCY, FAILURE_LIMIT, type Dispatch, type Job, type JobRun, type Task } from '../types'
import { outcomeOf } from '../view'
import { ENTER_DELAY_MS } from '../../sessions/sessionDriver'
import { workerStartInFlight } from './coordinatorRotate'

/** How often the watchdog looks. */
export const STALL_WATCH_MS = 30_000
/** A ready Task with a free slot and no worker: the coordinator is told after this, and Astera starts it this long after that. */
export const READY_STALL_MS = 2 * 60_000
/** A coordinator busy this long with no worker started, no Gate and no message is told what is ready. */
export const BUSY_TELL_MS = 5 * 60_000
/** ... and replaced by a fresh coordinator after this long. */
export const BUSY_REFRESH_MS = 10 * 60_000
/** A completed Task not in the plan branch this long after it completed: its merge is retried. */
export const MERGE_STALL_MS = 2 * 60_000
/** A draft PR due this long and not opened or updated: it is asked again. */
export const DRAFT_STALL_MS = 2 * 60_000
/** A Run whose coordinator account has no coordinator session, with work waiting this long: its coordinator is restarted. */
export const DEAD_COORDINATOR_MS = 2 * 60_000
/** A Task left `dispatched` this long after its worker's session ended unreported: it is started again (`--retry-of`). */
export const LOST_STALL_MS = 2 * 60_000
/** A worker idle at its prompt this long with its Dispatch open (no `worker-done`): it is nudged. */
export const IDLE_STALL_MS = 10 * 60_000
/** The waits between the tries of a stall that stays (after its first); the last repeats. */
export const BACKOFF_MS = [2 * 60_000, 5 * 60_000, 10 * 60_000, 20 * 60_000]
/** Tries of one stall before it is raised to the owner: the placements of a ready Task, the restarts of a coordinator,
 *  the retries of a lost Task. */
export const TRIES = 4

/** The wait before try `step` (1-based count of tries made). */
const backoffOf = (step: number): number => BACKOFF_MS[Math.min(Math.max(step, 1) - 1, BACKOFF_MS.length - 1)]

/** One stall the watchdog has seen: since when, how many of its remedies were applied, and when the last one was. */
export interface StallEntry {
  since: number
  step: number
  at: number
}
/** By stall key. In memory: a restart starts every stall over, which at worst repeats one remedy. */
export type StallMemo = ReadonlyMap<string, StallEntry>

/** What only the process can tell. */
export interface StallProbe {
  /** true busy, false idle, null cannot tell (DispatchLoopContext.sessionBusy) */
  busy(sessionId: string): boolean | null
  isRegistered(p: string): boolean
  /** The usage guard holds new workers on this account: its ready Tasks wait for it, not for the coordinator. */
  paused?(accountId: string): boolean
  /** The app-wide cap setting (`maxConcurrentWorkers`), null for the default. Absent: the default (`workerCapOf`). */
  cap?: number | null
  /** Whether a session is alive: a Run driven by a live external coordinator gets no restart. Absent: it is. */
  alive?(sessionId: string): boolean
}

export type StallRemedy = { key: string; runId: string } & (
  | { kind: 'tell-start'; task: Task; since: number }
  | { kind: 'place'; task: Task; since: number }
  | { kind: 'tell-busy'; sessionId: string; since: number }
  | { kind: 'refresh'; sessionId: string; since: number }
  | { kind: 'merge'; task: Task; runRoot: string; worktree: string }
  | { kind: 'draft-pr'; done: number }
  | { kind: 'restart'; since: number; try: number }
  | { kind: 'retry-lost'; task: Task; dispatch: Dispatch; try: number }
  | { kind: 'nudge-worker'; task: Task; dispatch: Dispatch; since: number }
  | { kind: 'tell-idle'; task: Task; dispatch: Dispatch; since: number }
  | { kind: 'escalate'; taskId: string; dispatchId?: string; subject: string; body: string }
)

/** The remedies `createStallWatch` applies; the dispatch loop applies the others (header). */
export const APPLIED_HERE: ReadonlySet<StallRemedy['kind']> = new Set(['restart', 'retry-lost', 'nudge-worker', 'tell-idle', 'escalate'])

/** What a worker idle at its prompt without a report is typed. English: workers read English (spec files). */
export const IDLE_NUDGE =
  'You stopped without reporting. Finish the Task, or report with `astera send --type worker_done` (see your spec), ' +
  'or ask a question with `astera ask` if you are stuck.'

/** Something the plan did since `since`: a worker started, a Gate opened, a question or escalation came in, or the
 *  coordinator acked its mail (`check --ack`). The Host's own `status` notices are not the coordinator's doing.
 *  shortcut: a Message records no sender, so a worker's question counts as the plan moving too; upgrade if that ever
 *  hides a stuck coordinator. */
function movedSince(s: OrchState, runId: string, since: number): boolean {
  const after = (iso: string | undefined): boolean => iso !== undefined && Date.parse(iso) >= since
  const mine = new Set(s.tasks.filter((t) => t.runId === runId).map((t) => t.id))
  return (
    s.dispatches.some((d) => mine.has(d.taskId) && after(d.startedAt)) ||
    s.gates.some((g) => g.runId === runId && after(g.createdAt)) ||
    s.messages.some((m) => m.runId === runId && (m.type === 'question' || m.type === 'escalation') && after(m.createdAt)) ||
    s.deliveries.some((d) => d.runId === runId && after(d.ackedAt))
  )
}

/** The remedies due now, and the memo to keep. A healthy plan gets none. */
export function stallRemedies(
  s: OrchState,
  nowMs: number,
  memo: StallMemo,
  probe: StallProbe
): { due: StallRemedy[]; memo: Map<string, StallEntry> } {
  const next = new Map<string, StallEntry>()
  const due: StallRemedy[] = []
  /** A stall seen now keeps its entry, or starts one at `since`. */
  const seen = (key: string, since: number): StallEntry => {
    const e = memo.get(key) ?? { since, step: 0, at: 0 }
    next.set(key, e)
    return e
  }
  const stepped = (key: string, e: StallEntry): void => {
    next.set(key, { ...e, step: e.step + 1, at: nowMs })
  }
  const at = new Map(s.tasks.map((t) => [t.id, Date.parse(t.updatedAt)]))

  /** Whether the next try of a stall is due: its first at `first`, each later one `backoffOf` after the last. */
  const due_ = (e: StallEntry, first: number): boolean => (e.step === 0 ? nowMs >= first : nowMs - e.at >= backoffOf(e.step))
  // An escalation is told once: its subject in the Run's inbox is the mark, so a restart does not raise it again
  const raised = new Set(s.messages.filter((m) => m.type === 'escalation').map((m) => `${m.runId}\u0000${m.subject}`))
  /** The owner is told, once, that a stall outlasted its tries. */
  const escalate = (key: string, e: StallEntry, runId: string, x: { taskId: string; dispatchId?: string; subject: string; body: string }): void => {
    stepped(key, e)
    if (raised.has(`${runId}\u0000${x.subject}`)) return
    due.push({ key, runId, kind: 'escalate', ...x })
  }

  /** Not paused, held, replanning, stopping, finished or waiting for its start: a Run that takes new work. */
  const placing = (run: JobRun, job: Job | undefined): job is Job =>
    job !== undefined && isJobActive(job) && !job.paused && !job.dispatchHold && !job.pendingStart && !job.replanning &&
    !run.paused && !run.coordinatorStop && run.coordinatorStopPending === undefined && !coordinatorStarting(run, nowMs) &&
    outcomeOf(s, run.id) === 'running'

  // The app-wide cap and the files being edited, spent by each Task counted as startable below
  let capFree = workerCapOf(probe.cap ?? null) - workersAgainstCap(s)
  const editing = editingByProject(s)

  for (const run of s.runs) {
    const sessionId = run.coordinatorSessionId
    const job = jobOf(s, run)
    if (!placing(run, job)) continue

    // A coordinator account and no coordinator session (it died, or its tab was closed), with work waiting: restarted
    // the way the Jobs list's restart button does (`run-start`). A live external coordinator drives it instead.
    if (sessionId === undefined) {
      const external = run.externalCoordinatorSessionId
      if (!job.coordinatorAccountId || (external !== undefined && (probe.alive?.(external) ?? true))) continue
      const ready = readyWithoutWorker(s, run.id)
      const lost = lostWithNobody(s).filter((x) => x.runId === run.id)
      if (ready.length === 0 && lost.length === 0) continue
      const key = `restart:${run.id}`
      const e = seen(key, nowMs)
      if (!due_(e, e.since + DEAD_COORDINATOR_MS)) continue
      if (e.step < TRIES) {
        due.push({ key, runId: run.id, kind: 'restart', since: e.since, try: e.step + 1 })
        stepped(key, e)
      } else if (e.step === TRIES)
        escalate(key, e, run.id, {
          taskId: ready[0]?.id ?? lost[0].taskId,
          subject: `watchdog: run ${run.id} has no coordinator since ${new Date(e.since).toISOString()}`,
          body:
            `${jobNameOf(job)} lost its coordinator and Astera could not start a new one after ${TRIES} tries, so its ready ` +
            'work waits. Restart it from the Jobs list, or look at why it does not start (its account, its login).'
        })
      continue
    }

    if (workerStartInFlight(s, run.id, nowMs)) continue
    const mine = new Set(s.tasks.filter((t) => t.runId === run.id).map((t) => t.id))
    const open = s.dispatches.filter((d) => mine.has(d.taskId) && !d.outcome && !d.endedAt).length
    let free = (job.concurrency ?? DEFAULT_CONCURRENCY) - open
    const project = projectKeyOf(s, job)
    // Wave-held Tasks are not ready to start (readyWithoutWorker), so they are no stall and spend no slot
    const candidates = readyWithoutWorker(s, run.id).filter(
      (t) => (t.accountIds?.length ?? 0) > 0 && t.consecutiveFailures < FAILURE_LIMIT && probe.paused?.(t.accountIds![0]) !== true
    )
    let startable = 0

    // Ready, startable now, no worker: tell the exact start, then start it, again after a growing wait, then the owner.
    // What holds a Task back is in its key, so a blocker that clears starts the stall over.
    for (const t of candidates) {
      const since = Math.max(at.get(t.id) ?? 0, ...t.deps.map((d) => at.get(d) ?? 0))
      const clash = sameFilesAs(t, editing.get(project) ?? [])
      const held = clash ? `same-files:${clash.task.id}` : free <= 0 ? 'plan-cap' : capFree <= 0 ? 'app-cap' : null
      const base = `ready:${t.id}:${since}:`
      if (held !== null) {
        seen(base + held, nowMs)
        continue
      }
      free--
      capFree--
      startable++
      editing.set(project, [...(editing.get(project) ?? []), t])
      const key = `${base}free`
      // Held until now: the stall counts from the moment it could start
      const wasHeld = !memo.has(key) && [...memo.keys()].some((k) => k.startsWith(base))
      const e = seen(key, wasHeld ? nowMs : since)
      if (e.step === 0) {
        if (nowMs - e.since < READY_STALL_MS) continue
        due.push({ key, runId: run.id, kind: 'tell-start', task: t, since: e.since })
        stepped(key, e)
      } else if (!due_(e, 0)) continue
      else if (e.step <= TRIES) {
        due.push({ key, runId: run.id, kind: 'place', task: t, since: e.since })
        stepped(key, e)
      } else if (e.step === TRIES + 1)
        escalate(key, e, run.id, {
          taskId: t.id,
          subject: `watchdog: task ${t.id} ready since ${new Date(e.since).toISOString()} has no worker`,
          body:
            `${t.id} (${t.title}) could start but has no worker: the coordinator was told and Astera tried to start it ` +
            `${TRIES} times. Start it yourself, or look at why it does not start (its account, the plan's activity feed).`
        })
    }

    // Busy with work waiting and nothing to show for it: tell it, then a fresh coordinator
    if (probe.busy(sessionId) === true && startable > 0) {
      const key = `busy:${sessionId}`
      let e = seen(key, nowMs)
      if (movedSince(s, run.id, e.since)) {
        e = { since: nowMs, step: 0, at: 0 }
        next.set(key, e)
      }
      if (e.step === 0 && nowMs - e.since >= BUSY_TELL_MS) {
        due.push({ key, runId: run.id, kind: 'tell-busy', sessionId, since: e.since })
        stepped(key, e)
      } else if (e.step === 1 && nowMs - e.since >= BUSY_REFRESH_MS) {
        due.push({ key, runId: run.id, kind: 'refresh', sessionId, since: e.since })
        stepped(key, e)
      }
    }
  }

  // Lost: `dispatched`, its last Dispatch ended unreported and its coordinator has not started it again. Retried
  // (`--retry-of`) up to the Task's retry limit, then the owner. A Run with no coordinator has the lost-worker Gate.
  for (const seed of lostWithCoordinator(s)) {
    const run = s.runs.find((r) => r.id === seed.runId)!
    const job = jobOf(s, run)
    const task = s.tasks.find((t) => t.id === seed.taskId)
    if (!placing(run, job) || !task) continue
    const endedAt = Date.parse(seed.dispatch.endedAt!)
    if (nowMs - endedAt < LOST_STALL_MS) continue
    const key = `lost:${seed.dispatch.id}`
    const e = seen(key, endedAt)
    if (!due_(e, 0)) continue
    const lostTimes = s.dispatches.filter((d) => d.taskId === task.id && isLost(d)).length
    const spent = lostTimes >= FAILURE_LIMIT || task.consecutiveFailures >= FAILURE_LIMIT
    if (!spent && e.step < TRIES) {
      due.push({ key, runId: run.id, kind: 'retry-lost', task, dispatch: seed.dispatch, try: e.step + 1 })
      stepped(key, e)
    } else if (spent ? e.step === 0 : e.step === TRIES)
      escalate(key, e, run.id, {
        taskId: task.id,
        dispatchId: seed.dispatch.id,
        subject: `watchdog: task ${task.id} lost its worker ${seed.dispatch.id}`,
        body:
          `${task.id} (${task.title})'s worker ended without a report ${spent ? `${lostTimes} times` : `and ${TRIES} retries did not start a new one`}, ` +
          'so it waits. Start it again, change its spec, or stop it.'
      })
  }

  // Idle: a worker at its prompt with its Dispatch open, so it never reported. Nudged, then its coordinator is told,
  // then the owner. Working again (or unreadable) drops the stall.
  for (const d of s.dispatches) {
    if (d.outcome || d.endedAt || probe.busy(d.sessionId) !== false) continue
    // A rolled Dispatch waits for its account (Dispatch.resumes): not idle, held
    const roll = d.resumes?.at(-1)
    if (roll && roll.resumedAt === undefined) continue
    const task = s.tasks.find((t) => t.id === d.taskId)
    const run = task?.runId === undefined ? undefined : s.runs.find((r) => r.id === task.runId)
    const job = run && jobOf(s, run)
    if (!task || !run || !job || !isJobActive(job) || job.paused || run.paused) continue
    const key = `idle:${d.id}`
    const e = seen(key, nowMs)
    if (!due_(e, e.since + IDLE_STALL_MS)) continue
    if (e.step === 0) due.push({ key, runId: run.id, kind: 'nudge-worker', task, dispatch: d, since: e.since })
    else if (e.step === 1) due.push({ key, runId: run.id, kind: 'tell-idle', task, dispatch: d, since: e.since })
    else if (e.step === 2) {
      escalate(key, e, run.id, {
        taskId: task.id,
        dispatchId: d.id,
        subject: `watchdog: worker ${d.id} idle since ${new Date(e.since).toISOString()}`,
        body:
          `${task.id} (${task.title})'s worker has been idle at its prompt since ${new Date(e.since).toISOString()} without ` +
          'reporting, after a nudge and a message to the coordinator. Look at its terminal: answer it, or stop it.'
      })
      continue
    } else continue
    stepped(key, e)
  }

  // Completed and not in the plan branch, finished plans too: their delivery needs it there
  const byId = new Map(s.tasks.map((t) => [t.id, t]))
  for (const w of wavesToMerge(s, (p) => probe.isRegistered(p))) {
    const t = byId.get(w.taskId)!
    if (nowMs - (at.get(t.id) ?? nowMs) < MERGE_STALL_MS) continue
    const key = `merge:${t.id}`
    const e = seen(key, at.get(t.id)!)
    if (e.step > 0) continue
    due.push({ key, runId: w.runId, kind: 'merge', task: t, runRoot: w.runRoot, worktree: w.worktree })
    stepped(key, e)
  }

  // A wave done, its draft PR not opened or updated (draftPr.ts draftPrDue stays due until the PR records it)
  for (const run of s.runs) {
    const done = draftPrDue(s, run)
    if (done === null) continue
    const key = `draft:${run.id}:${done}`
    const e = seen(key, nowMs)
    if (e.step > 0 || nowMs - e.since < DRAFT_STALL_MS) continue
    due.push({ key, runId: run.id, kind: 'draft-pr', done })
    stepped(key, e)
  }
  return { due, memo: next }
}

/** One watchdog action as its feed line ("Watchdog: …"): a line no commit makes, recorded by the Host. */
export function watchdogActivity(s: OrchState, runId: string, reason: string, taskId?: string): ActivityDraft {
  const run = s.runs.find((r) => r.id === runId)
  const job = run ? jobOf(s, run) : undefined
  return {
    type: 'watchdog',
    ...(job?.projectId !== undefined ? { projectId: job.projectId } : {}),
    ...(job !== undefined ? { jobId: job.id } : {}),
    runId,
    ...(taskId !== undefined ? { taskId } : {}),
    payload: { title: job ? jobNameOf(job) : runId, reason }
  }
}

/** The notice that tells a coordinator the exact start of a stalled ready Task. `agent` is the account's vendor. */
export function startNotice(runId: string, t: Task, since: number, agent: string): CoordinatorNotice {
  return {
    runId,
    taskId: t.id,
    subject: `watchdog: task ${t.id} ready since ${new Date(since).toISOString()}`,
    body:
      `${t.id} (${t.title}) has been ready for 2 minutes with a free slot and no worker. Start it now:\n\n` +
      `astera worker-start --task ${t.id} --agent ${agent} --account ${t.accountIds?.[0] ?? ''} --json\n\n` +
      'If it is still unstarted in 2 minutes, Astera starts it itself.'
  }
}

/** What `createStallWatch` needs from the Host: its command door, state and sessions, and the loop's `tell`. */
export interface StallWatchDeps {
  handle(cmd: string, args: Record<string, unknown>): Promise<{ status: number; body: unknown }>
  getState(): OrchState
  /** The "Watch for stalled plans" setting. */
  on(): boolean | Promise<boolean>
  /** The app-wide cap setting, null for the default. */
  cap(): number | null | Promise<number | null>
  busy(sessionId: string): boolean | null
  alive(sessionId: string): boolean
  isRegistered(p: string): boolean
  paused?(accountId: string): boolean
  typeInto(sessionId: string, text: string): void
  /** DispatchLoop.tell: a `status` message into a coordinator's Run inbox. */
  tell(n: CoordinatorNotice): Promise<boolean>
  activity?(d: ActivityDraft): void
  mayStart(): boolean
  log(m: string): void
  nowMs(): number
  /** Test seam; defaults to setTimeout. */
  wait?(ms: number): Promise<void>
}

/** The watchdog's own applier for `APPLIED_HERE` (header): at most once per `STALL_WATCH_MS`, the remedies due, each
 *  with its feed line ("Handled for you"). Never throws. */
export function createStallWatch(d: StallWatchDeps): { watch(): Promise<void> } {
  let memo: Map<string, StallEntry> = new Map()
  let lastAt = -Infinity
  let watching = false
  const wait = d.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const mins = (ms: number): number => Math.max(1, Math.round(ms / 60_000))
  const line = (runId: string, reason: string, taskId?: string): void => {
    d.log(`run=${runId}: watchdog: ${reason}`)
    try {
      d.activity?.(watchdogActivity(d.getState(), runId, `${reason[0].toUpperCase()}${reason.slice(1)}`, taskId))
    } catch (e) {
      d.log(`run=${runId}: watchdog: the feed line could not be recorded: ${String(e)}`)
    }
  }
  const why = (body: unknown): string => {
    const error = (body as { error?: unknown } | null)?.error
    return typeof error === 'string' ? error : JSON.stringify(body)
  }

  const apply = async (r: StallRemedy): Promise<void> => {
    switch (r.kind) {
      case 'restart': {
        // The Jobs list's restart button: `run-start` on the Run puts a coordinator back (jobActions.ts restartCoordinator)
        const reply = await d.handle('run-start', { run: r.runId })
        line(
          r.runId,
          reply.status < 400
            ? `restarted the coordinator: it was gone ${mins(d.nowMs() - r.since)} min with work waiting (try ${r.try} of ${TRIES})`
            : `the coordinator is gone with work waiting and could not be restarted (try ${r.try} of ${TRIES}): ${why(reply.body)}`
        )
        return
      }
      case 'retry-lost': {
        // As a coordinator retries one: the same account and agent, a new Dispatch linked to the lost one
        const reply = await d.handle('worker-start', {
          task: r.task.id,
          agent: r.dispatch.provider,
          account: r.dispatch.accountId,
          retryOf: r.dispatch.id
        })
        line(
          r.runId,
          reply.status < 400
            ? `started ${r.task.title} again: its worker ended without a report (try ${r.try} of ${TRIES})`
            : `could not start ${r.task.title} again after its worker ended without a report (try ${r.try} of ${TRIES}): ${why(reply.body)}`,
          r.task.id
        )
        return
      }
      case 'nudge-worker': {
        d.typeInto(r.dispatch.sessionId, IDLE_NUDGE)
        // Enter in the same burst as the text only adds a line (dispatchLoop.ts nudgePass)
        await wait(ENTER_DELAY_MS)
        d.typeInto(r.dispatch.sessionId, '\r')
        line(r.runId, `nudged the worker of ${r.task.title}: idle ${mins(d.nowMs() - r.since)} min without reporting`, r.task.id)
        return
      }
      case 'tell-idle': {
        const ok = await d.tell({
          runId: r.runId,
          taskId: r.task.id,
          subject: `watchdog: worker ${r.dispatch.id} idle since ${new Date(r.since).toISOString()}`,
          body:
            `${r.task.id} (${r.task.title})'s worker (session ${r.dispatch.sessionId}) has been idle at its prompt for ` +
            `${mins(d.nowMs() - r.since)} minutes without reporting, and a nudge did not move it. Look at it: answer it, ` +
            'tell it what to do, or stop it and start the Task again.'
        })
        line(
          r.runId,
          ok
            ? `told the coordinator the worker of ${r.task.title} is idle ${mins(d.nowMs() - r.since)} min without reporting`
            : `the worker of ${r.task.title} is idle ${mins(d.nowMs() - r.since)} min without reporting, and the coordinator could not be told`,
          r.task.id
        )
        return
      }
      case 'escalate': {
        const reply = await d.handle('send', {
          type: 'escalation',
          taskId: r.taskId,
          ...(r.dispatchId !== undefined ? { dispatchId: r.dispatchId } : {}),
          subject: r.subject,
          body: r.body
        })
        line(
          r.runId,
          reply.status < 400 ? `raised it to you: ${r.body}` : `could not raise "${r.subject}" to you: ${why(reply.body)}`,
          r.taskId || undefined
        )
        return
      }
      default:
        return // the dispatch loop's (header)
    }
  }

  return {
    async watch(): Promise<void> {
      if (watching || d.nowMs() - lastAt < STALL_WATCH_MS) return
      watching = true
      lastAt = d.nowMs()
      try {
        if (!(await d.on())) {
          memo = new Map()
          return
        }
        const cap = await d.cap()
        const planned = stallRemedies(d.getState(), d.nowMs(), memo, {
          busy: (id) => d.busy(id),
          isRegistered: (p) => d.isRegistered(p),
          ...(d.paused ? { paused: (id: string) => d.paused!(id) } : {}),
          cap,
          alive: (id) => d.alive(id)
        })
        memo = planned.memo
        for (const r of planned.due) {
          if (!APPLIED_HERE.has(r.kind)) continue
          if (!d.mayStart()) return
          try {
            await apply(r)
          } catch (e) {
            d.log(`run=${r.runId}: watchdog: ${r.kind} failed: ${String(e)}`)
          }
        }
      } catch (e) {
        d.log(`watchdog: the check failed: ${String(e)}`)
      } finally {
        watching = false
      }
    }
  }
}
