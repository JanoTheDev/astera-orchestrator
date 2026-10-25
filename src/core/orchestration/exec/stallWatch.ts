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
//
// **Adoption first** (exec/adopt.ts, run job_0b682db7df32e7b4): a live worker whose Dispatch record was lost is
// recorded again before any remedy, so its Task never reads as ready or lost while its worker still runs.
import type { ActivityDraft } from '../activity'
import { readyWithoutWorker, type CoordinatorNotice } from '../inbox'
import { jobNameOf } from '../jobName'
import { wavesToMerge } from '../integrate'
import { draftPrDue } from '../draftPr'
import { handsOffOf } from '../delivery'
import { isJobActive } from '../lifecycle'
import { lostRetriedIn, lostWithDriver, lostWithNobody } from '../lostGate'
import { isLost } from '../../recovery/candidates'
import { editingByProject, isLeaseWaitGate, LEASE_WAIT_OPTIONS, projectKeyOf, sameFilesAs, serialFilesOf, workerCapOf, workersAgainstCap } from '../schedule'
import { DROPPED_OPTIONS, isDroppedGate, plannerOverlapNotices } from '../overlap'
import { coordinatorStarting, jobOf, runGatedForTask, type OrchState } from '../state'
import { DEFAULT_CONCURRENCY, FAILURE_LIMIT, type Dispatch, type Job, type JobRun, type Task } from '../types'
import { outcomeOf } from '../view'
import { ENTER_DELAY_MS } from '../../sessions/sessionDriver'
import { workerStartInFlight } from './coordinatorRotate'
import { latestImplDispatch } from '../convergence'
import { providerOf } from '../../providers/meta'
import { startPauseOf } from '../usageGuard'
import type { Account } from '../../types'

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
/** A Task left `dispatched` this long after its worker's session ended unreported, or with no Dispatch at all and no
 *  live worker to adopt: it is started again (`--retry-of` when there was one). */
export const LOST_STALL_MS = 2 * 60_000
/** A worker idle at its prompt this long with its Dispatch open (no `worker-done`): it is nudged. */
export const IDLE_STALL_MS = 10 * 60_000
/** A Task `validating` this long with no check of it running (its run's exit lost, or its start never reached a
 *  validator): its validation is started again, as the resume sweep restarts one. */
export const VALIDATE_STALL_MS = 5 * 60_000
/** The waits between the tries of a stall that stays (after its first); the last repeats. */
export const BACKOFF_MS = [2 * 60_000, 5 * 60_000, 10 * 60_000, 20 * 60_000]
/** Tries of one stall before it is raised to the owner: the placements of a ready Task, the restarts of a coordinator,
 *  the retries of a lost Task. */
export const TRIES = 4

/** T11: a ready Task held back by another plan's lease this long: its coordinator is told, once. */
export const LEASE_TELL_MS = 30 * 60_000
/** ... and this long: one owner question, wait, run it anyway or cancel it (`LEASE_WAIT_OPTIONS`). */
export const LEASE_ASK_MS = 2 * 60 * 60_000
/** T11: a ready Task the watchdog cannot start (no account, out of tries, its account paused) is a feed line at once
 *  and one owner question after this (`DROPPED_OPTIONS`). */
export const DROPPED_ASK_MS = 15 * 60_000
/** T11: a plan paused, held or replanning this long with no open owner question raises one; a replan, once. */
export const HOLD_ASK_MS = 30 * 60_000
/** T11: a planner gone, or idle this long without handing its plan over, is nudged ... */
export const PLANNER_IDLE_MS = 20 * 60_000
/** ... restarted with the same brief this long after the nudge, and raised to the owner once after a restart that
 *  stays as idle as long as `PLANNER_IDLE_MS`. */
