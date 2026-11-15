import { formFailure, type CommandReply, type OrchDoor } from '../../lib/orchDoor'
import { discardMadeJob } from '../../lib/jobActions'
import { fileUnderArgs } from './intakeRequest'

type T = (key: string, params?: Record<string, string | number>) => string

export type CreatedPlan = { ok: true; id: string; sessionId?: string } | { ok: false; error: string }

/** Main's host route sent the call and no answer came back (its deadline, or the connection went): the Host may still
 *  make the Job. The codes are sourcesRoute's. */
const answerLost = (r: CommandReply): boolean => {
  const code = (r.body as { code?: unknown } | null)?.code
  return code === 'TIMEOUT' || code === 'HOST_LOST'
}

/** jobs-create, then the move under a picked sub-project, then the planner (or `jobs-set --after` to queue behind another
 *  plan). All or nothing: when a step after jobs-create fails the Job just made is deleted again, so no draft is left
 *  behind. A Job made with a `schedule` has no planner step and stays. A planner that waits for an account answers 2xx
 *  and is a started plan. A step after jobs-create that gets no answer at all leaves the Job as it is and counts as made. */
export async function createPlan(
  door: OrchDoor,
  o: { cmd: string; args: Record<string, unknown>; projectId: string; after: string; scheduled: boolean; t: T }
): Promise<CreatedPlan> {
  const { t } = o
  const reply = await door.command(o.cmd, o.args)
  if (answerLost(reply)) return { ok: false, error: t('jobs.source.lost') }
  if (reply.status >= 400) return { ok: false, error: formFailure(reply, t, 'jobs.new.failed').message }
  const made = reply.body as { id?: string; projectId?: string }
  const id = made.id
  if (id === undefined) return { ok: false, error: t('jobs.new.failed') }
  const rollback = async (error: string): Promise<CreatedPlan> => {
    if (!o.scheduled) await discardMadeJob(door, id)
    return { ok: false, error }
  }
  try {
    const fileUnder = fileUnderArgs({ id, projectId: made.projectId }, o.projectId)
    if (fileUnder) {
      const moved = await door.command('jobs-set', fileUnder)
      if (moved.status >= 400) return rollback(formFailure(moved, t, 'jobs.new.failed').message)
    }
    if (o.scheduled) return { ok: true, id }
    const planned = await door.command(o.after ? 'jobs-set' : 'jobs-plan', o.after ? { id, after: o.after } : { id })
    if (planned.status < 400) {
      const sessionId = (planned.body as { sessionId?: unknown } | null)?.sessionId
      return typeof sessionId === 'string' ? { ok: true, id, sessionId } : { ok: true, id }
    }
    const why = (planned.body as { error?: unknown } | null)?.error
    return rollback(`${t('jobs.new.plannerFailed')}${typeof why === 'string' ? `: ${why}` : ''}`)
  } catch (e) {
    // The Job is made. A later step that threw (2026-11-15: its state-put past the 15 s deadline) said "Could not create
    // the job" over a Job that was there, and the owner added it again; nor is it deleted through a Host that is not answering.
    console.warn(`Job ${id} was made, but a step after it got no answer`, e)
    return { ok: true, id }
  }
}
