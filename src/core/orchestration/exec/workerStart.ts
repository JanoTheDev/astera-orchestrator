// The start path for orchestration workers and coordinators, shared by every process that spawns
// them. The app's registerIpc wiring is the only caller today; the Host will call these too (Task 9).
// Moving the bodies here is what keeps both spawners on the same chain rule, the same brief file and
// the same folder-trust preset, instead of two copies that drift. Each caller supplies what only it
// has (its state store, its account list, its session spawner, its log) through the context.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { OrchServerDeps } from '../command'
import type { OrchState } from '../state'
import type { Account, Provider } from '../../types'
import { descriptorOf, isAmbientDir, type ProviderDescriptor } from '../../providers/descriptor'
import { providerOf } from '../../providers/meta'
import { findClaudeTranscript } from '../../history/strategies/claude'
import { rollChainFor } from '../../accounts/dispatchAccount'
import { autoOrderOf, rankAccounts, type AutoAccountsGuard, type UnusableReason } from '../../accounts/autoAccountOrder'
import { isGhostAccountId } from '../../accounts/ghostId'
import type { UsageGuard } from '../usageGuard'
import { markCodexProjectTrusted } from '../../accounts/codexTrust'
import { CLAUDE_SETTINGS_FILE, claudeConfigFileFor, ensureClaudeTheme, markClaudeProjectTrusted } from '../../accounts/claudeTrust'
import { coordinatorLaunchPrompt } from '../handover'
import { startPlannerSession } from './plannerStart'
import { workerTabTitle } from './coordinatorRotate'
import type { OrchCoordinator } from './coordinator'
import type { WorkerTails } from './tail'
import { coordinatorBriefName } from './specFiles'
import { dispatchLookup } from '../dispatchIndex'
import { jobOf, jobOfRunId } from '../state'
import { projectOfJob } from '../projects'
import type { Job } from '../types'
import { handsOffOf } from './plannerFeedback'
import { pendingMerges, runRootOf } from '../integrate'
import {
  resolveReviewerModel,
  resolveCoordinatorModel,
  resolveRoleModel,
  resolveWorkerModel,
  resolveWorkerEffort,
  resolveRoleEffort,
  clampEffort,
  type RoleModelSettings
} from '../roleModels'

export type StartWorkerArgs = Parameters<OrchServerDeps['startWorker']>[0]
/** Plus the effort the session started on and why it differs from the ask, for dispatchModelFields. */
export type StartWorkerResult = Awaited<ReturnType<OrchServerDeps['startWorker']>> & { effort?: string; effortNote?: string }
export interface WorkerStartContext {
  getState(): OrchState
  accounts(): Promise<Account[]>
  loginStatus(accountId: string): Promise<boolean>
  coordinator: Pick<OrchCoordinator, 'startWorker'>
  tails: WorkerTails
  log(m: string): void
  /** app-settings.json's `roleModels` (W1-A). Required, so a wiring cannot silently start every worker
   *  on the CLI default; a read that throws is logged and treated as "not set" (built-in defaults). */
  roleModels(): Promise<RoleModelSettings>
  /** T2: the usage guard, for "Pick accounts automatically" (settings/autoAccounts.ts). Absent, or the setting off:
   *  the chain is the Task's own, as before. */
  usageGuard?: AutoStartGuard
  /** The effort levels `model` (undefined: the CLI default) accepts on that account, so a start can clamp to
   *  one it lists: `undefined` when the account's model list cannot tell, `[]` for a model that takes none.
   *  Absent: levels unknown. */
  effortLevels?(accountId: string, model: string | undefined): Promise<string[] | undefined>
}

/** T2: what a start asks of the usage guard for the automatic account order. */
export type AutoStartGuard = Pick<UsageGuard, 'refresh' | 'reserve' | 'switched'> & AutoAccountsGuard

/** Reads the settings for a start. A broken settings file is not a reason to refuse a worker: the
 *  permission read beside it already refuses on that (bypassFromSettings), and here the built-in
 *  defaults are a safe answer. */
async function settingsFor(ctx: { roleModels(): Promise<RoleModelSettings>; log(m: string): void }): Promise<RoleModelSettings> {
  try {
    return await ctx.roleModels()
  } catch (e) {
    ctx.log(`role models: settings unreadable, using the built-in defaults: ${String(e)}`)
    return {}
  }
}

/** The model this start runs on and why it differs from the ask (W1-A). A `--terminal` reuse types
 *  into a session already running, so it reports that session's model; a review Dispatch takes the
 *  reviewer's (kept off the implementer's model on a same-provider review); every other start, the
 *  worker's (Task.model > difficulty > Job > app > CLI default). */
async function modelForStart(
  ctx: WorkerStartContext,
  a: StartWorkerArgs,
  s: OrchState,
  settings: RoleModelSettings
): Promise<{ model?: string; note?: string }> {
  if (a.terminal) {
    const prev = s.dispatches.filter((d) => d.sessionId === a.terminal && d.id !== a.dispatchId).at(-1)
    return prev?.model ? { model: prev.model } : {}
  }
  const task = s.tasks.find((t) => t.id === a.taskId)
  const run = task?.runId ? s.runs.find((r) => r.id === task.runId) : undefined
  const job = run ? jobOf(s, run) : undefined
  if (s.dispatches.find((d) => d.id === a.dispatchId)?.review) {
    const impl = s.dispatches
      .filter((d) => d.taskId === a.taskId && !d.review)
      .sort((x, y) => x.startedAt.localeCompare(y.startedAt))
      .at(-1)
    if (impl) return resolveReviewerModel({ settings, job, provider: a.provider, impl })
    const model = resolveRoleModel(settings, job, 'reviewer', a.provider)
    return model ? { model } : {}
  }
  return resolveWorkerModel({ settings, job, task, provider: a.provider, accounts: await ctx.accounts() })
}

