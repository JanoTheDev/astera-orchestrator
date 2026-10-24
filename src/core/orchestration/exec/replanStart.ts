// W6-D wave replanning: the replan's start and end, as commands (`jobs-replan`, `jobs-replan-done`, `task-cancel`, and
// `task-update` from a replan session). The rules are replan.ts's; this is where they meet the state and the sessions.
//
// A replan is a **fresh planner session** started through `startCoordinator({ role: 'planner' })`, so it takes the
// planner's spawn whole (exec/plannerStart.ts: the planner model, no permission bypass, the planner gate). Only its
// brief differs: the objective, what every completed Task reported, its review and its changed files, and what is
// left. Its end is #47's: the session is stopped once its work is recorded.
// W8-D several plans in one repo
import { PROMPTS_MODE_FILL_IN, plannerPlanningSection } from '../handover'
import { otherPlansBrief } from '../overlap'
import { collectChanges, rangesFor } from '../changedFiles'
import { releases, stillStarting, type OrchServerDeps } from '../command'
import { PLANNER_COMMANDS, planFieldsFromArgs, validatePlan, worktreeRefusal } from '../planner'
import { REPLAN_FOLLOW_UPS_MAX, affectedLeft, cancelRemainingTask, cancelTaskByOwner, deviatingTasks, editRemainingTask, notStarted, replanAccountOf, replanJobOf, replanOn, resolveFailedWait, runTasks, waveOpen, type ReplanEnded, type ReplanRecord } from '../replan'
import { isIntegrationTask } from '../integrate'
import { jobNameOf } from '../jobName'
import { deliveryEnded, outcomeOfTasks } from '../running'
import { placedByApp, type OrchState } from '../state'
import { newId, type Job, type JobRun, type Message, type ReplanMark, type Task } from '../types'
import { HOST_CALLER } from '../../host/driver'

type Reply = { status: number; body: unknown }
type Caller = { sessionId: string; role?: 'app' | 'cli' | 'mcp' | 'controller' | 'plugin' }
type Handle = (deps: OrchServerDeps, caller: Caller, cmd: string, args: Record<string, unknown>) => Promise<Reply>

export const REPLAN_COMMANDS: ReadonlySet<string> = new Set(['jobs-replan', 'jobs-replan-done', 'task-cancel'])

const ok = (body: unknown): Reply => ({ status: 200, body })
const bad = (error: string): Reply => ({ status: 400, body: { error } })
const denied = (error: string): Reply => ({ status: 403, body: { error } })
const notFound = (error: string): Reply => ({ status: 404, body: { error } })
const conflict = (error: string): Reply => ({ status: 409, body: { error } })
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)

/** The answer to a held replan's escalation that lifts the hold (exec/dispatchLoop.ts liftAnsweredHolds). */
export const REPLAN_LIFT_HOLD = 'lift the hold'

/** The Inbox item of an escalated replan: an escalation in its Run, whose option lifts the hold. */
export function replanEscalation(runId: string, jobId: string, why: string, now: string): Message {
  return {
    id: newId('msg'),
    runId,
    type: 'escalation',
    subject: `Replan escalated, the plan is held: ${why}`.slice(0, 300),
    body:
      `${why}\n\nNo new worker starts until the hold is lifted. Fix the plan if it needs it, then answer ` +
      `"${REPLAN_LIFT_HOLD}" (or run \`astera jobs-unhold --id ${jobId}\`).`,
    options: [REPLAN_LIFT_HOLD],
    answered: false,
    createdAt: now
  }
}

/** `plan.replanned` for the coordinator of a Run whose wave replan just ended (or was skipped): the Tasks it may start
 *  now. None for a Run the app places itself (its scheduler starts them), a Run that is gone, or a Job still held. */
export function waveOpenedMessage(s: OrchState, jobId: string, runId: string, wave: number, now: string): Message | undefined {
  const job = s.jobs.find((j) => j.id === jobId)
  const run = s.runs.find((r) => r.id === runId)
  if (!job || !run || placedByApp(job, run) || job.dispatchHold) return undefined
  const startable = runTasks(s, runId).filter((t) => t.status === 'ready' && waveOpen(t, s))
  return {
    id: newId('msg'),
    runId,
    type: 'status',
    subject: 'plan.replanned',
    body:
      `The replan before wave ${wave + 1} has ended (${job.lastReplan?.summary ?? 'replanned'}). ` +
      (startable.length
        ? `Start these ready Tasks now: ${startable.map((t) => `${t.id} (${t.title})`).join(', ')}.`
        : 'No Task is ready to start yet.'),
    answered: false,
    createdAt: now
  }
}

/** What a replan session may call besides a planner's own commands: its Run's reads, the cancel, and the end. T2: a
 *  Task's Dispatches too, for the owner's questions in a chat. */
