// W6-D wave replanning: the replan's start and end, as commands (`jobs-replan`, `jobs-replan-done`, `task-cancel`, and
// `task-update` from a replan session). The rules are replan.ts's; this is where they meet the state and the sessions.
//
// A replan is a **fresh planner session** started through `startCoordinator({ role: 'planner' })`, so it takes the
// planner's spawn whole (exec/plannerStart.ts: the planner model, no permission bypass, the planner gate). Only its
// brief differs: the objective, what every completed Task reported, its review and its changed files, and what is
// left. Its end is #47's: the session is stopped once its work is recorded.
// W8-D several plans in one repo
import { PROMPTS_MODE_FILL_IN } from '../handover'
import { otherPlansBrief } from '../overlap'
import { collectChanges, rangesFor } from '../changedFiles'
import type { OrchServerDeps } from '../command'
import { PLANNER_COMMANDS, planFieldsFromArgs, validatePlan } from '../planner'
import { REPLAN_FOLLOW_UPS_MAX, affectedLeft, cancelRemainingTask, deviatingTasks, editRemainingTask, notStarted, replanAccountOf, replanJobOf, replanOn, runTasks, waveOpen } from '../replan'
import { isIntegrationTask } from '../integrate'
import { jobNameOf } from '../jobName'
import { placedByApp, type OrchState } from '../state'
import { newId, type Job, type Message, type ReplanMark, type Task } from '../types'

type Reply = { status: number; body: unknown }
type Caller = { sessionId: string; role?: 'app' | 'cli' | 'mcp' | 'controller' | 'plugin' }

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

/** `plan.replanned` for the coordinator of a Run whose wave just opened: the wave and the Tasks it may start now. None
 *  for a Run the app places itself (its scheduler starts them), a Run that is gone, or a Job still held. */
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
      `Wave ${wave + 1} of the plan is open (${job.lastReplan?.summary ?? 'replanned'}). ` +
      (startable.length
        ? `Start these ready Tasks now: ${startable.map((t) => `${t.id} (${t.title})`).join(', ')}.`
        : 'No Task is ready to start yet.'),
    answered: false,
    createdAt: now
  }
}

/** What a replan session may call besides a planner's own commands: its Run's reads, the cancel, and the end. */
const REPLAN_EXTRA = new Set(['runs-get', 'runs-changed-files', 'task-cancel', 'jobs-replan-done'])

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
  return { line: clean ? `${what}: ${clean}`.slice(0, 300) : what, added }
}

/** One completed Task, as the replan brief shows it. */
export interface DoneTask {
  task: Pick<Task, 'id' | 'title' | 'result' | 'reviewRequested' | 'reviewIssues' | 'filesModified'>
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
  running: Pick<Task, 'id' | 'title'>[]
  left: Pick<Task, 'id' | 'title' | 'deps' | 'affectedPaths'>[]
  /** W7-A: the owner's feedback this replan was started for, at once rather than at a wave boundary. */
  feedback?: string
  /** W8-D: the other plans of this repository and how far they got (overlap.ts `otherPlansBrief`). */
  otherPlans?: string
  /** A wave replan that looks at the deviating Tasks only: `done` and `left` are already narrowed to them. */
  focused?: true
}): string {
  const reviewOf = (t: DoneTask['task']): string => {
    if (!t.reviewRequested) return 'not reviewed'
    const issues = t.reviewIssues ?? []
    return issues.length ? `passed with ${issues.map((i) => `${i.severity} ${i.title}`).join('; ')}` : 'passed, no issues'
  }
  const completion = a.mode === 'completion'
  return [
    a.feedback !== undefined
      ? 'You are the PLANNER for one Job in Astera, REPLANNING NOW because the owner sent feedback while the plan runs.'
      : completion
      ? 'You are the PLANNER for one Job in Astera, doing its FINAL CHECK. Every Task has completed.'
      : `You are the PLANNER for one Job in Astera, REPLANNING before wave ${a.wave + 1} starts.`,
    'You analyse and adjust the plan. You do not implement anything. No Task starts until you finish.',
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
          `  changed files: ${(changed ?? t.filesModified ?? []).join(', ') || '(none recorded)'}`
        ])
      : ['- (none)']),
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
          'Apply it to the Tasks that have not started. If it is about a running or completed Task, change nothing',
          'there: say so in your summary, so the owner can stop that Task from its card.',
          ''
        ]
      : []),
    'BEFORE YOU DECIDE',
    '- Read `$ASTERA_SKILLS/planner-guide.md`, section "Replanning". Read the code the done Tasks changed:',
    ...(a.focused ? ['  Read only the Tasks listed here, not the whole plan; the rest is unchanged.'] : []),
    `  \`astera runs-changed-files --id ${a.runId} --task <taskId> --json\`, and the files themselves.`,
    '',
    'WHAT YOU MAY DO',
    `- Change a Task that has not started: \`astera task-update --id <taskId>\` with --prompt -, --criteria, --affected-paths, --deps, --difficulty, --title, --spec.`,
    `- Add a Task: \`astera task-create --run ${a.runId} --account ${a.accountId}\` with the planner flags (--prompt -, --criteria, --affected-paths, --deps, --difficulty, --model-reason).`,
    '- Cancel a Task that has not started and is no longer needed: `astera task-cancel --id <taskId> --reason "<why>"`.',
    'Astera refuses any change to a completed or running Task, and every command that starts work.',
    ...(completion
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
    'session. If the plan does not hold together then (a Task without prompt or criteria, an unknown dep, a cycle),',
    'the Job stays held and the person is asked.'
  ].join('\n')
}