export const PLANNER_RESTART_MS = 10 * 60_000

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
  /** T1: "Pick accounts automatically" is on: a Task with no account is auto, not dropped (wrap `paused` in
   *  startPauseOf, usageGuard.ts, so it holds only when the provider has no account with room). Absent: off. */
  autoAccounts?: boolean
  /** The app-wide cap setting (`maxConcurrentWorkers`), null for the default. Absent: the default (`workerCapOf`). */
  cap?: number | null
  /** Whether a session is alive: a Run driven by a live external coordinator gets no restart. Absent: it is. */
  alive?(sessionId: string): boolean
  /** Whether a check of this Task is queued or running (HostChecks.checking). Absent: a `validating` Task is never
   *  taken for a lost validation. */
  checking?(taskId: string): boolean
}

export type StallRemedy = { key: string; runId: string } & (
  | { kind: 'tell-start'; task: Task; since: number }
  | { kind: 'place'; task: Task; since: number }
  | { kind: 'tell-busy'; sessionId: string; since: number }
  | { kind: 'refresh'; sessionId: string; since: number }
  | { kind: 'merge'; task: Task; runRoot: string; worktree: string }
  | { kind: 'draft-pr'; done: number }
  | { kind: 'restart'; since: number; try: number }
  /** No `dispatch`: the Task is `dispatched` with no record at all, and no live worker runs its spec */
  | { kind: 'retry-lost'; task: Task; dispatch?: Dispatch; try: number }
  | { kind: 'nudge-worker'; task: Task; dispatch: Dispatch; since: number }
  /** A Task `validating` with no check of it running: its validation started again in its implementation's folder */
  | { kind: 'revalidate'; task: Task; cwd: string; since: number; try: number }
  | { kind: 'tell-idle'; task: Task; dispatch: Dispatch; since: number }
  | { kind: 'escalate'; taskId: string; dispatchId?: string; subject: string; body: string }
  /** T11: a Task held by another plan's lease for `LEASE_TELL_MS`: its coordinator is told */
  | { kind: 'tell-lease'; task: Task; plan: string; since: number }
  /** T11: one owner question, a Gate on the Task with the watchdog's answers (overlap.ts carries them out) */
  | { kind: 'ask'; task: Task; question: string; options: string[] }
  /** T11: a ready Task the watchdog cannot start: a feed line */
  | { kind: 'note-dropped'; task: Task; reason: string }
  /** T11: a planner gone or idle without handing over: nudged, restarted with its brief (`account`: one not paused, or
   *  none known), then raised. `runId` is the Job's id: a plan still planning has no Run. */
  | { kind: 'nudge-planner'; jobId: string; sessionId: string; since: number }
  | { kind: 'restart-planner'; jobId: string; sessionId: string; alive: boolean; account?: string }
  | { kind: 'raise-planner'; jobId: string; reason: string }
)

/** The remedies `createStallWatch` applies; the dispatch loop applies the others (header). */
export const APPLIED_HERE: ReadonlySet<StallRemedy['kind']> = new Set([
  'restart',
  'retry-lost',
  'revalidate',
  'nudge-worker',
  'tell-idle',
  'escalate',
  'tell-lease',
  'ask',
  'note-dropped',
  'nudge-planner',
  'restart-planner',
  'raise-planner'
])

/** What a worker idle at its prompt without a report is typed. English: workers read English (spec files). */
export const IDLE_NUDGE =
  'You stopped without reporting. Finish the Task, or report with `astera send --type worker_done` (see your spec), ' +
  'or ask a question with `astera ask` if you are stuck.'

/** T11: what a planner gone quiet without handing its plan over is typed. English, as `IDLE_NUDGE`. */
export const PLANNER_NUDGE =
  'Astera: you have been idle without handing the plan over. Finish the plan (every Task with a prompt and criteria) ' +
  'and end your turn, or say in this terminal what you need.'

/** T11: whether a Run waits on the owner already: an open Gate, or a question or escalation not answered. */
const ownerAsked = (s: OrchState, runId: string): boolean =>
  s.gates.some((g) => g.runId === runId && g.status === 'open') ||
  s.messages.some((m) => m.runId === runId && (m.type === 'question' || m.type === 'escalation') && !m.answered)

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

/** T1: the probe's usage hold. With "Pick accounts automatically" on, an account holds only while its provider has no
 *  logged-in account with room (startPauseOf), and a Task with no account is auto. Off, or no hold wired: as it is. */
