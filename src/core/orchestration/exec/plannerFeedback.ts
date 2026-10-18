// W7-A talk to the planner (SPEC §2): the owner's feedback on a plan, its rejection, and auto-approve, as commands
// (`jobs-feedback`, `jobs-reject`, `jobs-feedback-done`, `jobs-auto-start`, and a planner's `task-cancel` of its plan).
//
// **Before approval the feedback goes to the planner session itself**: typed into it while it lives, so it keeps
// everything it read; else its own conversation is resumed (`claude --resume`, `agentSessionOf`); else a fresh planner
// gets the plan, `existing.md` and the whole feedback history. The planner revises with `task-update` / `task-create` /
// `task-cancel`, reports one line per change (`jobs-feedback-done`) and ends its turn, which makes the plan ready again
// (host/activity.ts `planReadyActivity`, once per feedback round). **While the plan runs** the feedback starts a W6-D
// replan at once (`jobs-replan --feedback`), with W6-D's rules: only Tasks that have not started change.
import type { OrchServerDeps } from '../command'
import { projectOfJob } from '../delivery'
import { buildPlannerBrief } from '../handover'
import { archiveJob, isJobActive } from '../lifecycle'
import { cancelPlanTask, plannerJobOf, validatePlan } from '../planner'
import { replanJobOf } from '../replan'
import { outcomeOfTasks } from '../running'
import type { OrchState } from '../state'
import { DEFAULT_CONCURRENCY, type Job, type PlanFeedback } from '../types'
import { replanCommand } from './replanStart'

type Reply = { status: number; body: unknown }
type Caller = { sessionId: string; role?: 'app' | 'cli' | 'mcp' | 'controller' | 'plugin' }
type Handle = (deps: OrchServerDeps, caller: Caller, cmd: string, args: Record<string, unknown>) => Promise<Reply>

export const FEEDBACK_COMMANDS: ReadonlySet<string> = new Set(['jobs-feedback', 'jobs-reject', 'jobs-feedback-done', 'jobs-auto-start'])
/** The longest feedback or reason kept. */
export const FEEDBACK_TEXT_MAX = 4000
/** At most this many change lines per feedback round, each at most CHANGE_LINE_MAX characters. */
export const CHANGES_MAX = 30
export const CHANGE_LINE_MAX = 200

const ok = (body: unknown): Reply => ({ status: 200, body })
const bad = (error: string): Reply => ({ status: 400, body: { error } })
const denied = (error: string): Reply => ({ status: 403, body: { error } })
const notFound = (error: string): Reply => ({ status: 404, body: { error } })
const conflict = (error: string): Reply => ({ status: 409, body: { error } })
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)

/** Whether a plan starts on its own once it holds: the Job's own setting, else its project's, else no. */
export const autoApproveOf = (s: OrchState, job: Job): boolean => job.autoApprove ?? projectOfJob(s, job)?.autoApprove ?? false

/** A plan waiting for its approval (W2-A): not started, and planned. */
const awaitsApproval = (job: Job): boolean => job.pendingStart === true && job.plannerSessionIds !== undefined

const oneLine = (t: string): string => t.replace(/\s+/g, ' ').trim()

/** What to do with the feedback, said to the planner; the same words whichever way it reaches it. */
const howToRevise = (jobId: string): string =>
  `Revise the plan for it: change Tasks with \`astera task-update --id <taskId>\`, add with \`astera task-create --run ${jobId}\`, ` +
  `remove with \`astera task-cancel --id <taskId> --reason "<why>"\`. A Task you add carries what the first plan's Tasks carry: ` +
  `\`--prompt -\`, \`--criteria\`, \`--affected-paths\`, and \`--basis missing|partial|broken\` with its \`--evidence "<file:line, #issue, PR or Job id>"\`; ` +
  `\`astera tasks-list --job ${jobId}\` must show no Task without a basis. Then run \`astera jobs-feedback-done --id ${jobId} --changes '["<one short line per change>"]'\` ` +
  `(an empty list when nothing needed to change) and end your turn. Do not start any work.`

/** The line typed into a live planner: one line, since a terminal's Enter would cut a longer one. */
export const feedbackLine = (jobId: string, text: string): string => `Owner feedback on the plan: «${oneLine(text)}». ${howToRevise(jobId)}`

/** The brief for a resumed planner: its own conversation goes on, so the feedback is all it needs. */
export const resumeBrief = (jobId: string, text: string): string =>
  ['Owner feedback on the plan', '', text.trim(), '', howToRevise(jobId)].join('\n')

/** The brief for a fresh planner, when the old conversation cannot be resumed: the planner's own brief, where the plan
 *  so far is, and every feedback round with what was changed for it. */
