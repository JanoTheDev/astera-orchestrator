// The Jobs sidebar's one-shot actions (pause, resume, coordinator restart, approve, delete), each through a door
// (lib/orchDoor.ts) so a paired Runtime's Job takes the same flow as this computer's (remote runtime design Phase 7).
// The bodies are the App's own, moved: the same confirmations, counts, choices and failure sentences.
import type { OrchSnapshot } from '../../../core/types'
import { findRun } from '../../../core/orchestration/snapshot'
import { isOutcomeUnknown, replyNote, type CommandReply, type OrchDoor } from './orchDoor'
import { jobName } from './jobName'
import { openConsole } from '../components/shell/navigation'

export interface ActionUi {
  t(key: string, params?: Record<string, string | number>): string
  confirm(o: { title: string; body: string; confirmLabel: string }): Promise<boolean>
  confirmChoices(o: {
    title: string
    body: string
    confirmLabel: string
    choices?: Array<{ id: string; label: string; hint?: string }>
  }): Promise<{ ok: boolean; checked: string[] }>
  error(message: string, o?: { ttlMs?: number }): void
  /** Hides folders from the history list. Absent for a remote Job: that list is this computer's. */
  hide?(paths: string[]): void
}

/** How long the "plan is not ready to approve" toast stays. */
export const PLAN_INVALID_TOAST_MS = 15_000

/** A refusal or a lost answer says what it is (orchDoor replyNote); anything else is `fallback`. */
const failure = (reply: CommandReply, ui: ActionUi, fallback: string): void => ui.error(replyNote(reply, ui.t, fallback))

/** Sends, and shows a failure; a send that throws (IPC) is the same failure. Answers the reply, or null. */
const send = async (door: OrchDoor, cmd: string, args: Record<string, unknown>, ui: ActionUi, fallback: string): Promise<CommandReply | null> => {
  try {
    return await door.command(cmd, args)
  } catch {
    ui.error(fallback)
    return null
  }
}

/** Pauses a schedule, after asking. A worker someone holds (worker-retain) is said apart from other refusals. */
export async function pauseRun(door: OrchDoor, runId: string, ui: ActionUi): Promise<void> {
  const ok = await ui.confirm({ title: ui.t('jobs.run.pauseConfirmTitle'), body: ui.t('jobs.run.pauseConfirmBody'), confirmLabel: ui.t('jobs.run.pause') })
  if (!ok) return
  const reply = await send(door, 'run-pause', { run: runId }, ui, ui.t('jobs.run.pauseFailed'))
  if (!reply || reply.status < 400) return
  if (reply.status === 409 && !isOutcomeUnknown(reply))
    ui.error(JSON.stringify(reply.body).includes('worker-retain') ? ui.t('jobs.run.pauseRetained') : ui.t('jobs.run.pauseFailed'))
  else failure(reply, ui, ui.t('jobs.run.pauseFailed'))
}

export async function resumeRun(door: OrchDoor, runId: string, ui: ActionUi): Promise<void> {
  const reply = await send(door, 'run-resume', { run: runId }, ui, ui.t('jobs.run.resumeFailed'))
  if (reply && reply.status >= 400) failure(reply, ui, ui.t('jobs.run.resumeFailed'))
}

/** Puts a coordinator back on a Run that lost it: `run-start` again, whose meaning is "this Run has a manager" and
 *  which does nothing when it has one (command.ts). The row's id is a Job's or a round's; run-start takes both. */
export async function restartCoordinator(door: OrchDoor, runId: string, ui: ActionUi): Promise<boolean> {
  const reply = await send(door, 'run-start', { run: runId }, ui, ui.t('jobs.run.coordinatorRestartFailed'))
  if (!reply) return false
  if (reply.status < 400) return true
  // W2-A: the same command approves a planned Job ("Approve & execute"); a plan that does not hold together is
  // refused with what is wrong with it (`problems`, planner.ts's validatePlan), said as it is.
  const problems = (reply.body as { problems?: unknown } | null)?.problems
  // W8-F (#94): the problems stay on the Run window above Run (JobRow.planProblems), so this toast closes on its own
  if (Array.isArray(problems)) ui.error(`${ui.t('jobs.run.planInvalid')}\n${problems.map((p) => `• ${String(p)}`).join('\n')}`, { ttlMs: PLAN_INVALID_TOAST_MS })
  else failure(reply, ui, ui.t('jobs.run.coordinatorRestartFailed'))
  return false
}