export async function stallPauseProbe(a: {
  auto: boolean
  paused?(accountId: string): boolean
  accounts(): Account[] | Promise<Account[]>
  loginStatus(accountId: string): Promise<boolean>
}): Promise<Pick<StallProbe, 'paused' | 'autoAccounts'>> {
  const paused = a.paused
  if (!a.auto) return paused ? { paused: (id) => paused(id) } : {}
  if (!paused) return { autoAccounts: true }
  const accounts = await a.accounts()
  const loggedInIds = new Set((await Promise.all(accounts.map(async (x) => ((await a.loginStatus(x.id)) ? x.id : null)))).filter((id): id is string => id !== null))
  const of = startPauseOf((id) => (paused(id) ? true : null), { auto: true, accounts, loggedInIds })
  return { autoAccounts: true, paused: (id) => of(id) !== null }
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
    const candidates: Task[] = []
    for (const t of readyWithoutWorker(s, run.id)) {
      // T1: with "Pick accounts automatically" on, no account is "auto" (placed on the account with most room)
      const first = t.accountIds?.[0]
      const reason =
        first === undefined && probe.autoAccounts !== true
          ? 'it has no account'
          : t.consecutiveFailures >= FAILURE_LIMIT
            ? `it failed ${t.consecutiveFailures} times in a row`
            : first !== undefined && probe.paused?.(first) === true
              ? `its account ${first} is paused for usage`
              : null
      if (reason === null) {
        candidates.push(t)
        continue
      }
      // T11: never dropped in silence: a feed line, then one owner question (a Gate, so the Task waits on the answer)
      const key = `dropped:${t.id}:${reason}`
      const e = seen(key, nowMs)
      if (e.step === 0) {
        due.push({ key, runId: run.id, kind: 'note-dropped', task: t, reason })
        stepped(key, e)
      } else if (e.step === 1 && nowMs - e.since >= DROPPED_ASK_MS && !s.gates.some((g) => g.taskId === t.id && g.status === 'open')) {
        due.push({
          key,
          runId: run.id,
          kind: 'ask',
          task: t,
          question:
            `${t.title} (${t.id}, plan ${jobNameOf(job)}) is ready but Astera cannot start it: ${reason}. Use another of its ` +
            'accounts, retry it once more, or cancel it?',
          options: [...DROPPED_OPTIONS]
        })
        stepped(key, e)
      }
    }
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
        // T11: held by another plan's lease (its files wait for that plan's delivery): told, then one owner question
        const lease = clash?.task.lease
        if (lease && lease.jobId !== job.id) {
          const key = `lease:${t.id}:${lease.jobId}`
          const e = seen(key, nowMs)
          const holder = s.jobs.find((j) => j.id === lease.jobId)
          const plan = holder ? jobNameOf(holder) : lease.jobId
          if (e.step === 0 && nowMs - e.since >= LEASE_TELL_MS) {
            due.push({ key, runId: run.id, kind: 'tell-lease', task: t, plan, since: e.since })
            stepped(key, e)
          } else if (e.step === 1 && nowMs - e.since >= LEASE_ASK_MS) {
            // Once per Task: an answered "Let it wait" is not asked again
            if (!s.gates.some((g) => g.taskId === t.id && isLeaseWaitGate(g)))
              due.push({
                key,
                runId: run.id,
                kind: 'ask',
                task: t,
                question:
                  `${t.title} (plan ${jobNameOf(job)}) has waited ${Math.round((nowMs - e.since) / 60_000)} min for plan ${plan} to ` +
                  `deliver ${clash!.path} (${clash!.task.title}). Let it wait, run it now anyway, or cancel this Task?`,
                options: [...LEASE_WAIT_OPTIONS]
              })
            stepped(key, e)
          }
        }
        continue
      }
      free--
      capFree--
      startable++
      // T7: only a project that keeps same-file Tasks apart (schedule.ts `serialFilesOf`)
      if (serialFilesOf(s, project)) editing.set(project, [...(editing.get(project) ?? []), t])
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

  // T11: a plan paused, held or replanning never waits on nobody. A replan held `HOLD_ASK_MS` re-notifies the owner
  // once (its subject carries the replan's start, so a restart does not raise it again); any other hold that long
  // with no open owner question on the Run raises one.
  for (const run of s.runs) {
    const job = jobOf(s, run)
    if (!job || !isJobActive(job) || job.pendingStart || outcomeOf(s, run.id) !== 'running') continue
    if (s.runs.some((r) => r.jobId === run.jobId && r.ordinal > run.ordinal)) continue
    const replanAt = job.replanning?.startedAt ?? (job.dispatchHold && job.lastReplan?.escalated !== undefined ? job.lastReplan.at : undefined)
    const how = job.replanning ? 'replanning' : replanAt !== undefined ? 'held after its replan' : job.paused || run.paused ? 'paused' : job.dispatchHold ? 'on hold' : null
    if (how === null) continue
    const taskId = s.tasks.find((t) => t.runId === run.id)?.id
    if (taskId === undefined) continue
    const key = `hold:${run.id}:${how}`
    const e = seen(key, replanAt !== undefined ? Date.parse(replanAt) : nowMs)
    if (e.step > 0 || nowMs - e.since < HOLD_ASK_MS) continue
    if (replanAt === undefined && ownerAsked(s, run.id)) continue
    const mins = Math.round((nowMs - e.since) / 60_000)
    escalate(key, e, run.id, {
      taskId,
      subject:
        replanAt !== undefined
          ? `watchdog: plan ${job.id} ${how} since ${replanAt}`
          : `watchdog: plan ${job.id} ${how} for ${mins} min`,
      body:
        `${jobNameOf(job)} has been ${how} for ${mins} min, so none of its ready work starts. ` +
        (replanAt !== undefined ? 'Answer its replan question, or lift the hold from the plan page.' : 'Resume it from the plan page, or stop it.')
    })
  }

  // T11: the first planning stage. A plan still planning (not chat planning, where the planner waits on the person)
  // whose latest planner is gone, or idle `PLANNER_IDLE_MS` without handing the plan over (Job.planReadyAt): nudged,
  // restarted with the same brief `PLANNER_RESTART_MS` later, then raised once. The entry lives while the plan plans,
  // so a planner that works a while and stops again goes on from where it was, never from the start.
  for (const job of s.jobs) {
    const sessionId = job.plannerSessionIds?.at(-1)
    if (sessionId === undefined || job.pendingStart !== true || !isJobActive(job) || job.planReadyAt !== undefined || (job.planning ?? (handsOffOf(s, job) ? 'auto' : 'chat')) === 'chat')
      continue
    const alive = probe.alive?.(sessionId) ?? true
    const busy = alive ? probe.busy(sessionId) : false
    if (busy === null) continue
    const key = `planner:${job.id}`
    let e = seen(key, nowMs)
    // `since`: when it last went quiet; working puts it at now
    if (busy) {
      e = { ...e, since: nowMs }
      next.set(key, e)
      continue
    }
    const quiet = nowMs - e.since
    if (e.step === 0 && quiet >= PLANNER_IDLE_MS) {
      if (alive) {
        due.push({ key, runId: job.id, kind: 'nudge-planner', jobId: job.id, sessionId, since: e.since })
        stepped(key, e)
        continue
      }
      e = { ...e, step: 1, at: nowMs - PLANNER_RESTART_MS } // gone: nothing to nudge, restart now
    }
    if (e.step === 1 && quiet >= PLANNER_RESTART_MS && nowMs - e.at >= PLANNER_RESTART_MS) {
      const preferred = job.plannerAccountId ?? job.coordinatorAccountId
      due.push({
        key,
        runId: job.id,
        kind: 'restart-planner',
        jobId: job.id,
        sessionId,
        alive,
        ...(preferred !== undefined && probe.paused?.(preferred) !== true ? { account: preferred } : {})
      })
      stepped(key, e)
    } else if (e.step === 2 && quiet >= PLANNER_IDLE_MS && nowMs - e.at >= PLANNER_IDLE_MS) {
      due.push({
        key,
        runId: job.id,
        kind: 'raise-planner',
        jobId: job.id,
        reason:
          `the planner of ${jobNameOf(job)} stopped without handing its plan over, a nudge and a restart did not move it. ` +
          'Open its terminal and tell it what to do, plan it again, or reject the plan.'
      })
      stepped(key, e)
    }
  }

  // Lost: `dispatched`, its last Dispatch ended unreported and its coordinator has not started it again. Retried
  // (`--retry-of`) up to the Task's retry limit, then the owner. A Run nobody drives has the lost-worker Gate.
  // Untracked: `dispatched` with no Dispatch at all (its record lost, candidates.ts lostAttemptOf sees none) and no live
  // worker left to adopt (adoption ran first, header): started again the same way, never left silent.
  const untracked = s.tasks
    .filter((t) => t.status === 'dispatched' && !runGatedForTask(s, t) && !s.dispatches.some((d) => d.taskId === t.id))
    .map((t) => ({ runId: t.runId ?? '', taskId: t.id, dispatch: undefined as Dispatch | undefined }))
  for (const seed of [...lostWithDriver(s), ...untracked]) {
    const run = s.runs.find((r) => r.id === seed.runId)
    const job = run && jobOf(s, run)
    const task = s.tasks.find((t) => t.id === seed.taskId)
    if (!run || !placing(run, job) || !task) continue
    // Nobody to retry it (no coordinator, not app-driven): an untracked Task is raised to its owner once, never started
    // again. One whose lost Dispatch ended has the lost-worker Gate instead (lostGate.ts). A live external coordinator
    // drives it. An app-driven Run is driven: this watchdog starts its lost Tasks again, as a coordinator would.
    const driven = lostRetriedIn(s, run) || (run.externalCoordinatorSessionId !== undefined && (probe.alive?.(run.externalCoordinatorSessionId) ?? true))
    if (!driven && seed.dispatch) continue
    const lostAt = seed.dispatch ? Date.parse(seed.dispatch.endedAt!) : (at.get(task.id) ?? nowMs)
    if (nowMs - lostAt < LOST_STALL_MS) continue
    const key = seed.dispatch ? `lost:${seed.dispatch.id}` : `untracked:${task.id}`
    const e = seen(key, lostAt)
    if (!due_(e, 0)) continue
    const lostTimes = s.dispatches.filter((d) => d.taskId === task.id && isLost(d)).length
    const spent = !driven || lostTimes >= FAILURE_LIMIT || task.consecutiveFailures >= FAILURE_LIMIT
    if (!spent && e.step < TRIES) {
      due.push({ key, runId: run.id, kind: 'retry-lost', task, ...(seed.dispatch ? { dispatch: seed.dispatch } : {}), try: e.step + 1 })
      stepped(key, e)
    } else if (spent ? e.step === 0 : e.step === TRIES)
      escalate(key, e, run.id, {
        taskId: task.id,
        ...(seed.dispatch ? { dispatchId: seed.dispatch.id } : {}),
        subject: seed.dispatch
          ? `watchdog: task ${task.id} lost its worker ${seed.dispatch.id}`
          : `watchdog: task ${task.id} is dispatched with no worker`,
        body: seed.dispatch
          ? `${task.id} (${task.title})'s worker ended without a report ${spent ? `${lostTimes} times` : `and ${TRIES} retries did not start a new one`}, ` +
            'so it waits. Start it again, change its spec, or stop it.'
          : `${task.id} (${task.title}) is dispatched with no worker on record and none running its spec, and ` +
            `${!driven ? 'its Run has no coordinator to start it again' : spent ? 'it is out of retries' : `${TRIES} tries did not start a new one`}, so it waits. Start it again, change its spec, or stop it.`
      })
  }

  // Lost validation: `validating`, no open Dispatch and no check of it queued or running, so nothing will ever give it a
  // verdict (worker-start refuses it, and the resume sweep runs only at a Host boot or an app leaving). Its validation
  // is started again in its implementation's folder, with backoff, then the owner. Only with the check probe wired.
  for (const task of probe.checking ? s.tasks : []) {
    if (task.status !== 'validating' || runGatedForTask(s, task) || probe.checking!(task.id)) continue
    if (s.dispatches.some((d) => d.taskId === task.id && !d.outcome && !d.endedAt)) continue
    const run = s.runs.find((r) => r.id === task.runId)
    const impl = latestImplDispatch(s, task.id)
    if (!run || !impl || !placing(run, jobOf(s, run))) continue
    const since = at.get(task.id) ?? nowMs
    const key = `revalidate:${task.id}:${task.updatedAt}`
    const e = seen(key, since)
    if (!due_(e, e.since + VALIDATE_STALL_MS)) continue
    if (e.step < TRIES) {
      due.push({ key, runId: run.id, kind: 'revalidate', task, cwd: impl.cwd, since: e.since, try: e.step + 1 })
      stepped(key, e)
    } else if (e.step === TRIES)
      escalate(key, e, run.id, {
        taskId: task.id,
        subject: `watchdog: task ${task.id} validating since ${new Date(e.since).toISOString()} with no check running`,
        body:
          `${task.id} (${task.title}) has been validating with no check running, and ${TRIES} restarts of its checks did ` +
          'not give it a verdict. Look at its checks (Runs panel), retry it, or stop it.'
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

  // A Task merged, the plan branch not pushed (draftPr.ts draftPrDue stays due until a push records it; T3: not while a
  // failed push waits for its retry time, which the driving loop keeps itself)
  for (const run of s.runs) {
    const done = draftPrDue(s, run, nowMs)
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
      `astera worker-start --task ${t.id} --agent ${agent}${t.accountIds?.[0] ? ` --account ${t.accountIds[0]}` : ''} --json\n\n` +
      'If it is still unstarted in 2 minutes, Astera starts it itself.'
  }
}

/** What `createStallWatch` needs from the Host: its command door, state and sessions, and the loop's `tell`. */
export interface StallWatchDeps {
  handle(cmd: string, args: Record<string, unknown>): Promise<{ status: number; body: unknown }>
  getState(): OrchState
  /** HostChecks.checking and startValidation: a lost validation is started again. Absent (either): it is not. */
  checking?(taskId: string): boolean
  startValidation?(a: { taskId: string; cwd: string }): void
  /** The "Watch for stalled plans" setting. */
  on(): boolean | Promise<boolean>
  /** The app-wide cap setting, null for the default. */
  cap(): number | null | Promise<number | null>
  busy(sessionId: string): boolean | null
  alive(sessionId: string): boolean
  isRegistered(p: string): boolean
  paused?(accountId: string): boolean
  /** T1: "Pick accounts automatically" (UsageGuard.autoAccounts) and the login check, for stallPauseProbe. Absent: off. */
  autoAccounts?(): boolean
  loginStatus?(accountId: string): Promise<boolean>
  typeInto(sessionId: string, text: string): void
  /** DispatchLoop.tell: a `status` message into a coordinator's Run inbox. */
  tell(n: CoordinatorNotice): Promise<boolean>
  activity?(d: ActivityDraft): void
  /** Records each live worker session that runs a Task's spec with no Dispatch of its own (exec/adopt.ts), as one
   *  serialized commit, and answers what it recorded. Absent: nothing is adopted. */
  adopt?(): Promise<Dispatch[]>
  /** accounts.json: the agent of an untracked Task's account, to start it again. Absent: the Task's provider. */
  accounts?(): Account[] | Promise<Account[]>
  mayStart(): boolean
  log(m: string): void
  nowMs(): number
  /** Test seam; defaults to setTimeout. */
  wait?(ms: number): Promise<void>
}

/** The watchdog's own applier for `APPLIED_HERE` (header): at most once per `STALL_WATCH_MS`, adoption and then the
 *  remedies due, each with its feed line ("Handled for you"). `adopt` alone is the Host pass's first step, so neither
 *  the loop nor recovery reads an untracked worker's Task as ready or lost. Never throws. */
export function createStallWatch(d: StallWatchDeps): { adopt(): Promise<void>; watch(): Promise<void> } {
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
        // As a coordinator retries one: the same account and agent, a new Dispatch linked to the lost one. With no
        // Dispatch on record, as a coordinator starts one: the Task's first account, on that account's agent
        const account = r.dispatch?.accountId ?? r.task.accountIds?.[0] ?? ''
        const agent =
          r.dispatch?.provider ??
          (await Promise.resolve(d.accounts?.() ?? [])).map((a) => (a.id === account ? providerOf(a) : null)).find((p) => p !== null) ??
          r.task.provider ??
          'claude'
        const start = (on?: string) =>
          d.handle('worker-start', { task: r.task.id, agent, ...(on ? { account: on } : {}), ...(r.dispatch ? { retryOf: r.dispatch.id } : {}) })
        let reply = await start(account)
        // That account is out of usage (paused until its window resets): any other with room, as worker-start picks
        if (reply.status === 409 && (reply.body as { usagePaused?: unknown })?.usagePaused !== undefined) reply = await start()
        line(
          r.runId,
          reply.status < 400
            ? `started ${r.task.title} again: its worker ended without a report (try ${r.try} of ${TRIES})`
            : `could not start ${r.task.title} again after its worker ended without a report (try ${r.try} of ${TRIES}): ${why(reply.body)}`,
          r.task.id
        )
        return
      }
      case 'revalidate': {
        // The resume sweep's restart (resumeSweep.ts): the Task is already `validating`, so the runner takes it
        d.startValidation?.({ taskId: r.task.id, cwd: r.cwd })
        line(
          r.runId,
          `restarted the checks of ${r.task.title}: it was validating ${mins(d.nowMs() - r.since)} min with no check running (try ${r.try} of ${TRIES})`,
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
      case 'tell-lease': {
        const ok = await d.tell({
          runId: r.runId,
          taskId: r.task.id,
          subject: `watchdog: task ${r.task.id} waits for plan ${r.plan} since ${new Date(r.since).toISOString()}`,
          body:
            `${r.task.id} (${r.task.title}) has waited ${mins(d.nowMs() - r.since)} minutes for plan ${r.plan} to deliver the ` +
            'files it needs. Plan around them if you can; at 2 hours Astera asks the owner whether to run it anyway.'
        })
        line(
          r.runId,
          ok
            ? `told the coordinator ${r.task.title} has waited ${mins(d.nowMs() - r.since)} min for plan ${r.plan} to deliver`
            : `${r.task.title} has waited ${mins(d.nowMs() - r.since)} min for plan ${r.plan}, and the coordinator could not be told`,
          r.task.id
        )
        return
      }
      case 'ask': {
        const reply = await d.handle('gate-create', { task: r.task.id, question: r.question, options: r.options })
        line(r.runId, reply.status < 400 ? `asked you: ${r.question}` : `could not ask you about ${r.task.title}: ${why(reply.body)}`, r.task.id)
        return
      }
      case 'note-dropped':
        line(r.runId, `${r.task.title} is ready but not started: ${r.reason}`, r.task.id)
        return
      case 'nudge-planner': {
        const reply = await d.handle('sessions-send', { id: r.sessionId, text: PLANNER_NUDGE })
        planLine(
          r.jobId,
          reply.status < 400
            ? `nudged the planner: idle ${mins(d.nowMs() - r.since)} min without handing the plan over`
            : `the planner is idle ${mins(d.nowMs() - r.since)} min and could not be nudged: ${why(reply.body)}`
        )
        return
      }
      case 'restart-planner': {
        // The old planner goes first, so two never plan one Job; a close that fails is said and the start goes on
        if (r.alive) {
          const closed = await d.handle('sessions-close', { id: r.sessionId, reason: 'planner restarted by the watchdog' })
          if (closed.status >= 400) d.log(`job=${r.jobId}: watchdog: the old planner ${r.sessionId} could not be closed: ${why(closed.body)}`)
        }
        // A usable account: the plan's own when it is not paused, else the first of the profile's that is not
        const account =
          r.account ?? (await Promise.resolve(d.accounts?.() ?? [])).find((a) => d.paused?.(a.id) !== true)?.id
        const reply = await d.handle('jobs-plan', { id: r.jobId, ...(account !== undefined ? { account } : {}) })
        planLine(
          r.jobId,
          reply.status < 400
            ? `restarted the planner with the same brief${account !== undefined ? ` on ${account}` : ''}: it stopped without handing the plan over`
            : `the planner stopped without handing the plan over and could not be restarted: ${why(reply.body)}`
        )
        return
      }
      case 'raise-planner':
        planLine(r.jobId, r.reason, 'task.escalated')
        return
      default:
        return // the dispatch loop's (header)
    }
  }

  /** T11: a plan still planning has no Run: its line names the Job. `task.escalated` puts it before the owner. */
  const planLine = (jobId: string, reason: string, type: 'watchdog' | 'task.escalated' = 'watchdog'): void => {
    d.log(`job=${jobId}: watchdog: ${reason}`)
    const job = d.getState().jobs.find((j) => j.id === jobId)
    try {
      d.activity?.({
        type,
        ...(job?.projectId !== undefined ? { projectId: job.projectId } : {}),
        jobId,
        payload: { title: job ? jobNameOf(job) : jobId, reason: `${reason[0].toUpperCase()}${reason.slice(1)}` }
      })
    } catch (e) {
      d.log(`job=${jobId}: watchdog: the feed line could not be recorded: ${String(e)}`)
    }
  }

  /** T11: plans planned at the same time see each other: each overlap a planner's plan meets is typed into it once
   *  per (plan pair, what they share). Not behind the setting: it tells, and moves nothing.
   *  shortcut: the keys told are in memory, so a Host restart tells a planner still planning once more; persist them
   *  if that ever bothers. */
  const told = new Set<string>()
  const tellPlanners = async (): Promise<void> => {
    for (const n of plannerOverlapNotices(d.getState())) {
      if (told.has(n.key) || !d.alive(n.sessionId)) continue
      told.add(n.key)
      try {
        const reply = await d.handle('sessions-send', { id: n.sessionId, text: n.text })
        if (reply.status >= 400) d.log(`job=${n.jobId}: the planner could not be told of an overlap: ${why(reply.body)}`)
      } catch (e) {
        d.log(`job=${n.jobId}: the planner could not be told of an overlap: ${String(e)}`)
      }
    }
  }

  /** Not behind the setting: it records what is true, a worker running, and starts or stops nothing. */
  const adopt = async (): Promise<void> => {
    if (!d.adopt || !d.mayStart()) return
    try {
      for (const x of await d.adopt()) {
        const task = d.getState().tasks.find((t) => t.id === x.taskId)
        line(task?.runId ?? '', `adopted the worker of ${task?.title ?? x.taskId}: it ran with no record of its start`, x.taskId)
      }
    } catch (e) {
      d.log(`watchdog: adopting untracked workers failed: ${String(e)}`)
    }
  }

  return {
    adopt,
    async watch(): Promise<void> {
      if (watching || d.nowMs() - lastAt < STALL_WATCH_MS) return
      watching = true
      lastAt = d.nowMs()
      try {
        await adopt()
        await tellPlanners()
        if (!(await d.on())) {
          memo = new Map()
          return
        }
        const cap = await d.cap()
        const usage = await stallPauseProbe({
          auto: d.autoAccounts?.() === true && d.loginStatus !== undefined,
          ...(d.paused ? { paused: (id: string) => d.paused!(id) } : {}),
          accounts: () => d.accounts?.() ?? [],
          loginStatus: (id) => d.loginStatus!(id)
        })
        const planned = stallRemedies(d.getState(), d.nowMs(), memo, {
          busy: (id) => d.busy(id),
          isRegistered: (p) => d.isRegistered(p),
          ...usage,
          cap,
          alive: (id) => d.alive(id),
          ...(d.checking && d.startValidation ? { checking: (id: string) => d.checking!(id) } : {})
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