/** The Job's Run and its Tasks split for the brief, with each completed Task's changed files read from git. */
async function briefParts(deps: OrchServerDeps, s: OrchState, runId: string, only?: readonly Task[]): Promise<Pick<Parameters<typeof buildReplanBrief>[0], 'done' | 'running' | 'left'>> {
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
  return {
    done,
    running: own.filter((t) => t.status !== 'completed' && !notStarted(s, t)),
    left: only ? affectedLeft(only, left) : left
  }
}

/** The replan commands. `fromAgent`: the caller is an agent session (not the app, the Host, a shell). */
export async function replanCommand(deps: OrchServerDeps, caller: Caller, cmd: string, args: Record<string, unknown>, fromAgent: boolean): Promise<Reply> {
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
    await deps.setState(r.state)
    return ok(r.value)
  }

  if (cmd === 'task-cancel') {
    const id = str(args.id)
    const reason = str(args.reason)
    if (!id) return bad('--id is required')
    if (!reason) return bad('--reason is required: why this Task is no longer needed')
    const job = replanJobOf(s, caller.sessionId)
    if (!job) return denied('a Task is cancelled by its Job\'s replan only')
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
    // The driving loop asks at a boundary; a person may too. Never another agent: a replan holds the whole Job.
    if (fromAgent || caller.role === 'mcp') return denied('a replan is started by Astera at a wave boundary, or by the person')
    // W7-A: the owner's feedback replans a planned Job at once, also with waves replanning off
    const feedback = str(args.feedback) ?? undefined
    const feedbackAt = feedback !== undefined ? (str(args.feedbackAt) ?? now) : undefined
    const plannedRun = job.plannerSessionIds !== undefined && job.schedule === undefined && replanAccountOf(job) !== undefined
    if (feedback !== undefined ? !plannedRun : !replanOn(job))
      return conflict(`job ${jobId} does not replan: it is not planned, is a schedule, has no account to plan on, or has replan off`)
    if (job.replanning) return conflict(`job ${jobId} is replanning already`)
    if (!deps.startCoordinator) return conflict('starting a planner is not available in this build')
    const runId = str(args.run) ?? s.runs.filter((r) => r.jobId === jobId).at(-1)?.id
    if (!runId || !s.runs.some((r) => r.id === runId && r.jobId === jobId)) return notFound(`no run of job ${jobId}${runId ? `: ${runId}` : ''}`)
    const own = s.tasks.filter((t) => t.runId === runId)
    // W7-A: a feedback replan is at no boundary of its own: it re-records the Run's last boundary, so the waves open and
    // replan as they would have (waveOpen, replansDue)
    const last = feedback !== undefined && job.lastReplan?.runId === runId ? job.lastReplan : undefined
    const mode = last?.mode ?? (args.mode === 'completion' ? 'completion' : 'wave')
    const mark: ReplanMark = {
      runId,
      mode,
      wave: last?.wave ?? (typeof args.wave === 'number' ? args.wave : 0),
      done: last?.done ?? own.filter((t) => t.status === 'completed').length
    }
    // A wave that went as planned needs no planner: record the boundary as replanned (which opens the wave) and move on.
    // Feedback, the final check and a person's own ask (no wave given) always plan.
    const deviating = feedback === undefined && mode === 'wave' && typeof args.wave === 'number' ? deviatingTasks(s, job, mark) : undefined
    if (deviating?.length === 0) {
      const summary = `Replan skipped: wave ${mark.wave} went as planned`
      await setJob(jobId, (j) => ({ ...j, lastReplan: { ...mark, at: now, summary } }))
      await post(waveOpenedMessage(deps.getState(), jobId, runId, mark.wave, now))
      deps.log?.(`replan skipped job=${jobId} run=${runId} wave=${mark.wave}`)
      return ok({ jobId, runId, mode, wave: mark.wave, skipped: true, summary })
    }
    // The hold and the mark in one commit: from here no Task of the Job starts (waveOpen, dispatchHold).
    const before = Object.fromEntries(own.map((t) => [t.id, t.updatedAt]))
    await setJob(jobId, (j) => ({
      ...j,
      dispatchHold: true,
      replanning: { ...mark, startedAt: now, before, ...(j.dispatchHold ? { heldBefore: true as const } : {}), ...(feedbackAt !== undefined ? { feedbackAt } : {}) }
    }))
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
  const followUps = (job.replanFollowUps ?? 0) + (r.mode === 'completion' && added > 0 ? 1 : 0)
  const escalated = problems.length
    ? `the plan does not hold after the replan: ${problems.join('; ')}`
    : followUps > REPLAN_FOLLOW_UPS_MAX
      ? `the final check wants a follow-up wave beyond ${REPLAN_FOLLOW_UPS_MAX}: ${line}`
      : undefined
  const { startedAt: _s, sessionId, heldBefore, cancelled: _c, before: _b, feedbackAt, ...mark } = r
  await setJob(jobId, ({ replanning: _r, dispatchHold: _h, ...j }) => ({
    ...j,
    // W7-A: the summary is what the planner changed for the owner's feedback
    ...(feedbackAt !== undefined && j.feedback
      ? { feedback: j.feedback.map((f) => (f.at === feedbackAt && f.phase === 'run' && f.changes === undefined ? { ...f, changes: [escalated ?? line] } : f)) }
      : {}),
    ...(escalated || heldBefore ? { dispatchHold: true as const } : {}),
    ...(followUps > 0 ? { replanFollowUps: followUps } : {}),
    lastReplan: { ...mark, at: now, summary: line, ...(escalated ? { escalated } : {}) }
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
  return ok({ jobId, summary: line, ...(escalated ? { escalated, held: true } : {}) })
}
