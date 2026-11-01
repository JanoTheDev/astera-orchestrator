// W7-A talk to the planner (SPEC §2): the owner's feedback on a plan, its rejection, and auto-approve, as commands
// (`jobs-feedback`, `jobs-reject`, `jobs-feedback-done`, `jobs-auto-start`, and a planner's `task-cancel` of its plan).
//
// **Before approval the feedback goes to the planner session itself**: typed into it while it lives, so it keeps
// everything it read; else its own conversation is resumed (`claude --resume`, `agentSessionOf`); else a fresh planner
// gets the plan, `existing.md` and the whole feedback history. The planner revises with `task-update` / `task-create` /
// `task-cancel`, reports one line per change (`jobs-feedback-done`) and ends its turn, which makes the plan ready again
// (host/activity.ts `planReadyActivity`, once per feedback round). **While the plan runs** the feedback starts a W6-D
// replan at once (`jobs-replan --feedback`), with W6-D's rules: only Tasks that have not started change. T1: feedback
// during a replan is typed into its planner or queued for the next one, and a finished plan reopens with a final check.
// T2: `jobs-chat` opens a planner on a finished plan with no feedback: it answers the owner's questions and adds
// follow-up Tasks only when asked.
import { approvalDefaultOf, approvalFallbackOf, type ApprovalMode } from '../../settings/approvalDefault'
import { consoleIdStore, isChatSession } from '../../console/console'
import type { HostSession, OrchServerDeps } from '../command'
import { handsOffOf, projectOfJob } from '../delivery'
import { buildPlannerBrief } from '../handover'
// W8-D several plans in one repo
import { otherPlansBrief, planOverlapWarnings } from '../overlap'
import { archiveJob, isJobActive } from '../lifecycle'
import { cancelPlanTask, planWarnings, plannerJobOf, validatePlan } from '../planner'
import { replanJobOf } from '../replan'
import { outcomeOfTasks } from '../running'
import type { OrchState } from '../state'
import { DEFAULT_CONCURRENCY, type Decision, type Job, type Message, type PlanFeedback, type Task } from '../types'
import { replanCommand } from './replanStart'

type Reply = { status: number; body: unknown }
type Caller = { sessionId: string; role?: 'app' | 'cli' | 'mcp' | 'controller' | 'plugin' }
type Handle = (deps: OrchServerDeps, caller: Caller, cmd: string, args: Record<string, unknown>) => Promise<Reply>

export const FEEDBACK_COMMANDS: ReadonlySet<string> = new Set(['jobs-feedback', 'jobs-chat', 'jobs-reject', 'jobs-feedback-done', 'jobs-auto-start', 'jobs-plan-ready', 'jobs-ask-planner'])
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

// #117: beside deliveryOf, so the pure delivery and state code reads it too
export { handsOffOf }

/** The approval setting of a plan, the first that is set: hands-off (the plan's or its project's, #117), then the plan's
 *  own auto-approve, its project's, the app's global default (Settings > Agents), and last the planning mode: `auto`
 *  starts when the plan holds, `chat` asks. A global hands-off starts the plan like `start`; the coordinator's
 *  hands-off decisions stay with the plan's and project's own `handsOff`. */
export const approvalOf = (s: OrchState, job: Job, globalDefault?: ApprovalMode): ApprovalMode => {
  if (handsOffOf(s, job)) return 'hands-off'
  const own = job.autoApprove ?? projectOfJob(s, job)?.autoApprove
  if (own !== undefined) return own ? 'start' : 'ask'
  return approvalFallbackOf(job, globalDefault)
}

/** Whether a plan starts on its own once it holds (`approvalOf` is anything but `ask`). */
export const autoApproveOf = (s: OrchState, job: Job, globalDefault?: ApprovalMode): boolean => approvalOf(s, job, globalDefault) !== 'ask'

/** A plan waiting for its approval (W2-A): not started, and planned. */
const awaitsApproval = (job: Job): boolean => job.pendingStart === true && job.plannerSessionIds !== undefined

/** #116: a plan the owner can approve now, the rule every Approve on screen follows: it awaits approval, its planner
 *  ended a turn on it (Job.planReadyAt: never set on an auto-approve plan whose own start went through), and it still
 *  holds. `awaitsApproval` stays the Host's own guard (run-start, jobs-reject). */