export function freshFeedbackBrief(job: Job, accountId: string, history: readonly PlanFeedback[]): string {
  return [
    buildPlannerBrief({ jobId: job.id, objective: job.objective, repoRoot: job.cwd, accountId, concurrency: job.concurrency ?? DEFAULT_CONCURRENCY }),
    '',
    'THE PLAN SO FAR',
    `This Job has a plan already, written by an earlier planner session. Read it before you change anything:`,
    `- \`astera tasks-list --job ${job.id}\`, and \`$ASTERA_PROFILE_DIR/plans/${job.id}/plan.md\``,
    `- \`$ASTERA_PROFILE_DIR/plans/${job.id}/inputs/existing.md\`, when it is there: what is already built`,
    'Keep what the owner did not object to.',
    '',
    'OWNER FEEDBACK ON THE PLAN (oldest first; the last one is new)',
    ...history.flatMap((f, i) => [
      `${i + 1}. ${oneLine(f.text)}`,
      ...(f.changes ? [`   changed then: ${f.changes.length ? f.changes.join('; ') : 'nothing'}`] : [])
    ]),
    '',
    howToRevise(job.id)
  ].join('\n')
}

/** The Job's newest round still waiting for the planner's change lines, by its index. */
const openRound = (job: Job, phase: PlanFeedback['phase']): number => {
  const all = job.feedback ?? []
  for (let i = all.length - 1; i >= 0; i--) if (all[i].phase === phase) return all[i].changes === undefined ? i : -1
  return -1
}

/** The feedback commands. `fromAgent`: the caller is an agent session (not the app, the Host, a shell). `handle` is
 *  handleCommand, for the start `jobs-auto-start` makes (`run-start`). */