const REPLAN_EXTRA = new Set(['runs-get', 'runs-changed-files', 'dispatch-show', 'task-cancel', 'jobs-replan-done'])

/**
 * Why `cmd` is refused to the replan session `sessionId`; null when it may call it; undefined when the session is no
 * replan session (then `plannerRefusal` decides). It writes into its Run only: new Tasks there, and edits and cancels of
 * Tasks that have not started. Completed and running Tasks are never touched.
 */
export function replanRefusal(s: OrchState, sessionId: string, cmd: string, args: Record<string, unknown>): string | null | undefined {
  const job = replanJobOf(s, sessionId)
  if (!job) return undefined
  const runId = job.replanning!.runId
  if (!PLANNER_COMMANDS.has(cmd) && !REPLAN_EXTRA.has(cmd)) return `a replanning planner only adjusts the plan: ${cmd} is refused`
  if (cmd === 'task-create' && (args.runId ?? args.run) !== runId) return `a replan adds Tasks to its Run only: pass --run ${runId}`
  if (cmd === 'task-update' || cmd === 'task-cancel') {
    const task = s.tasks.find((t) => t.id === args.id)
    if (!task || task.runId !== runId) return `a replan changes the Tasks of its Run (${runId}) only`
    // T36: a failed Task is retried (--status ready, with a changed spec) or accepted as done (--status completed --reason)
    if (cmd === 'task-update' && task.status === 'failed' && args.convergence === undefined)
      return args.status === 'ready' || args.status === 'completed'
        ? null
        : `${task.id} failed: retry it with --status ready (and a changed spec), or accept it with --status completed --reason "<its gaps>"`
    if (!notStarted(s, task)) return `${task.id} has started or finished: a replan changes only Tasks that have not started`
    if (args.status !== undefined || args.convergence !== undefined) return 'a replan edits what a Task asks for, not its status'
  }
  if (cmd === 'jobs-replan-done' && args.id !== job.id) return `a replan ends its own Job's replan only: pass --id ${job.id}`
  return null
}

/** `validatePlan` over what is left of a Run: its not-started Tasks (not the app's integration Tasks), with deps on its
 *  started or finished Tasks counted as met. Empty when it holds, and when nothing is left. */
export function replanProblems(s: OrchState, runId: string): string[] {
  const own = runTasks(s, runId)
  const left = own.filter((t) => notStarted(s, t) && !isIntegrationTask(t))
  if (left.length === 0) return []
  const met = new Set(own.filter((t) => !left.includes(t)).map((t) => t.id))
  const key = `replan:${runId}`
  const tasks = left.map((t) => ({ ...t, runId: undefined, jobId: key, deps: t.deps.filter((d) => !met.has(d)) }))
  return validatePlan({ ...s, tasks }, key)
}

/** What a replan changed, in one line: Tasks added, changed and cancelled since it began, then the planner's note. */
export function replanSummary(s: OrchState, job: Job, note?: string): { line: string; added: number } {
  const r = job.replanning!
  const own = runTasks(s, r.runId).filter((t) => !isIntegrationTask(t))
  const before = r.before ?? {}
  const added = own.filter((t) => before[t.id] === undefined).length
  const changed = own.filter((t) => before[t.id] !== undefined && before[t.id] !== t.updatedAt && notStarted(s, t)).length
  const cancelled = r.cancelled?.length ?? 0
  const parts = [
    ...(added ? [`${added} Task${added > 1 ? 's' : ''} added`] : []),
    ...(changed ? [`${changed} changed`] : []),
    ...(cancelled ? [`${cancelled} cancelled`] : [])
  ]
  const what = parts.length ? parts.join(', ') : r.mode === 'completion' ? 'done, nothing to add' : 'no change'
  const clean = note?.replace(/\s+/g, ' ').trim()
  const base = clean ? `${what}: ${clean}`.slice(0, 300) : what
  // Every dropped dep keeps its reason: listed after the capped part, never cut
  const dropped = r.droppedDeps?.length ? `; deps dropped: ${r.droppedDeps.join('; ')}` : ''
  return { line: base + dropped, added }
}

/** One completed Task, as the replan brief shows it. */
export interface DoneTask {
  task: Pick<Task, 'id' | 'title' | 'result' | 'reviewRequested' | 'reviewIssues' | 'filesModified' | 'gaps'>
  /** The files git says it changed (`runs-changed-files`), or null when git could not tell. */
  changed: string[] | null
}

const oneLine = (s: string | undefined, max: number): string => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max) || '(none)'