/** The levels `model` takes on that account; a context without the lookup, or one that throws, cannot tell. */
const levelsFor = (
  ctx: { effortLevels?(accountId: string, model: string | undefined): Promise<string[] | undefined> },
  accountId: string,
  model: string | undefined
): Promise<string[] | undefined> => ctx.effortLevels?.(accountId, model).catch(() => undefined) ?? Promise.resolve(undefined)

/** A resolved level clamped to what the model lists (clampEffort); undefined resolves to no flag and no note. */
export async function clampedEffort(
  ctx: { effortLevels?(accountId: string, model: string | undefined): Promise<string[] | undefined> },
  accountId: string,
  model: string | undefined,
  level: string | undefined,
  provider: Provider
): Promise<{ effort?: string; note?: string }> {
  return level ? clampEffort(level, await levelsFor(ctx, accountId, model), provider) : {}
}

/** The effort this start runs on and why it differs from the ask. A reviewer takes its role's; a worker, its Task's
 *  (resolveWorkerEffort) — a failed attempt has already raised Task.effort (state.ts, the repair ladder), so a start
 *  never raises on its own. A `--terminal` reuse cannot change the launch flag: it keeps the reused session's effort
 *  and says when the Task's wanted effort waits for the next fresh start. */
async function effortForStart(
  ctx: WorkerStartContext,
  a: StartWorkerArgs,
  s: OrchState,
  settings: RoleModelSettings,
  model: string | undefined
): Promise<{ effort?: string; note?: string }> {
  const self = s.dispatches.find((d) => d.id === a.dispatchId)
  if (self?.review) return clampedEffort(ctx, a.accountId, model, resolveRoleEffort(settings, 'reviewer', a.provider), a.provider)
  const task = s.tasks.find((t) => t.id === a.taskId)
  const resolved = resolveWorkerEffort({ settings, task, job: task?.runId ? jobOfRunId(s, task.runId) : undefined, provider: a.provider })
  if (a.terminal) {
    const prev = s.dispatches.filter((d) => d.sessionId === a.terminal && d.id !== a.dispatchId).at(-1)
    return {
      ...(prev?.effort ? { effort: prev.effort } : {}),
      ...(resolved && resolved !== prev?.effort
        ? { note: `effort stays ${prev?.effort ?? 'CLI default'}: the live session keeps its launch flag, ${resolved} applies at the next fresh start` }
        : {})
    }
  }
  return clampedEffort(ctx, a.accountId, model, resolved, a.provider)
}

/** The body of the app's old `startWorker` wrapper, unchanged: the rolling chain from Task.accountIds
 *  (rollChainFor), the two cases that skip the login lookup, the degraded-chain log lines, then the
 *  coordinator, then the tail.
 *
 *  **이 워커의 롤링 체인을 여기서 정한다 — 워커를 띄우는 길이 전부 이 함수로 모이기
 *  때문이다.** 자동 배치 루프도 orchHandleCommand('worker-start') 를 부르고, CLI 의
 *  worker-start 도 같은 핸들러이며(server.ts 의 deps.startWorker), 검토 Dispatch 도 이 함수를
 *  지난다. 체인을 그중 한 곳에서 넘기면 나머지 경로는 갈아탈 곳 없는 워커를 띄운다.
 *
 *  **The rule itself is rollChainFor**, a pure function with its own tests. What this function adds
 *  is what a pure function cannot hold: it reads the Task, asks the login status, swallows that
 *  lookup's exception, and logs why the chain degraded. */