export const planApprovable = (s: OrchState, job: Job): boolean =>
  awaitsApproval(job) && job.planReadyAt !== undefined && validatePlan(s, job.id).length === 0

/** #116 fold-in: plans that waited for approval before `planReadyAt` existed carry none, so no screen ever offered
 *  Approve. At Host start these are the Jobs to mark ready: awaiting approval, not archived, no `planReadyAt`, the plan
 *  holds, and none of its planner sessions is alive (a live planner's Stop hook marks it itself). */
export const plansMissingReady = (s: OrchState, alive: ReadonlySet<string>): string[] =>
  s.jobs
    .filter(
      (j) =>
        awaitsApproval(j) && isJobActive(j) && j.planReadyAt === undefined && !(j.plannerSessionIds ?? []).some((id) => alive.has(id)) &&
        validatePlan(s, j.id).length === 0
    )
    .map((j) => j.id)

/** What a planner that ended its turn is told when its plan is not ready to approve: the problems approval would find
 *  (`validatePlan`) and the warnings only it hears (`planWarnings`), one line. `key` is the list itself, so the same list
 *  is told once. null when the plan awaits no approval, the session is not its latest planner, or nothing is wrong. */
export function plannerProblemsNotice(s: OrchState, sessionId: string): { jobId: string; key: string; text: string } | null {
  const job = s.jobs.find((j) => j.plannerSessionIds?.at(-1) === sessionId)
  if (!job || !awaitsApproval(job) || !isJobActive(job)) return null
  const problems = [...validatePlan(s, job.id), ...planWarnings(s, job.id)]
  if (problems.length === 0) return null
  const shown = problems.slice(0, 8).map((p, i) => `${i + 1}. ${p}`)
  if (problems.length > shown.length) shown.push(`(${problems.length - shown.length} more after these)`)
  return {
    jobId: job.id,
    key: problems.join('\n'),
    text:
      `Astera: your plan is not ready for the owner to approve. ${shown.join(' ')} Fix them with \`astera task-update --id <taskId>\`, ` +
      `\`astera task-create --run ${job.id}\` or \`astera task-cancel\`, then end your turn. A Task that changes no repository file ` +
      'says `--kind ops|audit|docs --no-files`.'
  }
}

const oneLine = (t: string): string => t.replace(/\s+/g, ' ').trim()

/** What to do with the feedback, said to the planner; the same words whichever way it reaches it. */
const howToRevise = (jobId: string): string =>
  `Revise the plan for it: change Tasks with \`astera task-update --id <taskId>\`, add with \`astera task-create --run ${jobId}\`, ` +
  `remove with \`astera task-cancel --id <taskId> --reason "<why>"\`. A Task you add carries what the first plan's Tasks carry: ` +
  `\`--prompt -\`, \`--criteria\`, \`--affected-paths\`, \`--kind bugfix|feature|refactor|ui|audit|docs|test|ops\`, \`--worktree new|reuse\` (reuse only for a direct continuation of its one dep on the same files), and \`--basis missing|partial|broken\` with its \`--evidence "<file:line, #issue, PR or Job id>"\`; ` +
  `\`astera tasks-list --job ${jobId}\` must show no Task without a basis. Then run \`astera jobs-feedback-done --id ${jobId} --changes '["<one short line per change>"]'\` ` +
  `(an empty list when nothing needed to change) and end your turn. Do not start any work.`

/** The line typed into a live planner: one line, since a terminal's Enter would cut a longer one. */
export const feedbackLine = (jobId: string, text: string): string => `Owner feedback on the plan: «${oneLine(text)}». ${howToRevise(jobId)}`

/** T1: the line typed into a live replan planner: the replan it runs takes this feedback too. */
export const replanFeedbackLine = (jobId: string, text: string): string =>
  `More owner feedback on the plan: «${oneLine(text)}». Apply it the way your brief's OWNER FEEDBACK says, with the same rules ` +
  `(a Task you add carries --kind bugfix|feature|refactor|ui|audit|docs|test|ops, and --worktree reuse only for a direct continuation of its one dep), before you run \`astera jobs-replan-done --id ${jobId}\`; its summary covers this too.`