// W3-B: the plan actions the command bar shares with the Jobs card. Each asks in the app's own dialog first, so a
// typed or spoken command can name them but never run them alone (CONTEXT rule 6).

/** Approves a plan: `run-start` on its Job (W2-A), after asking, because it starts workers and spends quota. The Jobs
 *  card's "Approve & execute" and the command bar's approve both come here. A plan that does not hold is refused with
 *  its `problems`, said as restartCoordinator says them. */
export async function approvePlan(door: OrchDoor, jobId: string, name: string, ui: ActionUi): Promise<boolean> {
  const ok = await ui.confirm({
    title: ui.t('jobs.run.approve'),
    body: ui.t('jobs.run.approveConfirmBody', { objective: name }),
    confirmLabel: ui.t('jobs.run.approve')
  })
  return ok && restartCoordinator(door, jobId, ui)
}

// W5-C holds: neither closes anything. Holding a plan asks nothing; pausing a worker asks first all the same (SPEC §8:
// a spoken "pause worker three" names one session, and the person sees which before it happens).

/** Holds a plan from launching new workers (`jobs-hold`), or lets it go again (`jobs-unhold`). Running workers carry
 *  on, so nothing is asked. */
export async function holdJob(door: OrchDoor, jobId: string, hold: boolean, ui: ActionUi): Promise<boolean> {
  const fallback = ui.t(hold ? 'jobs.hold.failed' : 'jobs.hold.releaseFailed')
  const reply = await send(door, hold ? 'jobs-hold' : 'jobs-unhold', { id: jobId }, ui, fallback)
  if (reply && reply.status >= 400) failure(reply, ui, fallback)
  return reply !== null && reply.status < 400
}

/** Pauses one worker (`worker-hold`) after asking: its session stays open and keeps its slot, and no agent types into
 *  it until it is resumed. */
export async function holdWorker(door: OrchDoor, dispatchId: string, label: string, ui: ActionUi): Promise<boolean> {
  const ok = await ui.confirm({
    title: ui.t('command.holdWorker.title'),
    body: ui.t('command.holdWorker.body', { session: label }),
    confirmLabel: ui.t('command.holdWorker.confirm')
  })
  if (!ok) return false
  const reply = await send(door, 'worker-hold', { dispatch: dispatchId }, ui, ui.t('command.holdWorker.failed'))
  if (reply && reply.status >= 400) failure(reply, ui, ui.t('command.holdWorker.failed'))
  return reply !== null && reply.status < 400
}

/** Resumes a paused worker (`worker-unhold`). Asks nothing: it closes nothing and starts nothing new. */
export async function unholdWorker(door: OrchDoor, dispatchId: string, ui: ActionUi): Promise<boolean> {
  const reply = await send(door, 'worker-unhold', { dispatch: dispatchId }, ui, ui.t('command.holdWorker.releaseFailed'))
  if (reply && reply.status >= 400) failure(reply, ui, ui.t('command.holdWorker.releaseFailed'))
  return reply !== null && reply.status < 400
}

/** Stops a running Run (`runs-stop`): its workers and coordinator close and it is paused. Asked first. To stop a plan
 *  launching more while its workers carry on, hold it instead (holdJob). */
export async function stopRun(door: OrchDoor, runId: string, name: string, ui: ActionUi): Promise<boolean> {
  const ok = await ui.confirm({
    title: ui.t('command.stop.title'),
    body: ui.t('command.stop.body', { objective: name }),
    confirmLabel: ui.t('command.stop.confirm')
  })
  if (!ok) return false
  const reply = await send(door, 'runs-stop', { id: runId }, ui, ui.t('command.stop.failed'))
  if (reply && reply.status >= 400) failure(reply, ui, ui.t('command.stop.failed'))
  return reply !== null && reply.status < 400
}