export async function startWorkerWithChain(
  ctx: WorkerStartContext,
  a: StartWorkerArgs
): Promise<StartWorkerResult> {
  let rollAccountIds = [a.accountId]
  const stateHere = ctx.getState()
  const task = stateHere.tasks.find((t) => t.id === a.taskId)
  // T2: with "Pick accounts automatically" on, a Task without accounts gets a chain too (the provider's accounts by
  // usage). A guard that cannot be read leaves the setting as it last read.
  if (ctx.usageGuard) await ctx.usageGuard.refresh().catch((e) => ctx.log(`worker-start: could not read usage: ${String(e)}`))
  const auto = ctx.usageGuard?.autoAccounts() ?? false
  // The account list is read once, and only when the Task names accounts: both the provider lookup
  // and rollChainFor below need it, and a Task without accounts needs neither.
  const accountList = task?.accountIds?.length || auto ? await ctx.accounts() : []
  // Task 의 provider — **그 Task 의 첫 계정이 정한다**(Task.accountIds). 계정 목록 조회는
  // 메모리에서 끝나므로(비싼 것은 아래 loginStatus 다) 이 한 걸음에 비용이 없다. 첫 id 가
  // 목록에 없으면 undefined — 아래 조건이 그 경우를 "어긋났다고 말할 수 없다"로 다룬다.
  const taskProvider = task?.accountIds?.length
    ? (() => {
        const first = accountList.find((x) => x.id === task.accountIds![0])
        return first ? providerOf(first) : undefined
      })()
    : undefined
  // **두 경우에 로그인 조회를 하지 않는다.**
  // (1) 지정이 없을 때 — 답은 요청된 계정 하나로 확정이고(rollChainFor), 그 조회는 계정마다 파일
  //     읽기(macOS 의 claude 계정은 `security` 프로세스)를 붙인다. 워커를 띄우는 모든 자리가 이
  //     함수를 지나므로 그 값을 헛되이 물릴 이유가 없다(자동 배치 루프가 바퀴마다 한 번만
  //     조회하는 것과 같은 이유).
  // (2) **띄우는 provider 가 이 Task 의 provider 와 다를 때** — 검토 Dispatch 가 그 자리다.
  //     검토자는 구현자와 다른 provider 이므로 Task 의 계정은 rollChainFor 안에서 전부 걸러지고,
  //     남는 것은 조회 비용과 "쓸 수 있는 계정이 하나도 없다"는 어긋난 로그뿐이다 — 사실은 그
  //     계정들이 다른 provider 의 것일 뿐이고 사람이 할 일은 없다. 검토 경로는 이 앞에서 이미
  //     같은 조회를 한 번 했다(startReview). 첫 계정 id 가 목록에 없어 provider 를 알 수
  //     없으면 어긋났다고 말할 수 없으므로 건너뛰지 않는다.
  if (task && (task.accountIds?.length || auto) && (taskProvider === undefined || taskProvider === a.provider)) {
    try {
      const loggedInHere = new Set(
        (
          await Promise.all(
            accountList.map(async (x) => ((await ctx.loginStatus(x.id)) ? x.id : null))
          )
        ).filter((id): id is string => id !== null)
      )
      const picked = rollChainFor({
        requested: a.accountId,
        taskAccountIds: task.accountIds,
        provider: a.provider,
        accounts: accountList,
        loggedInIds: loggedInHere,
        ...(ctx.usageGuard && auto
          ? { auto: autoOrderOf(ctx.usageGuard, { provider: a.provider, accounts: accountList, loggedInIds: loggedInHere, nowMs: Date.now() })! }
          : {})
      })
      rollAccountIds = picked.chain
      // 저하한 두 갈래를 갈라 적는다 — 사람이 할 일이 다르다: 앞은 이 Task 의 계정을 아무것도
      // 못 쓴다는 뜻(로그인이 필요하다), 뒤는 하필 이 Dispatch 의 계정만 걸러졌다는 뜻이다.
      if (picked.degraded === 'nothing-usable')
        ctx.log(
          `worker-start: no usable account among ${[a.accountId, ...(task.accountIds ?? [])].join(',')} ` +
            `for ${a.provider} — rolling chain falls back to ${a.accountId} alone`
        )
      else if (picked.degraded === 'requested-unusable')
        ctx.log(
          `worker-start: the dispatch account ${a.accountId} is not usable, so the chain ` +
            `${(task.accountIds ?? []).join(',')} is dropped — falls back to ${a.accountId} alone`
        )
    } catch (e) {
      // 로그인 조회는 계정 파일과 Keychain 을 읽으므로 던질 수 있다. 그것이 워커를 못 띄우는
      // 이유가 되어서는 안 된다 — 체인 없이 띄우는 것은 이 목록이 생기기 전의 동작이다.
      ctx.log(
        `worker-start: could not read login status — rolling chain falls back to ` +
          `${a.accountId} alone: ${String(e)}`
      )
    }
  }
  const settings = await settingsFor(ctx)
  const chosen = await modelForStart(ctx, a, ctx.getState(), settings)
  if (chosen.note) ctx.log(`worker-start: dispatch ${a.dispatchId}: ${chosen.note}`)
  const effort = await effortForStart(ctx, a, ctx.getState(), settings, chosen.model)
  ctx.log(`worker-start: dispatch ${a.dispatchId} model=${chosen.model ?? 'CLI default'} effort=${effort.effort ?? 'CLI default'}${effort.note ? ` (${effort.note})` : ''}`)
  const fork = forkForDeps(ctx.getState(), a)
  const started = await ctx.coordinator.startWorker({
    ...a,
    // Coordinator rotation: the Task ref first, so no worker or reviewer tab reads as the coordinator's
    title: workerTabTitle(stateHere, a.taskId, a.title),
    rollAccountIds,
    ...(chosen.model ? { model: chosen.model } : {}),
    ...(effort.effort ? { effort: effort.effort } : {}),
    ...(fork ? { fork } : {}),
    // #117: a hands-off plan's workers run with permissions bypassed: nobody is there to answer a prompt
    ...(handsOffOfTask(stateHere, a.taskId) ? { bypassPermissions: true as const } : {})
  })
  // From this point on, that session's output belongs to this dispatch. On reuse (--terminal) the
  // previous dispatch's tail freezes where it is. Only a dispatch that has reached a terminal
  // state is eligible for eviction — a live worker's tail is not dropped even past the cap (see
  // tail.ts).
  const dispatchById = dispatchLookup(() => ctx.getState())
  ctx.tails.start(
    { dispatchId: a.dispatchId, sessionId: started.sessionId },
    (id) => {
      const d = dispatchById(id)
      return d === undefined || d.endedAt !== undefined || d.outcome !== undefined
    },
    // Asked for every output chunk: through the index, not a scan of every attempt (audit H6).
    (id) => dispatchById(id)?.endedAt !== undefined
  )
  return {
    ...started,
    ...(chosen.model ? { model: chosen.model } : {}),
    ...(chosen.note ? { modelNote: chosen.note } : {}),
    ...(effort.effort ? { effort: effort.effort } : {}),
    ...(effort.note ? { effortNote: effort.note } : {})
  }
}