/** The brief for a resumed planner: its own conversation goes on, so the feedback is all it needs. */
export const resumeBrief = (jobId: string, text: string): string =>
  ['Owner feedback on the plan', '', text.trim(), '', howToRevise(jobId)].join('\n')

/** The brief for a fresh planner, when the old conversation cannot be resumed: the planner's own brief, where the plan
 *  so far is, and every feedback round with what was changed for it. */
export function freshFeedbackBrief(job: Job, accountId: string, history: readonly PlanFeedback[], otherPlans?: string): string {
  return [
    buildPlannerBrief({
      jobId: job.id,
      objective: job.objective,
      repoRoot: job.cwd,
      accountId,
      promptsMode: job.verbatim !== undefined,
      concurrency: job.concurrency ?? DEFAULT_CONCURRENCY,
      ...(otherPlans ? { otherPlans } : {})
    }),
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

/** T2: whether an agent caller sends `jobs-feedback` for the owner: the Astera console for any Job, or the Job's own
 *  chat (`jobs-chat-ensure`), each also after an account roll replaced it. Another plan's chat, a worker, a planner and an
 *  MCP client do not. Only `jobs-feedback`: the rest of the owner's commands stay the person's. */
export function sendsForOwner(caller: Caller, job: Pick<Job, 'chatSessionId'>, consoleId: string | null, sessions: readonly HostSession[]): boolean {
  if (caller.role === 'mcp' || caller.sessionId === '') return false
  return [consoleId, job.chatSessionId].some((id) => id != null && isChatSession(sessions, caller.sessionId, id))
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
    const r = cancelPlanTask(s, id, now)
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
  const forOwner = async (): Promise<boolean> =>
    cmd === 'jobs-feedback' &&
    sendsForOwner(caller, job, deps.profileDir ? await consoleIdStore(deps.profileDir).read() : null, (await deps.listSessions?.()) ?? [])
  if (!byPerson && !(await forOwner())) return denied(`${cmd} is for the person, in Astera or at their own shell`)

  // T2: a chat with a planner about a finished plan, a completion replan with no feedback. One at a time: while a replan
  // runs, its planner is the one to talk to
  if (cmd === 'jobs-chat') {
    if (!isJobActive(job)) return conflict(`job ${jobId} is archived: unarchive it first`)
    if (job.plannerSessionIds === undefined) return conflict(`job ${jobId} was not planned: there is no planner to talk to`)
    if (job.replanning) {
      const sid = job.replanning.sessionId
      if (!sid) return conflict(`job ${jobId}'s planner is starting: try again in a moment`)
      return ok({ jobId, runId: job.replanning.runId, sessionId: sid })
    }
    const run = s.runs.filter((r) => r.jobId === jobId).at(-1)
    if (!run) return conflict(`job ${jobId} has no run: there is no finished plan to talk about`)
    if (outcomeOfTasks(s.tasks.filter((t) => t.runId === run.id)) === 'running') return conflict(`job ${jobId} still runs: send feedback instead`)
    return replanCommand(deps, caller, 'jobs-replan', { id: jobId, run: run.id, mode: 'completion', chat: true }, false, handle)
  }

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

  // #116: the Host's mark that the planner ended a turn on a plan that holds and the plan now waits on the owner
  // (host/activity.ts, on the planner's Stop hook). Only from then on does the app offer Approve.
  if (cmd === 'jobs-plan-ready') {
    if (!awaitsApproval(job) || !isJobActive(job)) return conflict(`job ${jobId} is not a plan waiting for approval`)
    const problems = validatePlan(s, jobId)
    if (problems.length) return { status: 400, body: { error: `the plan does not hold: ${problems.join('; ')}`, problems } }
    await setJob(jobId, (j) => ({ ...j, planReadyAt: now }))
    // T11: the plan's open overlaps with plans planning or running, for the owner's approval; never a problem
    const overlaps = planOverlapWarnings(s, jobId)
    return ok({ jobId, planReadyAt: now, ...(overlaps.length > 0 ? { overlaps } : {}) })
  }

  // T11: a hands-off plan's worker question with no live coordinator, put to the plan's planner (the Host's dispatch loop)
  if (cmd === 'jobs-ask-planner') return askPlanner(deps, job, str(args.question))

  if (cmd === 'jobs-auto-start') {
    if (!awaitsApproval(job) || !isJobActive(job)) return conflict(`job ${jobId} is not a plan waiting for approval`)
    // the Host passes the app's global default (`--approval`): the command cannot read app-settings.json itself
    const globalDefault = approvalDefaultOf(args.approval)
    if (!autoApproveOf(s, job, globalDefault)) return conflict(`job ${jobId} is not set to auto-approve`)
    const problems = validatePlan(s, jobId)
    if (problems.length) return { status: 400, body: { error: `the plan does not hold: ${problems.join('; ')}`, problems } }
    const tasks = s.tasks.filter((t) => t.jobId === jobId && t.runId === undefined).length
    const reply = await handle(deps, caller, 'run-start', { run: jobId })
    if (reply.status >= 300) return reply
    // #117: a hands-off plan's start is the first decision it makes for the owner
    const approval: Decision = { at: now, kind: 'approval', question: 'Start the plan?', choice: 'started', why: `the plan holds (${tasks} tasks) and runs hands-off` }
    await setJob(jobId, (j) => ({ ...j, autoStartedAt: now, ...(handsOffOf(s, j) ? { decisions: [...(j.decisions ?? []), approval] } : {}) }))
    return ok({ jobId, tasks })
  }

  // jobs-feedback
  const text = str(args.text)
  if (!text) return bad('--text is required: what the planner should change')
  if (text.length > FEEDBACK_TEXT_MAX) return bad(`--text is at most ${FEEDBACK_TEXT_MAX} characters`)
  if (!isJobActive(job)) return conflict(`job ${jobId} is archived: unarchive it first`)
  const entry = (phase: PlanFeedback['phase']): PlanFeedback => ({ at: now, text, phase })
  // #116: a feedback round on the plan is a new planning round: not ready again until the planner ends its turn
  const record = (f: PlanFeedback): Promise<void> =>
    setJob(jobId, ({ planReadyAt, ...j }) => ({ ...j, ...(f.phase === 'run' && planReadyAt ? { planReadyAt } : {}), feedback: [...(j.feedback ?? []), f] }))

  if (!awaitsApproval(job)) {
    if (job.plannerSessionIds === undefined) return conflict(`job ${jobId} was not planned: there is no planner to talk to`)
    // T1: a replan runs already: typed into its planner while it lives, else queued for the next replan (jobs-replan-done)
    if (job.replanning) {
      const sid = job.replanning.sessionId
      const live = sid && deps.listSessions && deps.sendSession ? (await deps.listSessions()).find((x) => x.id === sid && x.alive && x.kind === 'terminal') : undefined
      const turn = live && sid ? await deps.sessionTurn?.(sid) : undefined
      if (live && sid && !(turn?.state === 'waiting' && turn.prompt !== null)) {
        await record(entry('run'))
        await deps.sendSession!(sid, replanFeedbackLine(jobId, text), true)
        return ok({ jobId, sessionId: sid, via: 'typed' })
      }
      await record({ ...entry('run'), queued: true })
      return ok({ jobId, via: 'queued' })
    }
    const run = s.runs.filter((r) => r.jobId === jobId).at(-1)
    if (!run) return conflict(`job ${jobId} has no run: there is nothing to replan`)
    // T1: a finished plan (completed or failed) takes more work through a final-check replan, its follow-ups run as those do
    const finished = outcomeOfTasks(s.tasks.filter((t) => t.runId === run.id)) !== 'running'
    // W6-D's replan, started now instead of at the wave boundary; it holds the plan while it runs
    const reply = await replanCommand(deps, caller, 'jobs-replan', { id: jobId, run: run.id, feedback: text, feedbackAt: now, ...(finished ? { mode: 'completion' } : {}) }, false, handle)
    if (reply.status < 300) await record(entry('run'))
    return reply
  }

  // T5b (decision 6): the account named for the plan is a preference; with none, the planner starts where there is room
  // (`auto`), the account it ran on before only saying the provider
  const accountId = job.preferredAccountId ?? job.coordinatorAccountId ?? job.plannerAccountId
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
  if (!accountId) return bad('the Job names no account to plan on')
  let startedOn: string | undefined
  const start = async (brief: string, resume?: string): Promise<string> => {
    const started = await deps.startCoordinator!({
      runId: jobId,
      cwd: job.cwd,
      accountId,
      ...(job.preferredAccountId === undefined ? { auto: true as const } : {}),
      role: 'planner',
      brief,
      ...(resume ? { resume } : {})
    })
    startedOn = started.accountId
    return started.sessionId
  }
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
      sessionId = await start(freshFeedbackBrief(job, accountId, [...(job.feedback ?? []), entry('plan')], otherPlansBrief(deps.getState(), job)))
    } catch (e) {
      return { status: 502, body: { error: `the planner could not start: ${String(e)}` } }
    }
  }
  const started = sessionId
  // T5b: the account it actually started on
  await setJob(jobId, (j) => ({ ...j, plannerSessionIds: [...(j.plannerSessionIds ?? []), started], ...(startedOn ? { plannerAccountId: startedOn } : {}) }))
  return ok({ jobId, sessionId: started, via })
}