/** Resumes a Run `runs-stop` paused. Asks nothing, like resumeRun: it starts work again, it closes nothing. */
export async function resumeStoppedRun(door: OrchDoor, runId: string, ui: ActionUi): Promise<boolean> {
  const reply = await send(door, 'runs-resume', { id: runId }, ui, ui.t('jobs.run.resumeFailed'))
  if (reply && reply.status >= 400) failure(reply, ui, ui.t('jobs.run.resumeFailed'))
  return reply !== null && reply.status < 400
}

/** T36: the owner's answer to a failed Task its plan waits on (`task-failed-resolve`): retry it, accept it as done (with a
 *  reason the record keeps), or cancel the not-started Tasks that wait on it. Cancel drops Tasks, so it asks first. */
export async function resolveFailed(door: OrchDoor, taskId: string, action: 'retry' | 'accept' | 'cancel', ui: ActionUi): Promise<boolean> {
  if (action === 'cancel') {
    const ok = await ui.confirm({ title: ui.t('plan.failedWait.cancel'), body: ui.t('plan.failedWait.cancelBody'), confirmLabel: ui.t('plan.failedWait.cancel') })
    if (!ok) return false
  }
  const args = action === 'accept' ? { id: taskId, action, reason: ui.t('plan.failedWait.acceptReason') } : { id: taskId, action }
  const reply = await send(door, 'task-failed-resolve', args, ui, ui.t('plan.failedWait.failed'))
  if (reply && reply.status >= 400) failure(reply, ui, ui.t('plan.failedWait.failed'))
  return reply !== null && reply.status < 400
}

/** Rolls back a Job just made when the step after jobs-create failed (its planner did not start): no draft is left
 *  behind. Asks nothing: a just-made Job has no work to lose. A failed delete keeps the caller's own error. */
export async function discardMadeJob(door: OrchDoor, id: string): Promise<void> {
  try {
    const reply = await door.command('run-delete', { id })
    if (reply.status >= 400) console.warn(`run-delete of the half-made Job ${id} failed`, reply.body)
  } catch (e) {
    console.warn(`run-delete of the half-made Job ${id} failed`, e)
  }
}

/** Deletes a Run after a confirmation that counts what goes with it (a schedule's rounds too) and offers to merge
 *  and to remove the worktrees it used. Irreversible, so the counts never understate. */
export async function deleteRun(door: OrchDoor, snapshot: OrchSnapshot | null, runId: string, ui: ActionUi): Promise<void> {
  // findRun: a round is not among the top-level runs (snapshot.ts).
  const run = snapshot ? findRun(snapshot, runId) : undefined
  if (!run) return
  // A template's rounds go with it (run-delete deletes them in the same set), so they are counted.
  const kids = run.children ?? []
  const tasks = kids.reduce((n, k) => n + k.total, run.total)
  const events = kids.reduce((n, k) => n + k.eventCount, run.eventCount)
  // Workers that will be stopped: Tasks with an open Dispatch, not runningCount (validating and reviewing have no
  // session to end).
  const workers = [run, ...kids].reduce((n, r) => n + r.tasks.filter((tk) => tk.startedAt !== undefined).length, 0)
  // Only a Run that used worktrees gets the choices; a template counts its rounds' folders, since it ran none itself.
  const wt = run.schedule ? kids.flatMap((k) => k.worktrees ?? []) : (run.worktrees ?? [])
  const answer = await ui.confirmChoices({
    title: ui.t('jobs.run.delete'),
    // Only deleting a template stops workers (run-delete): what goes with it is said here.
    body:
      // Named as its card names it (plugin 4d review I1): a Job made from a ticket by the ticket's title
      ui.t('jobs.run.deleteBody', { objective: jobName(run), tasks, events }) +
      (run.schedule && workers > 0 ? '\n\n' + ui.t('jobs.run.deleteStopsWorkers', { workers }) : ''),
    confirmLabel: ui.t('jobs.run.delete'),
    ...(wt.length > 0
      ? {
          choices: [
            { id: 'merge', label: ui.t('jobs.run.deleteMerge'), hint: ui.t('jobs.run.deleteMergeHint', { count: wt.length }) },
            ...(ui.hide ? [{ id: 'hide', label: ui.t('jobs.run.deleteHide') }] : []),
            // Removing without merging loses the unmerged commits then: said always, at the moment of choosing.
            { id: 'worktrees', label: ui.t('jobs.run.deleteWorktrees', { count: wt.length }), hint: ui.t('jobs.run.deleteWorktreesHint') }
          ]
        }
      : {})
  })
  if (!answer.ok) return
  const reply = await send(
    door,
    'run-delete',
    {
      id: runId,
      ...(answer.checked.includes('merge') ? { merge: true } : {}),
      ...(answer.checked.includes('worktrees') ? { removeWorktrees: true } : {})
    },
    ui,
    ui.t('jobs.run.deleteFailed')
  )
  if (!reply) return
  // Hiding is the renderer's own list, and only after the delete went through: a refused delete (a running worker
  // answers 409, a common path) must not leave the history hidden with nothing deleted.
  if (reply.status < 400 && answer.checked.includes('hide')) ui.hide?.(wt)
  // The two 409s are told apart by our own server's sentences: a held session is released, not stopped.
  // A lost answer is neither: the delete may have gone through (checked before the 409 split).
  if (reply.status === 409 && !isOutcomeUnknown(reply))
    ui.error(JSON.stringify(reply.body).includes('worker-retain') ? ui.t('jobs.run.deleteRetained') : ui.t('jobs.run.deleteBusy'))
  else if (reply.status >= 400) failure(reply, ui, ui.t('jobs.run.deleteFailed'))
  else {
    // Folders the command kept (uncommitted changes after a merge, or a state it could not read) are said, in a
    // notice that stays.
    const kept = (reply.body as { worktreesKept?: unknown } | null)?.worktreesKept
    if (Array.isArray(kept) && kept.length > 0) ui.error(ui.t('jobs.run.deleteKeptWorktrees', { count: kept.length }))
  }
}