/** W5-A (#50): a `--worktree new` worker forks from its Run's worktree (the plan branch), never from the
 *  project's checkout or a dependency's own branch, and gets its finished deps' worktrees merged in. A branch
 *  from anywhere else carries rebased duplicates of commits already on the plan branch, and conflicts when
 *  delivered. That holds for a Task without deps too (wave 1, a replan follow-up). The scheduler has merged the
 *  deps into the Run's worktree already (and may have reaped them); a coordinator places Tasks itself and
 *  nothing has, so the merge is what brings their commits. A Run without its own worktree, a reuse and a
 *  non-new placement: undefined, fork as before. */
export function forkForDeps(s: OrchState, a: StartWorkerArgs): { base: string; merge: string[] } | undefined {
  if (a.terminal || a.worktree !== 'new') return undefined
  const task = s.tasks.find((t) => t.id === a.taskId)
  const run = task ? s.runs.find((r) => r.id === task.runId) : undefined
  if (!task || !run || (task.deps.length === 0 && run.worktree === undefined)) return undefined
  return { base: runRootOf(run, jobOf(s, run)), merge: pendingMerges(s, task.id) }
}

/** #117: whether the Task's plan runs hands-off. */
const handsOffOfTask = (s: OrchState, taskId: string): boolean => {
  const task = s.tasks.find((t) => t.id === taskId)
  const run = task && s.runs.find((r) => r.id === task.runId)
  return handsOffOfJob(s, run && jobOf(s, run))
}
const handsOffOfJob = (s: OrchState, job: Job | undefined): boolean => job !== undefined && handsOffOf(s, job)

export type StartCoordinatorArgs = Parameters<NonNullable<OrchServerDeps['startCoordinator']>>[0]
export interface CoordinatorStartContext {
  specsDir: string
  preTrust(accountId: string, cwd: string): Promise<void>
  bypassPermissions(): Promise<boolean>
  spawn(o: {
    accountId: string
    cwd: string
    bypassPermissions: boolean
    initialPrompt: string
    title: string
    rollAccountIds: string[]
    /** The coordinator role's model (W1-A). Absent: the CLI's default. */
    model?: string
    /** The role's reasoning effort, clamped to the model's levels. Absent: the CLI's default. */
    effort?: string
    /** W7-A: a planner resumed in its own conversation (`StartCoordinatorArgs.resume`); T5: a coordinator too. */
    resumeSessionId?: string
  }): Promise<{ id: string }>
  log(m: string): void
  /** W1-A: what the coordinator role's model is resolved from — the Run's Job override, the app's
   *  `roleModels` setting, the account's provider. */
  getState(): OrchState
  accounts(): Promise<Account[]>
  roleModels(): Promise<RoleModelSettings>
  /** T2: the usage guard and the login check, for "Pick accounts automatically" (autoStartChain). Either absent, or
   *  the setting off: the session starts on the named account alone, as before. */
  usageGuard?: AutoStartGuard
  loginStatus?(accountId: string): Promise<boolean>
  /** The effort levels `model` (undefined: the CLI default) accepts on that account, so a start can clamp to
   *  one it lists: `undefined` when the account's model list cannot tell, `[]` for a model that takes none.
   *  Absent: levels unknown. */
  effortLevels?(accountId: string, model: string | undefined): Promise<string[] | undefined>
}

/** T5b: how long a start waits for the usage guard's read (its first one fetches every idle account) before it ranks
 *  on what the guard already holds. */
export const START_READ_WAIT_MS = 5_000

export type StartPurpose = 'planner' | 'coordinator' | 'worker' | 'reviewer' | 'session'

export type StartAccountChoice =
  /** `release` ends the start's place in the live count (UsageGuard.reserve): call it once the session runs or the
   *  start failed. `switched` says why the start left the account it named. */
  | { ok: true; accountId: string; chain: string[]; release(): void; switched?: string }
  | { ok: false; why: string }

/** T25: no account has room to start on. The message is the plain reason; a planner or coordinator start is held on it (startChainHolding). */
export class NoRoomError extends Error {}

const UNUSABLE_WHY: Record<UnusableReason, string> = {
  'weekly-full': 'its weekly limit is at the usage threshold',
  'session-full': 'its 5-hour limit is at the usage threshold',
  unknown: 'its usage is unknown',
  stale: 'its usage reading is old',
  'logged-out': 'it is not logged in',
  'at-cap': 'it is at its session cap'
}

/**
 * T5b (decision 6): the one account choice behind every start (planner, coordinator and its restart, worker, reviewer).
 * The guard is read again (bounded by START_READ_WAIT_MS), then rankAccounts over the provider's accounts with the live
 * sessions and the starts in flight (UsageGuard.liveSessions/reserve, so a burst spreads) and the per-account caps:
 * `preferred` if usable, else the first usable of `own` (a Task's chain), else the best usable. With none usable, an
 * account whose usage is unknown may still start (preferred first); a full, capped or logged-out one never does: the
 * answer is then `ok: false` with a plain reason, and the start waits. The choice counts from here (`release`).
 * "Pick accounts automatically" off, or no guard or login check wired: the named account alone, as before.
 */