/** Whether `cmd` from `sessionId` is this module's: its commands, and a planner's (not a replan's) `task-cancel`. */
export const isFeedbackCommand = (s: OrchState, sessionId: string, cmd: string): boolean =>
  FEEDBACK_COMMANDS.has(cmd) || (cmd === 'task-cancel' && replanJobOf(s, sessionId) === undefined && plannerJobOf(s, sessionId) !== undefined)

/** T11: what the planner is told about a worker's question it answers: the question and the Task's spec and paths. */
function questionFacts(q: Pick<Message, 'id' | 'body' | 'subject'>, task: Task | undefined): string[] {
  const asked = q.body.trim() !== '' ? q.body : q.subject
  return [
    `Question ${q.id}${task ? ` from the worker of ${task.title} (${task.id})` : ''}: «${oneLine(asked).slice(0, 1500)}»`,
    ...(task
      ? [
          `The Task's spec: «${oneLine(task.spec).slice(0, 1500)}»`,
          `Its affected paths: ${task.affectedPaths?.length ? task.affectedPaths.join(', ') : 'none named'}`
        ]
      : [])
  ]
}

/** T11: how the planner answers, the same words whichever way the question reaches it. */
const howToAnswer = (questionId: string): string =>
  `Answer it from the plan's design (the Job's objective, the Task's spec and paths, the decisions in your plan and \`existing.md\`) ` +
  `with \`astera questions-answer --id ${questionId} --answer "<your decision and why>"\`, then end your turn. ` +
  'Keep within the guardrails: force-push, pushing or merging to the default branch, deleting data outside the plan worktrees, ' +
  'money and credentials stay the owner\'s, so answer those "no". ' +
  'When the worker cannot run something this machine lacks (an OS-specific tool, a missing service or device), tell it to ' +
  'report succeeded with `--not-provable "<command>: <why>"` and prove the rest. Do not start any work and do not change the plan.'

