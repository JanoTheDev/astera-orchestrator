// W9-I: tab summaries in the Host (DESIGN §4). A tab that ends leaves a card: facts Astera already holds
// (core/sessions/summary.ts) and, when a model can be asked, 2–3 sentences. The Host writes it, so it happens with the
// window closed. **Once per session**: a card in <profile>/summaries.json, or one in flight, ends every later trigger.
//
// Triggers: a Task's worker session when the Task ends (merged / given up) or when its Dispatch ended and nothing will
// follow it (`endedTabsOf`, fed by orch.ts commits); a plain session when its pty exits, or when it has idled at a
// finished turn for `idleMs` (spawner busy edges) — and only if it wrote something.
//
// **The prose never blocks and never loops.** One model call per card, one card at a time, a short timeout; a refusal, a
// failure or a timeout stores the facts with an empty `text`, and nothing asks again.
//
// Imports nothing from electron, src/main or src/renderer (importFence.test.ts).
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Account, Provider } from '../core/types'
import type { ProviderDescriptor } from '../core/providers/descriptor'
import type { ActivityEvent } from '../core/orchestration/activity'
import type { OrchState } from '../core/orchestration/state'
import type { Dispatch, Job, Task } from '../core/orchestration/types'
import { resolveRoleModel, type RoleModelSettings } from '../core/orchestration/roleModels'
import { providerOf } from '../core/providers/meta'
import { runAgent } from '../core/understanding/agent'
import type { SessionCheck } from '../core/understanding/types'
import { keepDamaged, readStoreFile } from '../core/storeFile'
import { renameRetrying } from '../core/renameRetry'
import { proseOf, summaryFactsOf, summaryPrompt, type SessionSummary, type SummaryFile } from '../core/sessions/summary'

/** A plain session idles this long at a finished turn before it gets a card. */
export const SUMMARY_IDLE_MS = 10 * 60_000
/** The model gets this long for the prose; a card is short. */
export const SUMMARY_PROSE_TIMEOUT_MS = 90_000

const isTerminal = (t: Pick<Task, 'status'>): boolean => t.status === 'completed' || t.status === 'failed'

/**
 * The worker sessions whose tab just ended, from one commit's two states. A Task that became completed or failed ends
 * all its worker sessions (a review session is not a tab that did the work). A Dispatch that just ended ends its
 * session when its Task is already over, or when a later attempt of the Task exists (a retry replaced it); otherwise the
 * Task is still going, validation and review follow, and the Task's own end carries the card.
 */
export function endedTabsOf(prev: OrchState, next: OrchState): { sessionId: string; taskId: string }[] {
  const out = new Map<string, string>()
  const prevTask = new Map(prev.tasks.map((t) => [t.id, t]))
  const prevDispatch = new Map(prev.dispatches.map((d) => [d.id, d]))
  const workers = (taskId: string): Dispatch[] => next.dispatches.filter((d) => d.taskId === taskId && d.review !== true)
  for (const t of next.tasks) {
    if (isTerminal(t) && !(prevTask.get(t.id) && isTerminal(prevTask.get(t.id)!))) for (const d of workers(t.id)) out.set(d.sessionId, t.id)
  }
  for (const d of next.dispatches) {
    if (d.review === true || d.endedAt === undefined || prevDispatch.get(d.id)?.endedAt !== undefined) continue
    const task = next.tasks.find((t) => t.id === d.taskId)
    if (!task) continue
    const later = workers(task.id).some((x) => x.startedAt > d.startedAt)
    if (isTerminal(task) || later) out.set(d.sessionId, task.id)
  }
  return [...out].map(([sessionId, taskId]) => ({ sessionId, taskId }))
}

export interface SessionInfo {
  title: string
  cwd: string | null
  accountId: string | null
}

export interface HostSummariesDeps {
  /** <profile>/summaries.json */
  file: string
  /** `tabSummaries`, read per card: false ends every trigger. */
  enabled(): Promise<boolean>
  /** null before the Host has loaded orchestration state. */
  state(): OrchState | null
  activity(): ActivityEvent[]
  /** A live or ended session this Host knows, or null. */
  sessionInfo(sessionId: string): Promise<SessionInfo | null>
  /** Files changed in `base..head` (head null: the working tree), or null when git cannot say. */
  diffOf(cwd: string, base: string, head: string | null): Promise<SummaryFile[] | null>
  commitsOf(cwd: string, base: string, head: string): Promise<string[]>
  /** The session's work unit: the checks it reported, its own summary, where it started. */
  unitOf(sessionId: string): Promise<{ checks?: SessionCheck[]; resultSummary?: string; startHead?: string | null } | undefined>
  /** The last messages of the tab, best effort ('' when the Host no longer holds them). */
  tailOf(sessionId: string): Promise<string>
  agentSessionOf?(sessionId: string): Promise<string | null>
  accounts(): Promise<Account[]>
  descriptors: Record<Provider, ProviderDescriptor>
  /** The understanding generator's account, if the owner chose one (app-settings `generator`). */
  generatorAccountId(): Promise<string | undefined>
  roleModels(): Promise<RoleModelSettings>
  lang?(): Promise<string | undefined>
  idleMs?: number
  now?(): string
  log(m: string): void
  /** Test seam: the agent round trip (core/understanding/agent.ts). */
  runAgent?: typeof runAgent
}