export async function chooseStartAccount(
  ctx: Pick<CoordinatorStartContext, 'usageGuard' | 'loginStatus' | 'accounts' | 'log'>,
  a: { preferred?: string; provider?: Provider; purpose: StartPurpose; own?: readonly string[]; nowMs?: number }
): Promise<StartAccountChoice> {
  const noop = (): void => {}
  const alone = async (): Promise<StartAccountChoice> => {
    const id = a.preferred ?? (await ctx.accounts()).find((x) => a.provider === undefined || providerOf(x) === a.provider)?.id
    return id === undefined
      ? { ok: false, why: `no ${a.provider ? `${a.provider} ` : ''}account to start the ${a.purpose} on` }
      : { ok: true, accountId: id, chain: [id], release: noop }
  }
  const guard = ctx.usageGuard
  const loginStatus = ctx.loginStatus
  if (!guard || !loginStatus) return alone()
  try {
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = await Promise.race([
      guard.refresh().then(
        () => 'read' as const,
        (e) => (ctx.log(`${a.purpose} start: could not read usage: ${String(e)}`), 'failed' as const)
      ),
      new Promise<'late'>((r) => (timer = setTimeout(() => r('late'), START_READ_WAIT_MS)))
    ]).finally(() => clearTimeout(timer))
    if (!guard.autoAccounts()) return alone()
    if (read !== 'read' && guard.view().length === 0)
      ctx.log(`${a.purpose} start: no usage reading yet (${read === 'late' ? 'the read is still running' : 'the read failed'}); ranking without one`)
    const accounts = await ctx.accounts()
    const named = a.preferred === undefined ? undefined : accounts.find((x) => x.id === a.preferred)
    const provider = a.provider ?? (named ? providerOf(named) : 'claude')
    const mine = accounts.filter((x) => providerOf(x) === provider && !isGhostAccountId(x.id))
    const loggedInIds = new Set(
      (await Promise.all(mine.map(async (x) => ((await loginStatus(x.id)) ? x.id : null)))).filter((id): id is string => id !== null)
    )
    const readings = new Map(guard.view().map((v) => [v.accountId, { session: v.session, weekly: v.weekly, ...(v.at === undefined ? {} : { at: v.at }) }]))
    const ranked = rankAccounts({
      accounts: mine,
      readings,
      threshold: guard.pauseAt(),
      nowMs: a.nowMs ?? Date.now(),
      loggedInIds,
      ...(guard.liveSessions ? { liveSessions: guard.liveSessions() } : {}),
      ...(guard.maxSessions ? { maxSessions: guard.maxSessions() } : {})
    })
    const usable = ranked.usable.map((x) => x.id)
    const tryable = ranked.unusable.filter((x) => x.reason === 'unknown' || x.reason === 'stale').map((x) => x.account.id)
    const firstOf = (ids: readonly string[]): string | undefined =>
      a.preferred !== undefined && ids.includes(a.preferred) ? a.preferred : ((a.own ?? []).find((id) => ids.includes(id)) ?? ids[0])
    // T25: with no fresh reading, an account whose last known reading was not full (weekly first, then 5h) goes before
    // one nothing is known of, the named one included; a full one never gets here (rankAccounts)
    const lastKnown = (id: string): [number, number] | null => {
      const r = readings.get(id)
      return r && (r.weekly || r.session) ? [r.weekly?.usedPercent ?? 0, r.session?.usedPercent ?? 0] : null
    }
    const known = tryable.filter((id) => lastKnown(id)).sort((x, y) => lastKnown(x)![0] - lastKnown(y)![0] || lastKnown(x)![1] - lastKnown(y)![1])
    const start = firstOf(usable) ?? known[0] ?? firstOf(tryable)
    if (start === undefined) {
      const why = ranked.unusable.map((x) => `${x.account.id} (${UNUSABLE_WHY[x.reason]})`).join(', ')
      const resets = ranked.unusable.flatMap((x) => {
        const v = x.reason === 'weekly-full' || x.reason === 'session-full' ? guard.view().find((y) => y.accountId === x.account.id) : undefined
        const at = Date.parse((x.reason === 'weekly-full' ? v?.weekly : v?.session)?.resetsAt ?? '')
        return Number.isFinite(at) ? [at] : []
      })
      const earliest = resets.length > 0 ? `; the earliest limit resets ${new Date(Math.min(...resets)).toISOString()}` : ''
      return {
        ok: false,
        why: why ? `no ${provider} account has room to start the ${a.purpose} on: ${why}${earliest}` : `no ${provider} account to start the ${a.purpose} on`
      }
    }
    // The rolling chain: the rest of the ranking, less what can never take over (logged out, at its cap)
    const rest = ranked.unusable.filter((x) => x.reason !== 'logged-out' && x.reason !== 'at-cap').map((x) => x.account.id)
    const chain = [...new Set([start, ...usable, ...rest])]
    const release = guard.reserve?.(start) ?? noop
    if (a.preferred === undefined || start === a.preferred) return { ok: true, accountId: start, chain, release }
    const unusable = ranked.unusable.find((x) => x.account.id === a.preferred)
    const switched = unusable ? UNUSABLE_WHY[unusable.reason] : named ? 'another account has more room' : 'it is not a registered account'
    ctx.log(`${a.purpose} start: ${a.preferred}: ${switched}, starting on ${start}`)
    guard.switched?.({ from: a.preferred, to: start, reason: switched })
    return { ok: true, accountId: start, chain, release, switched }
  } catch (e) {
    ctx.log(`automatic accounts: could not read usage or logins, starting on ${a.preferred ?? 'the first account'} alone: ${String(e)}`)
    return alone()
  }
}