export async function feedbackCommand(deps: OrchServerDeps, caller: Caller, cmd: string, args: Record<string, unknown>, fromAgent: boolean, handle: Handle): Promise<Reply> {
  const now = deps.now?.() ?? new Date().toISOString()
  const s = deps.getState()
  const byPerson = !fromAgent && caller.role !== 'mcp'
  const setJob = async (jobId: string, f: (j: Job) => Job): Promise<void> => {
    const cur = deps.getState()
    await deps.setState({ ...cur, jobs: cur.jobs.map((x) => (x.id === jobId ? f(x) : x)) })
  }

  if (cmd === 'task-cancel') {
    // Only a planner's cancel of a Task of its plan comes here; plannerRefusal has checked the Task is its own.
    const id = str(args.id)
    if (!id) return bad('--id is required')
    if (!str(args.reason)) return bad('--reason is required: why this Task is no longer needed')
    const r = cancelPlanTask(s, id)
    if (!r.ok) return r.missing ? notFound(r.error) : bad(r.error)
    await deps.setState(r.state)
    return ok({ id, cancelled: true })
  }

  const jobId = str(args.id) ?? str(args.job)
  if (!jobId) return bad(cmd === 'jobs-feedback-done' ? '--id is required: the Job' : '--job is required: the Job')
  const job = s.jobs.find((j) => j.id === jobId)
  if (!job) return notFound(`unknown job: ${jobId}`)

  if (cmd === 'jobs-feedback-done') {
    if (fromAgent && plannerJobOf(s, caller.sessionId)?.id !== jobId) return denied("jobs-feedback-done is for the Job's planner")
    const raw = args.changes ?? []
    if (!Array.isArray(raw) || !raw.every((c) => typeof c === 'string')) return bad('--changes must be a JSON array of strings')
    const changes = raw.map((c) => oneLine(c as string).slice(0, CHANGE_LINE_MAX)).filter((c) => c !== '')
    if (changes.length > CHANGES_MAX) return bad(`at most ${CHANGES_MAX} change lines`)
    const i = openRound(job, 'plan')
    if (i < 0) return conflict(`job ${jobId} has no owner feedback waiting for its changes`)
    await setJob(jobId, (j) => ({ ...j, feedback: (j.feedback ?? []).map((f, k) => (k === i ? { ...f, changes } : f)) }))
    return ok({ jobId, changes })
  }

  // The rest is the owner's: in Astera, the command bar, or their own shell. Never an agent's.
  if (!byPerson) return denied(`${cmd} is for the person, in Astera or at their own shell`)

  if (cmd === 'jobs-reject') {
    if (!awaitsApproval(job)) return conflict(`job ${jobId} is not a plan waiting for approval: stop or archive it instead`)
    const reason = str(args.reason)
    if (reason && reason.length > FEEDBACK_TEXT_MAX) return bad(`--reason is at most ${FEEDBACK_TEXT_MAX} characters`)
    const archived = archiveJob(s, jobId, now)
    if (!archived.ok) return notFound(archived.error)
    const rejected = { at: now, ...(reason ? { reason } : {}) }
    await deps.setState({ ...archived.state, jobs: archived.state.jobs.map((j) => (j.id === jobId ? { ...j, rejected } : j)) })
    // Its planner has nothing left to do (#47): no tab stays open
    for (const sid of job.plannerSessionIds ?? [])
      await deps.stopCoordinator?.(sid, 'its plan was rejected').catch((e) => deps.log?.(`planner ${sid} could not be stopped: ${String(e)}`))
    return ok({ id: jobId, rejected })
  }

  if (cmd === 'jobs-auto-start') {
    if (!awaitsApproval(job) || !isJobActive(job)) return conflict(`job ${jobId} is not a plan waiting for approval`)
    if (!autoApproveOf(s, job)) return conflict(`job ${jobId} is not set to auto-approve`)
    const problems = validatePlan(s, jobId)
    if (problems.length) return { status: 400, body: { error: `the plan does not hold: ${problems.join('; ')}`, problems } }
    const tasks = s.tasks.filter((t) => t.jobId === jobId && t.runId === undefined).length
    const reply = await handle(deps, caller, 'run-start', { run: jobId })
    if (reply.status >= 300) return reply
    await setJob(jobId, (j) => ({ ...j, autoStartedAt: now }))
    return ok({ jobId, tasks })
  }

  // jobs-feedback
  const text = str(args.text)
  if (!text) return bad('--text is required: what the planner should change')
  if (text.length > FEEDBACK_TEXT_MAX) return bad(`--text is at most ${FEEDBACK_TEXT_MAX} characters`)
  if (!isJobActive(job)) return conflict(`job ${jobId} is archived: unarchive it first`)
  const entry = (phase: PlanFeedback['phase']): PlanFeedback => ({ at: now, text, phase })
  const record = (f: PlanFeedback): Promise<void> => setJob(jobId, (j) => ({ ...j, feedback: [...(j.feedback ?? []), f] }))

  if (!awaitsApproval(job)) {
    if (job.plannerSessionIds === undefined) return conflict(`job ${jobId} was not planned: there is no planner to talk to`)
    const run = s.runs.filter((r) => r.jobId === jobId).at(-1)
    if (!run || outcomeOfTasks(s.tasks.filter((t) => t.runId === run.id)) !== 'running')
      return conflict(`job ${jobId} is not running: there is nothing left to replan`)
    // W6-D's replan, started now instead of at the wave boundary; it holds the plan while it runs
    const reply = await replanCommand(deps, caller, 'jobs-replan', { id: jobId, run: run.id, feedback: text, feedbackAt: now }, false)
    if (reply.status < 300) await record(entry('run'))
    return reply
  }

  const accountId = job.coordinatorAccountId
  const last = job.plannerSessionIds?.at(-1)
  // 1. Typed into the planner while it lives: the same conversation, nothing to start
  const live = last && deps.listSessions && deps.sendSession ? (await deps.listSessions()).find((x) => x.id === last && x.alive && x.kind === 'terminal') : undefined
  if (live && last) {
    const turn = await deps.sessionTurn?.(last)
    if (turn?.state === 'waiting' && turn.prompt !== null)
      return conflict(`the planner waits on ${turn.prompt === 'permission' ? 'a permission prompt' : 'a question'}: answer it in its tab first`)
    await record(entry('plan'))
    await deps.sendSession!(last, feedbackLine(jobId, text), true)
    return ok({ jobId, sessionId: last, via: 'typed' })
  }
  if (!deps.startCoordinator) return conflict('starting a planner is not available in this build')
  if (!accountId) return bad('the Job names no coordinator account to plan on')
  const start = async (brief: string, resume?: string): Promise<string> =>
    (await deps.startCoordinator!({ runId: jobId, cwd: job.cwd, accountId, role: 'planner', brief, ...(resume ? { resume } : {}) })).sessionId
  await record(entry('plan'))
  // 2. Its own conversation resumed: cheaper than a fresh planner, and it keeps everything it read
  const agent = last ? await deps.agentSessionOf?.(last).catch(() => null) : null
  let sessionId: string | undefined
  let via: 'resumed' | 'fresh' = 'resumed'
  if (agent) {
    try {
      sessionId = await start(resumeBrief(jobId, text), agent)
    } catch (e) {
      deps.log?.(`planner of job ${jobId} could not be resumed (${String(e)}): starting a fresh one`)
    }
  }
  // 3. A fresh planner with the plan so far and the whole feedback history
  if (!sessionId) {
    via = 'fresh'
    try {
      sessionId = await start(freshFeedbackBrief(job, accountId, [...(job.feedback ?? []), entry('plan')]))
    } catch (e) {
      return { status: 502, body: { error: `the planner could not start: ${String(e)}` } }
    }
  }
  const started = sessionId
  await setJob(jobId, (j) => ({ ...j, plannerSessionIds: [...(j.plannerSessionIds ?? []), started] }))
  return ok({ jobId, sessionId: started, via })
}

/** Whether `cmd` from `sessionId` is this module's: its commands, and a planner's (not a replan's) `task-cancel`. */
export const isFeedbackCommand = (s: OrchState, sessionId: string, cmd: string): boolean =>
  FEEDBACK_COMMANDS.has(cmd) || (cmd === 'task-cancel' && replanJobOf(s, sessionId) === undefined && plannerJobOf(s, sessionId) !== undefined)