export interface HostSummaries {
  /** An orchestration commit: the tabs it ended get their cards. Never throws, never waits on the model. */
  committed(prev: OrchState, next: OrchState): void
  /** A pty of session `sessionId` exited and no other pty holds it (a plain session's end). */
  sessionExited(sessionId: string): void
  /** The spawner's busy edge: a finished turn starts the idle clock, a new turn stops it. */
  sessionBusy(sessionId: string, busy: boolean): void
  /** Cards, newest first; only a plan's with `jobId`. */
  read(jobId?: string): Promise<SessionSummary[]>
  /** Test seam: resolves once every card queued so far is written. Never rejects. */
  settled(): Promise<void>
  dispose(): void
}

interface StoreFile {
  version: 1
  summaries: SessionSummary[]
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export function createHostSummaries(d: HostSummariesDeps): HostSummaries {
  const now = d.now ?? (() => new Date().toISOString())
  let chain: Promise<void> = Promise.resolve()
  /** Sessions with a card queued or being written: with the file, the once-per-session guard. */
  const claimed = new Set<string>()
  const idle = new Map<string, ReturnType<typeof setTimeout>>()

  const load = async (): Promise<StoreFile> => {
    const r = await readStoreFile(d.file)
    if (r.kind === 'missing') return { version: 1, summaries: [] }
    if (r.kind === 'unreadable') throw r.error
    try {
      const v = JSON.parse(r.text) as Partial<StoreFile>
      if (v.version === 1 && Array.isArray(v.summaries)) return v as StoreFile
    } catch {
      // damaged: kept beside, started empty
    }
    await keepDamaged(d.file, r.text)
    return { version: 1, summaries: [] }
  }

  const save = async (f: StoreFile): Promise<void> => {
    await fs.mkdir(path.dirname(d.file), { recursive: true, mode: 0o700 })
    const tmp = `${d.file}.${process.pid}.tmp`
    await fs.writeFile(tmp, JSON.stringify(f), { mode: 0o600 })
    await renameRetrying(tmp, d.file)
  }

  /** The prose, or null: no account, a refusal, a failure and a timeout all read the same way. */
  const proseFor = async (a: {
    accountId: string | null
    cwd: string
    job?: Job
    prompt: string
  }): Promise<{ text: string; model?: string } | null> => {
    try {
      const wanted = (await d.generatorAccountId()) ?? a.accountId
      const account = wanted ? (await d.accounts()).find((x) => x.id === wanted) : undefined
      if (!account) return null
      const model = resolveRoleModel(await d.roleModels(), a.job, 'coordinator', providerOf(account))
      const run = await (d.runAgent ?? runAgent)({
        account,
        descriptors: d.descriptors,
        generator: { accountId: account.id, ...(model ? { model } : {}) },
        cwd: a.cwd,
        prompt: a.prompt,
        timeoutMs: SUMMARY_PROSE_TIMEOUT_MS,
        log: d.log
      })
      if (!run.ok) {
        d.log(`summaries: no prose (${run.reason})`)
        return null
      }
      const text = proseOf(run.value)
      return text === null ? null : { text, ...(model ? { model } : {}) }
    } catch (err) {
      d.log(`summaries: no prose: ${message(err)}`)
      return null
    }
  }

  /** Facts, prose, write — for a worker session of a Task, or a plain one (`taskId` undefined). */
  const build = async (sessionId: string, taskId: string | undefined): Promise<SessionSummary | null> => {
    const s = d.state()
    const task = taskId === undefined ? undefined : s?.tasks.find((t) => t.id === taskId)
    const dispatches = task && s ? s.dispatches.filter((x) => x.taskId === task.id) : undefined
    const mine = dispatches?.find((x) => x.sessionId === sessionId)
    const run = task && s ? s.runs.find((r) => r.id === task.runId) : undefined
    const job = run && s ? s.jobs.find((j) => j.id === run.jobId) : undefined
    const info = await d.sessionInfo(sessionId).catch(() => null)
    const cwd = mine?.cwd ?? info?.cwd ?? null
    if (cwd === null) return null
    const unit = await d.unitOf(sessionId).catch(() => undefined)

    let diff: SummaryFile[] = []
    let commits: string[] = []
    if (mine?.git?.base !== undefined) {
      const head = mine.git.head ?? null
      diff = (await d.diffOf(cwd, mine.git.base, head).catch(() => null)) ?? []
      if (head !== null) commits = await d.commitsOf(cwd, mine.git.base, head).catch(() => [])
    } else if (!task) {
      diff = (await d.diffOf(cwd, unit?.startHead ?? 'HEAD', null).catch(() => null)) ?? []
    }
    if (diff.length === 0 && task?.filesModified) diff = task.filesModified.map((p) => ({ path: p }))
    // A plain session that wrote nothing has nothing to say.
    if (!task && diff.length === 0) return null

    const endedAt = mine?.endedAt ?? now()
    const base = summaryFactsOf({
      session: { id: sessionId, title: info?.title ?? sessionId },
      endedAt,
      ...(task ? { task } : {}),
      ...(dispatches ? { dispatches } : {}),
      activity: task ? d.activity() : [],
      ...(unit?.checks ? { unitChecks: unit.checks } : {}),
      diff,
      commits,
      ...(run?.pr?.url ? { pr: run.pr.url } : {})
    })
    const prompt = summaryPrompt({
      facts: base.facts,
      outcome: base.outcome,
      resultSummary: unit?.resultSummary ?? task?.result,
      tail: await d.tailOf(sessionId).catch(() => ''),
      lang: await d.lang?.().catch(() => undefined)
    })
    const agentSessionId = (await d.agentSessionOf?.(sessionId).catch(() => null)) ?? undefined
    const prose = await proseFor({ accountId: mine?.accountId ?? info?.accountId ?? null, cwd, job, prompt })
    return {
      sessionId,
      ...(agentSessionId ? { agentSessionId } : {}),
      ...(job ? { jobId: job.id } : {}),
      ...(task ? { taskId: task.id } : {}),
      at: endedAt,
      ...base,
      text: prose?.text ?? '',
      ...(prose?.model ? { model: prose.model } : {})
    }
  }

  /** Claim the session now (synchronously, so two triggers in one tick make one card), then queue the work. */
  const summarise = (sessionId: string, taskId?: string): void => {
    if (claimed.has(sessionId)) return
    claimed.add(sessionId)
    chain = chain.then(async () => {
      try {
        if (!(await d.enabled())) return
        const file = await load()
        if (file.summaries.some((x) => x.sessionId === sessionId)) return
        const card = await build(sessionId, taskId)
        // Nothing to say: released, so a later trigger (a plain session that writes afterwards) may try again.
        if (!card) return void claimed.delete(sessionId)
        const fresh = await load()
        await save({ version: 1, summaries: [...fresh.summaries.filter((x) => x.sessionId !== sessionId), card] })
      } catch (err) {
        d.log(`summaries: could not write the card of ${sessionId}: ${message(err)}`)
        claimed.delete(sessionId)
      }
    })
  }

  /** A session the plan owns (a worker, a coordinator, a planner) is not a plain session. */
  const planOwned = (sessionId: string): boolean => {
    const s = d.state()
    return (
      s !== null &&
      (s.dispatches.some((x) => x.sessionId === sessionId) ||
        s.runs.some((r) => r.coordinatorSessionId === sessionId) ||
        s.jobs.some((j) => j.plannerSessionIds?.includes(sessionId)))
    )
  }

  const plain = (sessionId: string): void => {
    if (!planOwned(sessionId)) summarise(sessionId)
  }

  return {
    committed: (prev, next) => {
      try {
        for (const { sessionId, taskId } of endedTabsOf(prev, next)) summarise(sessionId, taskId)
      } catch (err) {
        d.log(`summaries: could not tell which tabs ended: ${message(err)}`)
      }
    },
    sessionExited: (id) => {
      clearTimeout(idle.get(id))
      idle.delete(id)
      plain(id)
    },
    sessionBusy: (id, busy) => {
      clearTimeout(idle.get(id))
      idle.delete(id)
      if (busy) return
      const timer = setTimeout(() => {
        idle.delete(id)
        plain(id)
      }, d.idleMs ?? SUMMARY_IDLE_MS)
      timer.unref?.()
      idle.set(id, timer)
    },
    read: async (jobId) => {
      const { summaries } = await load()
      return summaries.filter((x) => jobId === undefined || x.jobId === jobId).sort((a, b) => b.at.localeCompare(a.at))
    },
    settled: async () => {
      await chain
    },
    dispose: () => {
      for (const t of idle.values()) clearTimeout(t)
      idle.clear()
    }
  }
}