/**
 * T2/T5b: the account a coordinator or planner (or a Host session) starts on, and its rolling chain: chooseStartAccount
 * with the named account as the preference (`auto`: no preference, the account only says the provider). Throws the
 * plain reason when no account has room: the session must not start on a full one.
 */
export async function autoStartChain(
  ctx: Pick<CoordinatorStartContext, 'usageGuard' | 'loginStatus' | 'accounts' | 'log'>,
  accountId: string,
  o: { purpose?: StartPurpose; auto?: boolean } = {}
): Promise<{ accountId: string; chain: string[]; release(): void }> {
  const named = (await ctx.accounts()).find((x) => x.id === accountId)
  const choice = await chooseStartAccount(ctx, {
    ...(o.auto ? {} : { preferred: accountId }),
    ...(named ? { provider: providerOf(named) } : {}),
    purpose: o.purpose ?? 'coordinator'
  })
  if (!choice.ok) throw new NoRoomError(choice.why)
  return choice
}

/**
 * T1: the account a plain session (New Session, Resume, Restart, Reopen, `sessions create`) starts on, and the chain it
 * rolls on: chooseStartAccount. No account named is auto: the best ranked account of `provider` (claude by default),
 * rolling over the whole ranking. A named account is a preference: with room it keeps its own chain as given (none: no
 * rolling); full, logged out or gone, the session starts on the first of its chain with room, else the best ranked, and
 * that chain follows the start. "Pick accounts automatically" off: the named account and chain as given (none named: the
 * provider's first account, not rolling). Throws NoRoomError when nothing has room. `release` once the session runs.
 */
export async function chooseSessionStart(
  ctx: Pick<CoordinatorStartContext, 'usageGuard' | 'loginStatus' | 'accounts' | 'log'>,
  a: { accountId?: string; provider?: Provider; rollAccountIds?: readonly string[] }
): Promise<{ accountId: string; rollAccountIds: string[]; release(): void }> {
  const own = a.rollAccountIds ?? []
  // Setting off as of the guard's last read: the start as asked, with no usage read in its way
  if (a.accountId && ctx.usageGuard?.autoAccounts() === false) return { accountId: a.accountId, rollAccountIds: [...own], release: () => {} }
  const choice = await chooseStartAccount(ctx, {
    ...(a.accountId ? { preferred: a.accountId } : {}),
    ...(a.provider ? { provider: a.provider } : {}),
    purpose: 'session',
    own
  })
  if (!choice.ok) throw new NoRoomError(choice.why)
  // chooseStartAccount's chain is the ranking only while the setting is on (else the start alone)
  const ranked = ctx.usageGuard?.autoAccounts() === true && ctx.loginStatus !== undefined
  const rollAccountIds = !a.accountId
    ? ranked ? choice.chain : []
    : choice.accountId === a.accountId || own.length === 0 ? [...own] : [...new Set([choice.accountId, ...own])]
  return { accountId: choice.accountId, rollAccountIds, release: choice.release }
}

/**
 * T1: chooseSessionStart for a session that may resume a conversation (`resumeId`). A claude resume moved off its
 * named account with no transcript path from the caller (a chat's Restart or Reopen names only its thread) gets the
 * original account's transcript as `transcriptPath`, so the spawn copies it to the new account as for any other.
 * A codex resume with no rollout path stays on its account: its rollout is found by its path, which a thread id alone
 * does not give (host/sessionRestore.ts carryTranscript).
 */
export async function chooseResumeStart(
  ctx: Pick<CoordinatorStartContext, 'usageGuard' | 'loginStatus' | 'accounts' | 'log'>,
  a: { accountId?: string; provider?: Provider; rollAccountIds?: readonly string[]; resumeId?: string; transcriptPath?: string },
  find: (configDir: string, id: string) => Promise<string | null> = findClaudeTranscript
): Promise<{ accountId: string; rollAccountIds: string[]; release(): void; transcriptPath?: string }> {
  const { resumeId, transcriptPath, ...ask } = a
  const named = resumeId && !transcriptPath && a.accountId ? (await ctx.accounts()).find((x) => x.id === a.accountId) : undefined
  if (named && providerOf(named) !== 'claude') return { accountId: named.id, rollAccountIds: [...(a.rollAccountIds ?? [])], release: () => {} }
  const start = await chooseSessionStart(ctx, ask)
  if (!named || !resumeId || start.accountId === named.id) return start
  const found = await find(named.configDir, resumeId).catch(() => null)
  return found ? { ...start, transcriptPath: found } : start
}

/**
 * T25: autoStartChain for a planner or coordinator start (`subject` is its Job or Run). With no account that has room the
 * start does not hold the command that asked for it: `onWait` gets the plain reason (the command records it on the Job and
 * answers at once) and the start fails with NoRoomError; the dispatch loop asks again every tick (retryHeldStarts), and each
 * try reads the usage guard again (chooseStartAccount). `onWait(null)` once an account has room or the start fails otherwise.
 * Host sessions (host/spawner.ts) call autoStartChain and still fail at once.
 */