/** The replan planner's brief. `left`: the Tasks that have not started; `running`: started and not finished. */
export function buildReplanBrief(a: {
  job: Pick<Job, 'id' | 'objective' | 'cwd' | 'verbatim'>
  runId: string
  mode: ReplanMark['mode']
  wave: number
  accountId: string
  followUps: number
  done: DoneTask[]
  /** T36: failed Tasks that hold back not-started ones, with their worker's report. */
  failed?: Pick<Task, 'id' | 'title' | 'result'>[]
  running: Pick<Task, 'id' | 'title'>[]
  left: Pick<Task, 'id' | 'title' | 'deps' | 'affectedPaths'>[]
  /** W7-A: the owner's feedback this replan was started for, at once rather than at a wave boundary. */
  feedback?: string
  /** W8-D: the other plans of this repository and how far they got (overlap.ts `otherPlansBrief`). */
  otherPlans?: string
  /** A wave replan that looks at the deviating Tasks only: `done` and `left` are already narrowed to them. */
  focused?: true
  /** T2: the owner's chat on the finished plan (`jobs-chat`): questions first, follow-up Tasks only when asked. */
  chat?: true
}): string {
  const reviewOf = (t: DoneTask['task']): string => {
    if (!t.reviewRequested) return 'not reviewed'
    const issues = t.reviewIssues ?? []
    return issues.length ? `passed with ${issues.map((i) => `${i.severity} ${i.title}`).join('; ')}` : 'passed, no issues'
  }
  const completion = a.mode === 'completion'
  return [
    a.chat
      ? 'You are the PLANNER for one Job in Astera, IN A CHAT WITH THE OWNER about the finished plan. Every Task has completed or failed.'
      : // T1: feedback on a finished plan is more work, not a final check
      a.feedback !== undefined && completion
      ? 'You are the PLANNER for one Job in Astera, REPLANNING NOW because the owner sent feedback on the finished plan. Every Task has completed or failed.'
      : a.feedback !== undefined
      ? 'You are the PLANNER for one Job in Astera, REPLANNING NOW because the owner sent feedback while the plan runs.'
      : completion
      ? 'You are the PLANNER for one Job in Astera, doing its FINAL CHECK. Every Task has completed.'
      : `You are the PLANNER for one Job in Astera, REPLANNING before wave ${a.wave + 1} starts.`,
    a.focused
      ? 'You analyse and adjust the plan. You do not implement anything. The Tasks listed under WHAT IS LEFT do not start until you finish; the rest of the plan goes on meanwhile.'
      : 'You analyse and adjust the plan. You do not implement anything. No Task starts until you finish.',
    '',
    'THE JOB',
    `- id: ${a.job.id}`,
    `- run: ${a.runId}`,
    `- objective: ${a.job.objective}`,
    `- repository root: ${a.job.cwd}`,
    '',
    ...(a.job.verbatim !== undefined ? [...PROMPTS_MODE_FILL_IN, ''] : []),
    a.focused ? 'WHAT DEVIATED (completed Tasks that did not go as planned; every other completed Task did)' : 'WHAT HAS BEEN DONE (completed Tasks)',
    ...(a.done.length
      ? a.done.flatMap(({ task: t, changed }) => [
          `- ${t.id} (${t.title})`,
          `  report: ${oneLine(t.result, 600)}`,
          `  review: ${reviewOf(t)}`,
          ...(t.gaps ? [`  gaps: ${oneLine(t.gaps, 600)}`] : []),
          `  changed files: ${(changed ?? t.filesModified ?? []).join(', ') || '(none recorded)'}`
        ])
      : ['- (none)']),
    ...(a.failed?.length
      ? [
          '',
          'WHAT FAILED (its worker failed and nothing retries it; what waits on it cannot start until you act)',
          ...a.failed.flatMap((t) => [`- ${t.id} (${t.title})`, `  report: ${oneLine(t.result, 600)}`])
        ]
      : []),
    ...(a.running.length ? ['', 'RUNNING NOW (leave these alone)', ...a.running.map((t) => `- ${t.id} (${t.title})`)] : []),
    '',
    a.focused ? 'WHAT IS LEFT THAT THESE CAN AFFECT (not started; these you may change)' : 'WHAT IS LEFT (not started; these you may change)',
    ...(a.left.length
      ? a.left.map((t) => `- ${t.id} (${t.title})${t.deps.length ? ` waits for ${t.deps.join(', ')}` : ''}${t.affectedPaths?.length ? `; paths ${t.affectedPaths.join(', ')}` : ''}`)
      : ['- (nothing)']),
    '',
    // W8-D: what another plan finished meanwhile is not planned again
    ...(a.otherPlans ? [a.otherPlans, 'Before a later wave, drop or shrink a Task here that another plan has completed meanwhile.', ''] : []),
    // W7-A
    ...(a.feedback !== undefined
      ? [
          'OWNER FEEDBACK',
          a.feedback.trim(),
          ...(completion
            ? ['Add follow-up Tasks for what it asks. A completed Task is not changed: a follow-up Task does the new work.']
            : [
                'Apply it to the Tasks that have not started. If it is about a running or completed Task, change nothing',
                'there: say so in your summary, so the owner can stop that Task from its card.'
              ]),
          ''
        ]
      : []),
    // T2
    ...(a.chat
      ? [
          'OWNER CHAT',
          "The person opened this tab to ask about this finished plan. Answer their questions from the Tasks' reports, reviews and",
          `changed files: \`astera tasks-list --job ${a.job.id}\`, \`astera runs-changed-files --id ${a.runId} --task <taskId> --json\`,`,
          '`astera dispatch-show --task <taskId>`, and git log and diff of the plan branch. Do not change files.',
          'Only when they ask for more work, add follow-up Tasks as WHAT YOU MAY DO says. A completed Task is not changed: a',
          'follow-up Task does the new work. When they are done, end as WHEN YOU ARE DONE says, with or without new Tasks.',
          '',
          ...plannerPlanningSection('chat')
        ]
      : []),
    'REVIEW THE DEPS',
    '- For every Task that has not started, check each dep: it is real only when the Task uses code, an API, a file\'s content or a decision',
    '  that the other Task produces. "Same area", "same files", "nicer order" and "review after" are not reasons: each Task has its own',
    '  worktree and the merge worker resolves conflicts. Drop the rest: `astera task-update --id <taskId> --deps \'[...the real ones]\' --reason "<why it needs none of the dropped>"`.',
    '  Each drop is listed with its reason in the replan summary; a drop without --reason is refused.',
    '',
    'BEFORE YOU DECIDE',
    '- Read `$ASTERA_SKILLS/planner-guide.md`, section "Replanning". Read the code the done Tasks changed:',
    ...(a.focused ? ['  Read only the Tasks listed here, not the whole plan; the rest is unchanged.'] : []),
    `  \`astera runs-changed-files --id ${a.runId} --task <taskId> --json\`, and the files themselves.`,
    '',
    'WHAT YOU MAY DO',
    `- Change a Task that has not started: \`astera task-update --id <taskId>\` with --prompt -, --criteria, --affected-paths, --deps, --worktree, --difficulty, --effort, --title, --spec.`,
    `- Add a Task: \`astera task-create --run ${a.runId} --account ${a.accountId}\` with the planner flags (--prompt -, --criteria, --affected-paths, --deps, --kind bugfix|feature|refactor|ui|audit|docs|test|ops, --worktree new|reuse, --difficulty, --effort, --model-reason) and, on every Task, --basis missing|partial|broken and --evidence "<file:line, #issue, PR or Job id>".`,
    // T3 worktree per Task
    '  `--worktree reuse` continues in the worktree of the Task\'s one dep: only for a direct continuation of it on the same files (the next step, a fix-up, tests for it); `new` (the default) for anything that can run in parallel or works elsewhere.',
    '  A follow-up for a review\'s leftovers uses `--basis partial` with evidence naming the parent Task id and its review (for example "tsk_x review round 2: <issue>").',
    '- Cancel a Task that has not started and is no longer needed: `astera task-cancel --id <taskId> --reason "<why>"`.',
    ...(a.failed?.length
      ? [
          '- For a failed Task: retry it with what it asks changed (`astera task-update --id <taskId> --status ready` with --spec or --prompt -),',
          '  accept what it did as done with its gaps (`astera task-update --id <taskId> --status completed --reason "<its gaps>"`),',
          '  or rewire or cancel what waits on it, or add a Task that covers the gap. Left as it is, the owner is asked.'
        ]
      : []),
    'Astera refuses any change to a completed or running Task, and every command that starts work.',
    ...(completion && a.feedback === undefined && !a.chat
      ? [
          '',
          'THE FINAL CHECK',
          'Compare what was done with the objective. If it is met, add nothing. If something is missing or broken,',
          `add follow-up Tasks for exactly that. This Job has had ${a.followUps} follow-up wave(s); after ${REPLAN_FOLLOW_UPS_MAX}`,
          'a further one goes to the person instead.'
        ]
      : []),
    '',
    'WHEN YOU ARE DONE',
    `Run \`astera jobs-replan-done --id ${a.job.id} --summary "<one line: what you changed and why>"\`. That ends this`,
    'session. `jobs-replan-done` is refused while a Task that has not started lacks a prompt, a criterion, affected paths',
    'or a basis (or has an unknown dep or a cycle): fix them with `astera task-update --id <taskId>` and call it again.'
  ].join('\n')
}