// W1-C plan lifecycle (core/orchestration/lifecycle.ts): rename, archive, unarchive. A row's id is its Job's.

/** Names a Job; an empty title names it by its objective again. Asks nothing: a name loses nothing. */
export async function renameJob(door: OrchDoor, jobId: string, title: string, ui: ActionUi): Promise<void> {
  const reply = await send(door, 'jobs-rename', { id: jobId, title }, ui, ui.t('jobs.lifecycle.renameFailed'))
  if (reply && reply.status >= 400) failure(reply, ui, ui.t('jobs.lifecycle.renameFailed'))
}

/** Archives a Job after asking. **Closing its sessions is a choice the person ticks** (SPEC §12): it starts unticked,
 *  and only then does the command get `killSessions`. */
export async function archiveJob(door: OrchDoor, snapshot: OrchSnapshot | null, jobId: string, ui: ActionUi): Promise<void> {
  const row = snapshot?.runs.find((r) => r.id === jobId)
  if (!row) return
  const answer = await ui.confirmChoices({
    title: ui.t('jobs.lifecycle.archive'),
    body: ui.t('jobs.lifecycle.archiveBody', { objective: jobName(row) }),
    confirmLabel: ui.t('jobs.lifecycle.archive'),
    choices: [{ id: 'kill', label: ui.t('jobs.lifecycle.archiveKill'), hint: ui.t('jobs.lifecycle.archiveKillHint') }]
  })
  if (!answer.ok) return
  const kill = answer.checked.includes('kill')
  const reply = await send(door, 'jobs-archive', { id: jobId, ...(kill ? { killSessions: true } : {}) }, ui, ui.t('jobs.lifecycle.archiveFailed'))
  if (reply && reply.status >= 400) failure(reply, ui, ui.t('jobs.lifecycle.archiveFailed'))
}

/** Archives many Jobs with one `jobs-archive` each (the caller asked once). A refusal or a lost answer counts as failed and
 *  the rest go on; archived and failed are the counts for the caller's one toast. Archive, never delete. */
export async function archiveJobs(door: OrchDoor, jobIds: readonly string[], killSessions: boolean): Promise<{ archived: number; failed: number }> {
  let archived = 0
  for (const id of jobIds) {
    try {
      const reply = await door.command('jobs-archive', { id, ...(killSessions ? { killSessions: true } : {}) })
      if (reply.status < 400) archived++
    } catch {
      /* counted as failed below */
    }
  }
  return { archived, failed: jobIds.length - archived }
}