/** T11: the line typed into a live planner: one line, since a terminal's Enter would cut a longer one. */
export const plannerQuestionLine = (q: Pick<Message, 'id' | 'body' | 'subject'>, task: Task | undefined): string =>
  `Astera: your plan runs hands-off and has no live coordinator, so a worker's question is yours. ${questionFacts(q, task).join('. ')}. ${howToAnswer(q.id)}`

/** T11: the brief for a resumed planner (its conversation goes on), or with `fresh` one that has to find the plan first. */
export function plannerQuestionBrief(job: Job, q: Pick<Message, 'id' | 'body' | 'subject'>, task: Task | undefined, fresh = false): string {
  return [
    `A worker's question on your plan ${job.id}`,
    '',
    "The plan runs hands-off and has no live coordinator, so you decide this question in the owner's place.",
    ...(fresh
      ? [
          '',
          `You are the planner of this plan, started again to answer it. Read the plan first: \`astera tasks-list --job ${job.id}\`, ` +
            `\`$ASTERA_PROFILE_DIR/plans/${job.id}/plan.md\`, and \`$ASTERA_PROFILE_DIR/plans/${job.id}/inputs/existing.md\` when it is there.`,
          `The Job's objective: «${oneLine(job.objective).slice(0, 1500)}»`
        ]
      : []),
    '',
    ...questionFacts(q, task),
    '',
    howToAnswer(q.id)
  ].join('\n')
}