export async function startChainHolding(
  ctx: CoordinatorStartContext,
  accountId: string,
  o: { purpose: StartPurpose; auto?: boolean; subject: string; onWait?(why: string | null): void | Promise<void> }
): ReturnType<typeof autoStartChain> {
  try {
    const chain = await autoStartChain(ctx, accountId, o)
    await o.onWait?.(null)
    return chain
  } catch (e) {
    if (e instanceof NoRoomError) {
      ctx.log(`${o.purpose} start ${o.subject} waits: ${e.message}`)
      await o.onWait?.(e.message)
    } else await o.onWait?.(null)
    throw e
  }
}

/** 이 Run 을 관리할 코디네이터 세션을 띄운다. **워커가 아니다** — Dispatch 도 spec 파일도
 *  워크트리도 없다. 사람이 여는 세션과 같은 모양이고, 다른 것은 첫 입력이 인수 프롬프트라는
 *  것뿐이다(core/orchestration/handover.ts).
 *
 *  **롤링 체인을 그대로 넘긴다** — 코디네이터도 에이전트라 한도에 걸린다. 워커에게 이 값을
 *  넘기는 것과 같은 이유이고 같은 기계를 탄다(rollAccountIds 의 JSDoc).
 *
 *  **`bypassPermissions` 는 전역 설정이 정한다(AgentPermissionMode)** — this function reads nothing
 *  itself; each caller's `ctx.bypassPermissions` reads the same setting its worker spawns use. 한동안 이 자리는 그것을 넘기지 않았고, 그 선택은 "멈추는 쪽이
 *  허가 없는 실행에 대해 안전하다" 는 것이었다. 뒤집은 근거는 안전이 덜 중요해져서가 아니라
 *  **멈춤이 실제로는 안전이 아니라 정지였기 때문이다**: 코디네이터는 워크트리가 아니라 프로젝트
 *  루트에서 뜨지만 그가 띄우는 워커는 매번 새 워크트리에서 뜨고, 사람이 그 프로젝트에 쌓아 둔
 *  허용 목록은 거기 따라오지 않는다. 그래서 manual 인 Job 은 자율로 돌라고 띄운 세션이 첫
 *  명령에서 서고, 사람은 탭마다 승인하러 다니게 된다 — 사용자가 보고한 그대로다.
 *
 *  The tab is the caller's business: `spawn` is the caller's adapter, and the app's emits
 *  `session:created` there (registerIpc's startCoordinator). */
export async function startCoordinatorSession(
  ctx: CoordinatorStartContext,
  a: StartCoordinatorArgs
): Promise<{ sessionId: string; accountId?: string; model?: string }> {
  // W2-A: a planner takes this same spawn path with its own brief, model role and permissions.
  if (a.role === 'planner') return startPlannerSession(ctx, a)
  // **브리핑은 파일로, 세션에는 한 줄만.** 이 프롬프트는 argv 로 가고 win32 에서 세션은
  // `cmd.exe /c` 로 뜨므로 줄바꿈이 명령을 끊는다 — 워커의 spec 파일과 탭 재개 브리핑이
  // 같은 제약 때문에 같은 모양으로 갈렸다(coordinatorLaunchPrompt 의 주석).
  //
  // **specsDir 에 쓴다.** 그 경로에 argv 금지 문자가 있으면 앱 시작 시 경고가 남는 자리가
  // 이미 그것이고(bootOrch 의 LAUNCH_FORBIDDEN 검사), 시작 시 비워지는 것도 무해하다: 앱을 다시
  // 켜면 코디네이터도 없으므로 사람이 실행을 다시 누른다.
  //
  // **The last clause stopped being true when the Host started keeping terminals alive**, and
  // the boot no longer relies on it: a coordinator session the Host hands back is still running
  // with this path in its launch prompt, so the boot sweep keeps this file while
  // `Run.coordinatorSessionId` names a session that survived. That is `staleSpecFiles`, which
  // recognises this file by `coordinatorBriefName` — the same function that names it here, so
  // the two cannot drift.
  const briefPath = path.join(ctx.specsDir, coordinatorBriefName(a.runId))
  await fs.writeFile(briefPath, a.brief, 'utf8')
  // T2: the account and chain by usage when "Pick accounts automatically" is on (autoStartChain)
  // T5b: the named account is a preference (chooseStartAccount); `release` once the session runs
  const { accountId, chain, release } = await startChainHolding(ctx, a.accountId, {
    purpose: 'coordinator',
    subject: a.runId,
    ...(a.onWait ? { onWait: a.onWait } : {}),
    ...(a.auto ? { auto: true } : {})
  })
  try {
    // 코디네이터는 프로젝트 루트에서 뜨므로 대개 이미 신뢰돼 있다 — 그래도 부른다. 그 Run 을
    // 처음 돌리는 사람에게는 여기가 첫 codex 세션이고, 멈추면 아무도 답할 사람이 없는 것은
    // 워커와 같다(preTrustWorkspace 의 주석).
    await ctx.preTrust(accountId, a.cwd)
    // The lightweight model (W1-A, SPEC §4), unless the plan is big or hard (T5 `resolveCoordinatorModel`). The plan's
    // Tasks are this Run's, else its Job's definition Tasks: a first start comes before the Run's copies are committed.
    const coordinatorAccount = (await ctx.accounts()).find((x) => x.id === accountId)
    const s = ctx.getState()
    const job = jobOfRunId(s, a.runId)
    const runTasks = s.tasks.filter((t) => t.runId === a.runId)
    const settings = await settingsFor(ctx)
    const model = coordinatorAccount
      ? resolveCoordinatorModel({
          settings,
          job,
          project: job && projectOfJob(s, job),
          tasks: runTasks.length > 0 ? runTasks : s.tasks.filter((t) => job !== undefined && t.jobId === job.id),
          provider: providerOf(coordinatorAccount)
        })
      : undefined
    const effort = coordinatorAccount
      ? await clampedEffort(ctx, accountId, model, resolveRoleEffort(settings, 'coordinator', providerOf(coordinatorAccount)), providerOf(coordinatorAccount))
      : {}
    // **워커와 같은 래퍼를 쓴다**(the caller's worker spawnSession) — 그 래퍼가 계정 객체를 찾고,
    // 롤링 코디네이터에 등록하고, orchEnv 를 실어 준다. core.sessions.spawn 을 직접 부르면 그 셋을
    // 여기서 다시 하게 되고, 그중 하나를 빠뜨리면 코디네이터는 한도에 걸린 채 멈춰 선다.
    const info = await ctx.spawn({
      accountId: accountId,
      cwd: a.cwd,
      // #117: a hands-off plan's coordinator too: a permission prompt nobody answers would stall the whole plan
      bypassPermissions: handsOffOfJob(s, job) || (await ctx.bypassPermissions()),
      initialPrompt: coordinatorLaunchPrompt(briefPath.replace(/\\/g, '/')),
      // 탭 제목 — 워커 탭이 Task 제목을 쓰는 것과 같은 이유다. 없으면 워크트리 basename 으로
      // 떠서 사용자가 이것이 무엇인지 알 수 없다.
      title: `Coordinator · ${a.runId.slice(0, 12)}`,
      // **한 원소다.** 그래서 롤링은 계정을 갈아타지 않고 리셋까지 기다린 뒤 같은 세션에서
      // 이어간다 — 관리 중이던 Run 의 맥락을 잃지 않는 쪽을 골랐다(Run.coordinatorAccountId).
      // T2: unless "Pick accounts automatically" is on (the owner's choice): then the whole order, so a limit rolls the
      // same session on to another account (rolling carries the conversation over) instead of waiting.
      rollAccountIds: chain,
      ...(model ? { model } : {}),
      ...(effort.effort ? { effort: effort.effort } : {}),
      // T5: a coordinator resumed in its own conversation after a crash (crashResume.ts)
      ...(a.resume ? { resumeSessionId: a.resume } : {})
    })
    ctx.log(`coordinator started run=${a.runId} session=${info.id} account=${accountId} model=${model ?? 'CLI default'} effort=${effort.effort ?? 'CLI default'}${effort.note ? ` (${effort.note})` : ''}`)
    return { sessionId: info.id, accountId, ...(model ? { model } : {}) }
  } finally {
    release()
  }
}