export async function unarchiveJob(door: OrchDoor, jobId: string, ui: ActionUi): Promise<void> {
  const reply = await send(door, 'jobs-unarchive', { id: jobId }, ui, ui.t('jobs.lifecycle.unarchiveFailed'))
  if (reply && reply.status >= 400) failure(reply, ui, ui.t('jobs.lifecycle.unarchiveFailed'))
}

// W7-A talk to the planner (core/orchestration/exec/plannerFeedback.ts). The Jobs card's talk box and the command bar
// both come here.

/** Sends the owner's feedback on a plan (`jobs-feedback`): to its planner before approval, through a replan while it
 *  runs (typed into a live one, or queued behind it), and through a final-check replan once it has finished. Asks nothing: it starts no worker, and a replan changes only Tasks that have not started. */
export async function sendPlanFeedback(door: OrchDoor, jobId: string, text: string, ui: ActionUi): Promise<boolean> {
  const reply = await postPlanFeedback(door, jobId, text, ui)
  if (reply && reply.status >= 400) failure(reply, ui, ui.t('plan.talk.failed'))
  return reply !== null && reply.status < 400
}

/** `jobs-feedback` and its raw reply, a refusal not yet said: the talk box reads what the planner did with the message
 *  (typed, queued, reopened the plan) and answers a planner that waits on a question with a way to its tab. */
export const postPlanFeedback = (door: OrchDoor, jobId: string, text: string, ui: ActionUi): Promise<CommandReply | null> =>
  send(door, 'jobs-feedback', { job: jobId, text }, ui, ui.t('plan.talk.failed'))

/** Rejects a plan waiting for approval (`jobs-reject`) after asking: it is archived with the reason, and its planner
 *  ends. Unarchive takes it back. */
export async function rejectPlan(door: OrchDoor, jobId: string, name: string, reason: string, ui: ActionUi): Promise<boolean> {
  const ok = await ui.confirm({
    title: ui.t('plan.talk.reject'),
    body: ui.t('plan.talk.rejectBody', { objective: name }),
    confirmLabel: ui.t('plan.talk.reject')
  })
  if (!ok) return false
  const clean = reason.trim()
  const reply = await send(door, 'jobs-reject', { job: jobId, ...(clean ? { reason: clean } : {}) }, ui, ui.t('plan.talk.rejectFailed'))
  if (reply && reply.status >= 400) failure(reply, ui, ui.t('plan.talk.rejectFailed'))
  return reply !== null && reply.status < 400
}

// W9-C plan page ⋯ menu
/** Queues a plan not yet planned after another (`jobs-set --after <job|none>`, W8-C): it starts when that one delivers.
 *  Asks nothing: it closes nothing and starts nothing. */
export async function setJobAfter(door: OrchDoor, jobId: string, afterId: string | 'none', ui: ActionUi): Promise<boolean> {
  const fallback = ui.t('pages.plan.startAfterFailed')
  const reply = await send(door, 'jobs-set', { id: jobId, after: afterId }, ui, fallback)
  if (reply && reply.status >= 400) failure(reply, ui, fallback)
  return reply !== null && reply.status < 400
}

/** Opens a session's tab. The tab arrives through session:created, which can land after the reply, and openConsole
 *  ignores a tab it does not have yet, so it is tried twice, not awaited (as planCommands' askAboutTask does). */
const openSessionTab = (sessionId: string): void => {
  setTimeout(() => openConsole(sessionId), 300)
  setTimeout(() => openConsole(sessionId), 1500)
}

/** "Ask & plan more" on a finished plan: `jobs-chat` starts (or finds) its planner in chat mode and this opens that
 *  planner's tab. A refusal or a lost answer is a toast. True when a tab was asked for. */
export async function openPlanChat(door: OrchDoor, jobId: string, ui: ActionUi, open: (sessionId: string) => void = openSessionTab): Promise<boolean> {
  const fallback = ui.t('plan.chat.failed')
  const reply = await send(door, 'jobs-chat', { id: jobId }, ui, fallback)
  if (reply === null) return false
  const sessionId = (reply.body as { sessionId?: unknown } | null)?.sessionId
  if (reply.status >= 400 || typeof sessionId !== 'string') {
    failure(reply, ui, fallback)
    return false
  }
  open(sessionId)
  return true
}