/** The Job's Run and its Tasks split for the brief, with each completed Task's changed files read from git. */
async function briefParts(deps: OrchServerDeps, s: OrchState, runId: string, only?: readonly Task[]): Promise<Pick<Parameters<typeof buildReplanBrief>[0], 'done' | 'failed' | 'running' | 'left'>> {
  const own = s.tasks.filter((t) => t.runId === runId && !isIntegrationTask(t))
  const done: DoneTask[] = []
  for (const t of own.filter((x) => x.status === 'completed' && (!only || only.some((o) => o.id === x.id)))) {
    let changed: string[] | null = null
    const found = deps.changes ? rangesFor(s, runId, t.id) : null
    if (deps.changes && found && found.parts.length > 0) {
      const got = await collectChanges(found.parts, deps.changes.read).catch(() => null)
      if (got?.read) changed = got.files.map((f) => f.file.path)
    }
    done.push({ task: t, changed })
  }
  const left = own.filter((t) => notStarted(s, t))
  // T36: a failed Task the replan was started for is listed with its report, not as running
  const failed = own.filter((t) => t.status === 'failed' && only?.some((o) => o.id === t.id))
  return {
    done,
    failed,
    running: own.filter((t) => t.status !== 'completed' && !notStarted(s, t) && !failed.includes(t)),
    left: only ? affectedLeft(only, left) : left
  }
}