/** T11: `jobs-ask-planner`: a hands-off plan's open worker question put to its planner: typed into it while it lives,
 *  else its conversation resumed, else a fresh planner. The new session joins `plannerSessionIds`, so its answer is
 *  accepted (command.ts `questions-answer`) and it stays a planner (planner.ts `plannerRefusal`). */
async function askPlanner(deps: OrchServerDeps, job: Job, questionId: string | null): Promise<Reply> {
  const s = deps.getState()
  if (!questionId) return bad('--question is required: the open question')
  if (!handsOffOf(s, job)) return conflict(`job ${job.id} is not hands-off: its questions are the owner's`)
  const q = s.messages.find((m) => m.id === questionId && (m.type === 'question' || m.type === 'escalation'))
  if (!q) return notFound(`unknown question: ${questionId}`)
  if (q.approval) return denied('an approval request is answered by the owner, from the app or a shell')
  if (q.answered) return conflict(`question ${questionId} is answered already`)
  if (s.runs.find((r) => r.id === q.runId)?.jobId !== job.id) return bad(`question ${questionId} is not a question of job ${job.id}`)
  const last = job.plannerSessionIds?.at(-1)
  if (!last) return conflict(`job ${job.id} was not planned: there is no planner to ask`)
  const task = s.tasks.find((t) => t.id === q.taskId)
  // 1. Typed into the planner while it lives
  const live = deps.listSessions && deps.sendSession ? (await deps.listSessions()).find((x) => x.id === last && x.alive && x.kind === 'terminal') : undefined
  if (live) {
    const turn = await deps.sessionTurn?.(last)
    if (turn?.state === 'waiting' && turn.prompt !== null) return conflict(`the planner waits on ${turn.prompt === 'permission' ? 'a permission prompt' : 'a question'}`)
    await deps.sendSession!(last, plannerQuestionLine(q, task), true)
    return ok({ jobId: job.id, questionId, sessionId: last, via: 'typed' })
  }
  if (!deps.startCoordinator) return conflict('starting a planner is not available in this build')
  const accountId = job.preferredAccountId ?? job.coordinatorAccountId ?? job.plannerAccountId
  if (!accountId) return bad('the Job names no account to plan on')
  let startedOn: string | undefined
  const start = async (brief: string, resume?: string): Promise<string> => {
    const started = await deps.startCoordinator!({
      runId: job.id,
      cwd: job.cwd,
      accountId,
      ...(job.preferredAccountId === undefined ? { auto: true as const } : {}),
      role: 'planner',
      brief,
      ...(resume ? { resume } : {})
    })
    startedOn = started.accountId
    return started.sessionId
  }
  // 2. Its own conversation resumed, which keeps everything it read
  const agent = await deps.agentSessionOf?.(last).catch(() => null)
  let sessionId: string | undefined
  let via: 'resumed' | 'fresh' = 'resumed'
  if (agent) {
    try {
      sessionId = await start(plannerQuestionBrief(job, q, task), agent)
    } catch (e) {
      deps.log?.(`planner of job ${job.id} could not be resumed (${String(e)}): starting a fresh one`)
    }
  }
  // 3. A fresh planner that reads the plan first
  if (!sessionId) {
    via = 'fresh'
    try {
      sessionId = await start(plannerQuestionBrief(job, q, task, true))
    } catch (e) {
      return { status: 502, body: { error: `the planner could not start: ${String(e)}` } }
    }
  }
  const started = sessionId
  const cur = deps.getState()
  await deps.setState({
    ...cur,
    jobs: cur.jobs.map((j) => (j.id === job.id ? { ...j, plannerSessionIds: [...(j.plannerSessionIds ?? []), started], ...(startedOn ? { plannerAccountId: startedOn } : {}) } : j))
  })
  return ok({ jobId: job.id, questionId, sessionId: started, via })
}