/** Best-effort folder trust for an orchestration spawn (the app's reasoning, moved with it).
 *
 *  Marks the folder behind `cwd` trusted for this account before a session is spawned into it,
 *  so an agent nobody is sitting in front of does not stop at the CLI's "do you trust this
 *  folder?" menu.
 *
 *  **Only the orchestration path calls this**, not the shared `spawnSession` every tab goes
 *  through. The justification is exactly that nobody is there: a worker starts in a worktree made
 *  seconds earlier, which no person has ever approved, and the menu is a wall it cannot get past
 *  on its own — measured, three workers in a row. A person opening a tab is present to answer, and
 *  pre-approving a folder on their behalf would take away a decision they still have.
 *
 *  **Both providers need it.** This used to be codex-only, on the stated grounds that
 *  `--dangerously-skip-permissions` covers claude's trust prompt too. Measured 2026-09-22: it does
 *  not. A Job worker went into a fresh worktree with that flag on its own command line and stopped
 *  at `Yes, I trust this folder`; `~/.claude.json` held 47 project entries and none under the
 *  worktree root, so no claude worker had ever got past it. The flag sets the permission policy,
 *  and trust is a different question — which is what codex's own note said about its bypass flag
 *  all along. Orca's preset module has no claude entry either, and that is the same mistake.
 *
 *  Best-effort for both: a config this cannot write is a menu the agent will meet, not a reason to
 *  refuse to start it. The same convention as the other incidental failures around here. */
export async function preTrustWorkspace(a: {
  account: Account | undefined
  cwd: string
  homeDir: string
  descriptors: Record<Provider, ProviderDescriptor>
  log(m: string): void
}): Promise<void> {
  const account = a.account
  if (!account) return
  try {
    if (providerOf(account) === 'codex') {
      await markCodexProjectTrusted(account.configDir, a.cwd)
      return
    }
    await markClaudeProjectTrusted(
      claudeConfigFileFor({
        configDir: account.configDir,
        homeDir: a.homeDir,
        ambient: isAmbientDir(descriptorOf(a.descriptors, account), a.homeDir, account.configDir)
      }),
      a.cwd
    )
  } catch (e) {
    a.log(`trust preset failed account=${account.id} cwd=${a.cwd}: ${String(e)}`)
  }
  // The theme onboarding would have asked for, now that the trust preset marks onboarding done: in
  // settings.json under the config dir, for the ambient account too (its <home>/.claude). Apart from
  // the trust write, so a settings file this cannot write costs a light theme, not a trust menu.
  if (providerOf(account) === 'codex') return
  try {
    await ensureClaudeTheme(path.join(account.configDir, CLAUDE_SETTINGS_FILE))
  } catch (e) {
    a.log(`theme preset failed account=${account.id}: ${String(e)}`)
  }
}