/** The replan commands. `fromAgent`: the caller is an agent session (not the app, the Host, a shell). */
export async function replanCommand(deps: OrchServerDeps, caller: Caller, cmd: string, args: Record<string, unknown>, fromAgent: boolean, handle?: Handle): Promise<Reply> {
  const now = deps.now?.() ?? new Date().toISOString()
  const s = deps.getState()
  const setJob = async (jobId: string, f: (j: Job) => Job): Promise<Job | undefined> => {
    const cur = deps.getState()
    const j = cur.jobs.find((x) => x.id === jobId)
    if (!j) return undefined
    const next = f(j)
    await deps.setState({ ...cur, jobs: cur.jobs.map((x) => (x.id === jobId ? next : x)) })
    return next
  }
  // Into the Run's inbox, the way every message goes (the coordinator's `check`, the Inbox's questions-list)
  const post = async (m: Message | undefined): Promise<void> => {
    if (!m) return
    const cur = deps.getState()
    await deps.setState({ ...cur, messages: [...cur.messages, m] })
  }

  if (cmd === 'task-update') {
    // Only a replan session's task-update comes here (handleCommand routes it); replanRefusal has checked the Task.
    const id = str(args.id)
    if (!id) return bad('--id is required')
    const plan = planFieldsFromArgs(args)
    if (!plan.ok) return bad(plan.error)
    if (args.deps !== undefined && !(Array.isArray(args.deps) && args.deps.every((d) => typeof d === 'string')))
      return bad('--deps must be a JSON array of Task ids')
    // T36: the failed Task the replan was started for: retried with what it asks changed, or accepted with its gaps
    if (s.tasks.find((t) => t.id === id)?.status === 'failed') {
      const accept = args.status === 'completed'
      if (accept && !str(args.reason)) return bad('--reason is required: why its work counts as done (its gaps)')
      const patch = { ...plan.fields, ...(str(args.title) ? { title: str(args.title)! } : {}), ...(str(args.spec) ? { spec: str(args.spec)! } : {}) }
      const r = resolveFailedWait(s, id, accept ? 'accept' : 'retry', now, accept ? { reason: str(args.reason)! } : { patch })
      if (!r.ok) return r.missing ? notFound(r.error) : bad(r.error)
      await deps.setState(r.state)
      return ok(r.value)
    }
    // A dep is dropped only with its reason: the summary and the feed list each one
    const before = s.tasks.find((t) => t.id === id)
    const dropped = args.deps !== undefined && before ? before.deps.filter((d) => !(args.deps as string[]).includes(d)) : []
    const dropReason = str(args.reason)?.replace(/\s+/g, ' ').trim()
    if (dropped.length && !dropReason) return bad(`--reason is required when --deps drops ${dropped.join(', ')}: why ${id} does not need it (it uses no code, API, file content or decision from it)`)
    const r = editRemainingTask(
      s,
      id,
      {
        ...plan.fields,
        ...(str(args.title) ? { title: str(args.title)! } : {}),
        ...(str(args.spec) ? { spec: str(args.spec)! } : {}),
        ...(args.deps !== undefined ? { deps: args.deps as string[] } : {})
      },
      now
    )
    if (!r.ok) return r.missing ? notFound(r.error) : bad(r.error)
    // T3: a deps or --worktree change keeps `reuse` valid
    const worktreeNo = worktreeRefusal(r.state, r.value)
    if (worktreeNo !== undefined) return bad(worktreeNo)
    const rj = replanJobOf(s, caller.sessionId)
    if (dropped.length && rj) {
      const title = (d: string): string => s.tasks.find((t) => t.id === d)?.title ?? d
      const line = `${r.value.title}: ${dropped.map(title).join(', ')} (${dropReason})`
      await deps.setState({
        ...r.state,
        jobs: r.state.jobs.map((j) => (j.id === rj.id && j.replanning ? { ...j, replanning: { ...j.replanning, droppedDeps: [...(j.replanning.droppedDeps ?? []), line] } } : j))
      })
    } else await deps.setState(r.state)
    return ok(r.value)
  }

  if (cmd === 'task-cancel') {
    const id = str(args.id)
    const reason = str(args.reason)
    if (!id) return bad('--id is required')
    if (!reason) return bad('--reason is required: why this Task is no longer needed')
    const job = replanJobOf(s, caller.sessionId)
    if (!job) {
      // T5: the owner (a person, in Astera or at their own shell) cancels a Task of their plan, started or not
      if (fromAgent || caller.role === 'mcp') return denied('a Task is cancelled by the owner, or by its Job\'s replan')
      const r = cancelTaskByOwner(s, id, reason, now)
      if (!r.ok) return r.missing ? notFound(r.error) : bad(r.error)
      // A worker still starting has no session to release yet: nothing is written, try again in a moment (as worker-stop)
      const starting = stillStarting(r.value.closed, now)
      if (starting) return starting
      await deps.setState(r.state)
      for (const d of r.value.closed.filter(releases)) await deps.releaseWorker({ dispatchId: d.id, closeReason: 'stopped' })
      return ok({ id, cancelled: true, reason, stopped: r.value.closed.length })
    }
    const r = cancelRemainingTask(s, id)
    if (!r.ok) return r.missing ? notFound(r.error) : bad(r.error)
    const line = `${r.value.title}: ${reason.replace(/\s+/g, ' ').trim()}`
    await deps.setState({
      ...r.state,
      jobs: r.state.jobs.map((j) => (j.id === job.id && j.replanning ? { ...j, replanning: { ...j.replanning, cancelled: [...(j.replanning.cancelled ?? []), line] } } : j))
    })
    return ok({ id, cancelled: true, reason })
  }

  const jobId = str(args.id)
  if (!jobId) return bad('--id is required: the Job')
  const job = s.jobs.find((j) => j.id === jobId)
  if (!job) return notFound(`unknown job: ${jobId}`)

  if (cmd === 'jobs-replan') {
    // The driving loop asks for a deviation; a person may too. Never another agent: a replan holds Tasks, or the whole Job.
    if (fromAgent || caller.role === 'mcp') return denied('a replan is started by Astera at a wave boundary, or by the person')
    // W7-A: the owner's feedback replans a planned Job at once, also with waves replanning off. T2: so does their chat
    const feedback = str(args.feedback) ?? undefined
    const feedbackAt = feedback !== undefined ? (str(args.feedbackAt) ?? now) : undefined
    const chat = args.chat === true
    const ownerAsk = feedback !== undefined || chat
    const plannedRun = job.plannerSessionIds !== undefined && job.schedule === undefined && replanAccountOf(job) !== undefined
    if (ownerAsk ? !plannedRun : !replanOn(job))
      return conflict(`job ${jobId} does not replan: it is not planned, is a schedule, has no account to plan on, or has replan off`)
    if (job.replanning) return conflict(`job ${jobId} is replanning already`)
    if (!deps.startCoordinator) return conflict('starting a planner is not available in this build')
    const runId = str(args.run) ?? s.runs.filter((r) => r.jobId === jobId).at(-1)?.id
    if (!runId || !s.runs.some((r) => r.id === runId && r.jobId === jobId)) return notFound(`no run of job ${jobId}${runId ? `: ${runId}` : ''}`)
    const own = s.tasks.filter((t) => t.runId === runId)
    // W7-A: a feedback replan is at no boundary of its own: it re-records the Run's last boundary, so the waves open and
    // replan as they would have (waveOpen, replansDue)
    const last = ownerAsk && job.lastReplan?.runId === runId ? job.lastReplan : undefined
    // T1: feedback on a finished plan asks for completion itself, whatever the last boundary was
    const mode = args.mode === 'completion' ? 'completion' : (last?.mode ?? 'wave')
    const mark: ReplanMark = {
      runId,
      mode,
      wave: last?.wave ?? (typeof args.wave === 'number' ? args.wave : 0),
      done: last?.done ?? own.filter((t) => t.status === 'completed').length
    }
    // A wave that went as planned needs no planner: record the boundary as replanned (which opens the wave) and move on.
    // Feedback, the final check and a person's own ask (no wave given) always plan.
    const deviating = feedback === undefined && mode === 'wave' && typeof args.wave === 'number' ? deviatingTasks(s, job, runId) : undefined
    if (deviating?.length === 0) {
      const summary = `Replan skipped: wave ${mark.wave} went as planned`
      await setJob(jobId, (j) => ({ ...j, lastReplan: { ...mark, at: now, summary } }))
      await post(waveOpenedMessage(deps.getState(), jobId, runId, mark.wave, now))
      deps.log?.(`replan skipped job=${jobId} run=${runId} wave=${mark.wave}`)
      return ok({ jobId, runId, mode, wave: mark.wave, skipped: true, summary })
    }
    // A replan for deviations is scoped: only the Tasks they can affect wait (waveOpen), the rest of the plan goes on.
    // Feedback, the final check and a person's own ask hold the whole Job: the hold and the mark in one commit.
    const scoped = deviating !== undefined
    const before = Object.fromEntries(own.map((t) => [t.id, t.updatedAt]))
    await setJob(jobId, (j) => {
      const replanning: ReplanRecord = {
        ...mark,
        startedAt: now,
        before,
        ...(scoped ? { scoped: true as const } : j.dispatchHold ? { heldBefore: true as const } : {}),
        ...(feedbackAt !== undefined ? { feedbackAt } : {}),
        ...(chat ? { chat: true as const } : {})
      }
      return { ...j, ...(scoped ? {} : { dispatchHold: true as const }), replanning }
    })
    const accountId = replanAccountOf(job)!
    let sessionId: string
    try {
      const parts = await briefParts(deps, deps.getState(), runId, deviating)
      sessionId = (
        await deps.startCoordinator({
          runId: jobId,
          cwd: job.cwd,
          accountId,
          role: 'planner',
          brief: buildReplanBrief({
            job,
            runId,
            mode,
            wave: mark.wave,
            accountId,
            followUps: job.replanFollowUps ?? 0,
            ...parts,
            ...(deviating ? { focused: true as const } : {}),
            ...(feedback !== undefined ? { feedback } : {}),
            ...(chat ? { chat: true as const } : {}),
            otherPlans: otherPlansBrief(deps.getState(), job)
          })
        })
      ).sessionId
    } catch (e) {
      const why = `the replan planner could not start: ${String(e)}`
      await setJob(jobId, ({ replanning: _r, ...j }) => ({ ...j, dispatchHold: true, lastReplan: { ...mark, at: now, summary: why, escalated: why } }))
      await post(replanEscalation(runId, jobId, why, now))
      return { status: 502, body: { error: why } }
    }
    const recorded = await setJob(jobId, (j) => ({
      ...j,
      plannerSessionIds: [...(j.plannerSessionIds ?? []), sessionId],
      ...(j.replanning ? { replanning: { ...j.replanning, sessionId } } : {})
    }))
    if (!recorded?.replanning) {
      await deps.stopCoordinator?.(sessionId, 'its replan ended while it started').catch(() => {})
      return conflict(`job ${jobId}'s replan ended while its planner started`)
    }
    deps.log?.(`replan started job=${jobId} run=${runId} mode=${mode} wave=${mark.wave} session=${sessionId}`)
    return ok({ jobId, runId, mode, wave: mark.wave, sessionId })
  }

  // jobs-replan-done: the replan session's own end, or the driving loop's when that session is gone (`gone`).
  const r = job.replanning
  if (!r) return conflict(`job ${jobId} is not replanning`)
  if (fromAgent && caller.sessionId !== r.sessionId) return denied('a replan is ended by its own planner session')
  // The driving loop's end of a planner that never finished (exec/dispatchLoop.ts REPLAN_TIMEOUT_MS): the boundary
  // passes as a skipped replan, with whatever the planner did change still checked below
  const timedOut = !fromAgent && args.timedOut === true
  const summed = replanSummary(s, job, str(args.summary) ?? (args.gone === true ? 'its planner session ended' : undefined))
  const added = summed.added
  const line = timedOut ? `Replan skipped: its planner did not finish in time (${summed.line})`.slice(0, 300) : summed.line
  const problems = replanProblems(s, r.runId)
  // The planner repairs its own plan: a plan that does not hold refuses its end, so the owner is never asked
  if (fromAgent && args.gone !== true && problems.length)
    return { status: 409, body: { error: `the plan does not hold yet: ${problems.join('; ')}. Fix them with task-update, then call jobs-replan-done again`, problems } }
  // T1: the cap is the automatic final check's; the owner's own feedback (T2: and chat) always gets its follow-ups
  const followUps = (job.replanFollowUps ?? 0) + (r.mode === 'completion' && added > 0 && r.feedbackAt === undefined && r.chat === undefined ? 1 : 0)
  const escalated = problems.length
    ? `the plan does not hold after the replan: ${problems.join('; ')}`
    : followUps > REPLAN_FOLLOW_UPS_MAX
      ? `the final check wants a follow-up wave beyond ${REPLAN_FOLLOW_UPS_MAX}: ${line}`
      : undefined
  const { startedAt, sessionId, heldBefore, cancelled: _c, droppedDeps: _d, before: _b, feedbackAt: _f, chat: _chat, scoped, ...mark } = r as ReplanRecord
  const ended: ReplanEnded = { ...mark, startedAt, at: now, summary: line, ...(escalated ? { escalated } : {}) }
  // A scoped replan set no hold, so it leaves the Job's hold as it finds it (a person's jobs-hold meanwhile stays)
  await setJob(jobId, ({ replanning: _r, dispatchHold: hold, ...j }) => ({
    ...j,
    // W7-A: the summary is what the planner changed for the owner's feedback. T1: also for what was typed into it
    // meanwhile; what was queued waits for the next replan
    ...(j.feedback
      ? { feedback: j.feedback.map((f) => (f.phase === 'run' && f.changes === undefined && !f.queued ? { ...f, changes: [escalated ?? line] } : f)) }
      : {}),
    ...(escalated || heldBefore || (scoped && hold) ? { dispatchHold: true as const } : {}),
    ...(followUps > 0 ? { replanFollowUps: followUps } : {}),
    lastReplan: ended
  }))
  deps.log?.(`replan ended job=${jobId} (${jobNameOf(job)}): ${escalated ?? line}`)
  await post(
    escalated
      ? replanEscalation(r.runId, jobId, escalated, now)
      : r.mode === 'wave'
        ? waveOpenedMessage(deps.getState(), jobId, r.runId, r.wave, now)
        : undefined
  )
  // #47: the planner's work is recorded, so its session ends.
  if (sessionId && args.gone !== true)
    await deps.stopCoordinator?.(sessionId, 'its replan is done').catch((e) => deps.log?.(`replan planner ${sessionId} could not be stopped: ${String(e)}`))
  // T2: a delivered plan the replan gave new Tasks is delivered again once they are done: its ended delivery record
  // goes, else the driving loop never looks at it (running.ts deliveryEnded). A PR still open is found again by its
  // branch (run-open-pr: gh's "already exists"); a merged one gets a new PR.
  const reopened = deps.getState().runs.find((x) => x.id === r.runId)
  if (r.mode === 'completion' && added > 0 && !escalated && reopened && deliveryEnded(reopened)) {
    const cur = deps.getState()
    const open = ({ delivery: _dl, pr: _pr, ...x }: JobRun): JobRun => x
    await deps.setState({ ...cur, runs: cur.runs.map((x) => (x.id === r.runId ? open(x) : x)) })
    deps.log?.(`run=${r.runId}: its delivery reopens for ${added} follow-up Task(s)`)
  }
  // T1: a finished plan the replan gave new Tasks runs again: its coordinator had stopped, and placing needs one
  // (state.ts placedByApp). run-start starts none for a Run still finished, paused, or with one attached.
  if (r.mode === 'completion' && added > 0 && !escalated && handle && deps.getState().runs.find((x) => x.id === r.runId)?.coordinatorSessionId === undefined) {
    const started = await handle(deps, { sessionId: HOST_CALLER }, 'run-start', { run: r.runId }).catch((e) => ({ status: 500, body: String(e) }))
    if (started.status >= 300) deps.log?.(`run=${r.runId}: its coordinator could not start after the replan: ${JSON.stringify(started.body)}`)
  }
  // T1: the owner's feedback queued while this replan ran starts the next one, all of it in one brief
  const queued = (deps.getState().jobs.find((j) => j.id === jobId)?.feedback ?? []).filter((f) => f.queued)
  if (queued.length) {
    const setQueued = (q: true | undefined) =>
      setJob(jobId, (j) => ({ ...j, feedback: (j.feedback ?? []).map((f) => (queued.some((x) => x.at === f.at && x.text === f.text) ? { ...f, queued: q } : f)) }))
    await setQueued(undefined)
    const finished = outcomeOfTasks(runTasks(deps.getState(), r.runId)) !== 'running'
    const next = await replanCommand(deps, { sessionId: HOST_CALLER }, 'jobs-replan', { id: jobId, run: r.runId, feedback: queued.map((f) => f.text).join('\n\n'), feedbackAt: now, ...(finished ? { mode: 'completion' } : {}) }, false, handle)
    if (next.status >= 300) {
      await setQueued(true)
      deps.log?.(`job=${jobId}: its queued feedback could not start a replan: ${JSON.stringify(next.body)}`)
    }
  }
  return ok({ jobId, summary: line, ...(escalated ? { escalated, held: true } : {}) })
}
